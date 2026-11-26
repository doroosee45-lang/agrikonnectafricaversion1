import { AppState, type AppStateStatus, Platform } from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system/legacy';

import { localDb } from '@/db/database';
import type { LocalMessage, MessageContentType } from '@/db/models';
import { api } from '@/services/api/http';
import { realtime } from '@/services/realtime';
import { useAuthStore } from '@/store/auth';
import { rejouerEcritures } from '@/services/ecrituresHorsLigne';
import { ROUTE_TIRAGE_MESSAGES, tirerToutesLesPages, type ReponseTirage } from '@/services/syncPull';

const MAX_BACKOFF_MS = 60_000;
const BASE_BACKOFF_MS = 2_000;
const LAST_PULLED_KEY = 'comms_last_pulled_at';

export function computeExponentialBackoffMs(retryCount: number): number {
  const exp = Math.min(retryCount, 5);
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, exp), MAX_BACKOFF_MS);
}

class OfflineSyncEngine {
  private started = false;
  private isOnline = true;
  private isSyncing = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeNetInfo: (() => void) | null = null;
  private appStateSub: { remove: () => void } | null = null;
  private statusListeners = new Set<(online: boolean, syncing: boolean) => void>();

  subscribeStatus(listener: (online: boolean, syncing: boolean) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.isOnline, this.isSyncing);
    return () => { this.statusListeners.delete(listener); };
  }

  private emitStatus(): void {
    this.statusListeners.forEach((fn) => {
      try { fn(this.isOnline, this.isSyncing); } catch { /* noop */ }
    });
  }

  getNetworkState(): { isOnline: boolean; isSyncing: boolean } {
    return { isOnline: this.isOnline, isSyncing: this.isSyncing };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    void localDb.ensureInitialized();

    this.unsubscribeNetInfo = NetInfo.addEventListener((state: NetInfoState) => {
      const reachable = Boolean(state.isConnected) && state.isInternetReachable !== false;
      const becameOnline = !this.isOnline && reachable;
      this.isOnline = reachable;
      this.emitStatus();
      if (becameOnline || reachable) {
        void this.triggerSync();
      }
    });

    this.appStateSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        void this.triggerSync();
      }
    });

    void this.triggerSync();
  }

  stop(): void {
    this.started = false;
    this.unsubscribeNetInfo?.();
    this.unsubscribeNetInfo = null;
    this.appStateSub?.remove();
    this.appStateSub = null;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /**
   * Copie un fichier temporaire (audio, photo, PDF) dans le stockage persistant
   * du téléphone (FileSystem.documentDirectory) pour résister aux coupures réseau.
   */
  async persistMediaLocally(tempUri: string, filename: string): Promise<string> {
    if (Platform.OS === 'web' || !FileSystem.documentDirectory) {
      return tempUri;
    }
    const dir = FileSystem.documentDirectory + 'offline_media/';
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
    const safeName = Date.now() + '_' + filename.replace(/[^A-Za-z0-9._-]/g, '_');
    const destUri = dir + safeName;
    await FileSystem.copyAsync({ from: tempUri, to: destUri });
    return destUri;
  }

  /**
   * Optimistic UI : écrit immédiatement en base locale (statut PENDING/UPLOADING)
   * et déclenche le worker de synchronisation si le réseau est disponible.
   */
  async sendMessageOptimistic(input: {
    roomId: string;
    content: string;
    type?: MessageContentType;
    localMediaUri?: string | null;
    mediaMeta?: { filename: string; mimeType: string; kind: 'AUDIO' | 'IMAGE' | 'DOCUMENT'; sizeBytes: number };
  }): Promise<LocalMessage> {
    const userId = useAuthStore.getState().user?.id ?? 'local-user';
    let persistedUri = input.localMediaUri ?? null;
    if (persistedUri && input.mediaMeta) {
      persistedUri = await this.persistMediaLocally(persistedUri, input.mediaMeta.filename);
    }

    const msg = await localDb.enqueueOptimisticMessage({
      roomId: input.roomId,
      senderId: userId,
      type: input.type ?? (input.mediaMeta?.kind ?? 'TEXT'),
      content: input.content,
      localMediaUri: persistedUri,
      mediaMeta: input.mediaMeta,
    });

    if (this.isOnline) {
      void this.triggerSync();
    }
    return msg;
  }

  async triggerSync(): Promise<void> {
    if (this.isSyncing || !this.isOnline) return;
    if (useAuthStore.getState().status !== 'authenticated') return;

    this.isSyncing = true;
    this.emitStatus();
    try {
      await this.processMediaUploadQueue();
      await this.processOutboxQueueFifo();
      // Écritures métier faites hors ligne (exploitations, parcelles, récoltes…).
      await rejouerEcritures();
      await this.pullServerDelta();
    } catch (err) {
      // Un échec de tirage (réseau, serveur) ne doit pas devenir un rejet non géré :
      // il sera retenté au prochain déclenchement (réseau, premier plan, minuterie).
      console.warn('[sync] tirage différé en échec :', err instanceof Error ? err.message : err);
    } finally {
      this.isSyncing = false;
      this.emitStatus();
      this.scheduleNextRetryIfNeeded();
    }
  }

  /**
   * Pipeline Médias : upload vers URL pré-signée R2/S3 avant émission du message,
   * puis suppression du fichier temporaire local une fois confirmé.
   */
  private async processMediaUploadQueue(): Promise<void> {
    const pendingMedia = await localDb.getPendingMediaUploads();
    for (const item of pendingMedia) {
      if (!this.isOnline) break;
      try {
        const presign = await api.post<{ media: { id: string; publicUrl?: string; storageKey: string }; uploadUrl: string }>(
          '/media/upload-url',
          { filename: item.filename, mimeType: item.mime_type, sizeBytes: item.size_bytes, kind: item.kind },
        );

        const fileResp = await fetch(item.local_uri);
        const blob = await fileResp.blob();
        const putRes = await fetch(presign.data.uploadUrl, {
          method: 'PUT',
          body: blob,
          headers: { 'Content-Type': item.mime_type },
        });
        if (!putRes.ok) throw new Error('Échec upload média R2 (' + putRes.status + ')');

        const confirmed = await api.post<{ publicUrl?: string; storageKey: string }>('/media/' + presign.data.media.id + '/confirm');
        // A3 : le serveur n'accepte QUE la clé de stockage (une URL, même
        // publique, est refusée « external_url_refused »). Jamais publicUrl.
        const remoteUrl = confirmed.data.storageKey || presign.data.media.storageKey;

        await localDb.markMediaUploaded(item.local_temp_id, remoteUrl);
        // Le fichier local est CONSERVÉ : photo et note vocale restent
        // lisibles hors ligne sur l'appareil de l'expéditeur.
      } catch (err) {
        const nextRetry = item.retry_count + 1;
        const backoff = computeExponentialBackoffMs(nextRetry);
        await localDb.markOutboxRetry(item.local_temp_id, nextRetry, Date.now() + backoff, err instanceof Error ? err.message : 'Erreur média');
      }
    }
  }

  /**
   * Worker séquentiel FIFO : envoie chaque message en attente avec idempotence
   * via localTempId (Socket.IO send_message + ack, ou fallback REST).
   */
  private async processOutboxQueueFifo(): Promise<void> {
    const readyItems = await localDb.getReadyOutboxItems(Date.now());
    for (const item of readyItems) {
      if (!this.isOnline) break;
      const msg = await localDb.getMessageByTempId(item.local_temp_id);
      if (!msg) continue;
      if (msg.local_media_uri && !msg.remote_media_url) continue;

      try {
        const ack = await this.dispatchMessageIdempotent(msg);
        await localDb.markMessageSent(msg.local_temp_id, ack.serverId, ack.serverTimestamp);
      } catch (err) {
        const nextRetry = item.retry_count + 1;
        const backoff = computeExponentialBackoffMs(nextRetry);
        await localDb.markOutboxRetry(
          item.local_temp_id,
          nextRetry,
          Date.now() + backoff,
          err instanceof Error ? err.message : 'Échec réseau',
        );
      }
    }
  }

  private dispatchMessageIdempotent(msg: LocalMessage): Promise<{ serverId: string; serverTimestamp: number }> {
    const attachments = msg.remote_media_url ? [msg.remote_media_url] : [];
    const socket = (realtime as unknown as { socket?: { connected?: boolean; emit: (ev: string, data: unknown, cb: (ack: { ok?: boolean; serverId?: string; serverTimestamp?: number; error?: string }) => void) => void } }).socket;

    if (socket?.connected) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout ack Socket.IO')), 8000);
        socket.emit(
          'send_message',
          {
            localTempId: msg.local_temp_id,
            roomId: msg.room_id,
            content: msg.content,
            type: msg.type,
            attachments,
          },
          (ack) => {
            clearTimeout(timer);
            if (ack?.ok && ack.serverId) {
              resolve({ serverId: ack.serverId, serverTimestamp: ack.serverTimestamp ?? Date.now() });
            } else {
              reject(new Error(ack?.error || 'Ack refusé par le serveur'));
            }
          },
        );
      });
    }

    return api
      .post<{ id: string; createdAt?: string }>('/messaging/conversations/' + msg.room_id + '/messages', {
        localTempId: msg.local_temp_id,
        body: msg.content,
        attachments,
      })
      .then((res) => ({
        serverId: res.data.id,
        serverTimestamp: res.data.createdAt ? new Date(res.data.createdAt).getTime() : Date.now(),
      }));
  }

  /**
   * Delta Sync : ne télécharge que les créations, mises à jour et suppressions
   * survenues depuis lastPulledAt. OFF-1 : route `/messaging/sync` ;
   * OFF-6 : toutes les pages (`hasMore`), curseur enregistré après chaque page.
   */
  async pullServerDelta(): Promise<void> {
    if (!this.isOnline) return;
    const rooms = await localDb.getRooms();
    const roomIds = rooms.map((r) => r.id);
    await tirerToutesLesPages({
      tirer: async (lastPulledAt) =>
        (await api.post<ReponseTirage>(ROUTE_TIRAGE_MESSAGES, { lastPulledAt, roomIds })).data,
      appliquer: (page) => localDb.applyServerDelta(page),
      lireCurseur: async () => {
        const brut = await localDb.getMeta(LAST_PULLED_KEY);
        return brut ? Number(brut) : 0;
      },
      ecrireCurseur: (curseur) => localDb.setMeta(LAST_PULLED_KEY, String(curseur)),
    });
  }

  private scheduleNextRetryIfNeeded(): void {
if (this.retryTimer) {
clearTimeout(this.retryTimer);
this.retryTimer = null;
}
void localDb.getReadyOutboxItems(Date.now() + MAX_BACKOFF_MS).then((items) => {
if (items.length === 0 || !this.isOnline) return;
const earliest = Math.min(...items.map((i) => i.next_retry_at));
const delay = Math.max(1000, earliest - Date.now());
this.retryTimer = setTimeout(() => { void this.triggerSync(); }, delay);
});
}

  async syncNow(): Promise<void> {
    await this.triggerSync();
  }
  async sendTextMessage(input: { roomId: string; senderId: string; senderOrgId?: string | null; content: string }) {
    const msg = await localDb.enqueueOptimisticMessage({ ...input, type: 'TEXT' }); void this.triggerSync(); return msg;
  }
}
export const offlineSyncEngine = new OfflineSyncEngine();
