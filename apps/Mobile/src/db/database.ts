import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { CREATE_TABLES_SQL, DB_NAME } from './schema';
import type { LocalMessage, LocalRoom, MediaUploadQueueItem, MessageContentType, MessageSyncStatus, OutboxQueueItem } from './models';

export function generateUuidV4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

type DbListener = () => void;

class LocalCommsDatabase {
  private sqliteDb: SQLite.SQLiteDatabase | null = null;
  private initPromise: Promise<void> | null = null;
  private listeners = new Set<DbListener>();

  private memRooms = new Map<string, LocalRoom>();
  private memMessages = new Map<string, LocalMessage>();
  private memOutbox = new Map<string, OutboxQueueItem>();
  private memMedia = new Map<string, MediaUploadQueueItem>();
  private memMeta = new Map<string, string>();

  subscribe(listener: DbListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  notify(): void {
    this.listeners.forEach((fn) => {
      try { fn(); } catch { /* noop */ }
    });
  }

  async ensureInitialized(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      if (Platform.OS === 'web') {
        this.hydrateWebStorage();
        return;
      }
      this.sqliteDb = await SQLite.openDatabaseAsync(DB_NAME);
      await this.sqliteDb.execAsync('PRAGMA journal_mode = WAL;');
      for (const sql of CREATE_TABLES_SQL) {
        await this.sqliteDb.execAsync(sql);
      }
    })();
    return this.initPromise;
  }

  private hydrateWebStorage(): void {
    try {
      const raw = typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage.getItem('ak_offline_db_v1') : null;
      if (!raw) return;
      const parsed = JSON.parse(raw) as { rooms?: LocalRoom[]; messages?: LocalMessage[]; outbox?: OutboxQueueItem[]; media?: MediaUploadQueueItem[]; meta?: Record<string, string> };
      parsed.rooms?.forEach((r) => this.memRooms.set(r.id, r));
      parsed.messages?.forEach((m) => this.memMessages.set(m.local_temp_id, m));
      parsed.outbox?.forEach((o) => this.memOutbox.set(o.local_temp_id, o));
      parsed.media?.forEach((mq) => this.memMedia.set(mq.local_temp_id, mq));
      if (parsed.meta) Object.entries(parsed.meta).forEach(([k, v]) => this.memMeta.set(k, v));
    } catch { /* noop */ }
  }

  private persistWebStorage(): void {
    if (Platform.OS !== 'web' || typeof globalThis.localStorage === 'undefined') return;
    try {
      globalThis.localStorage.setItem('ak_offline_db_v1', JSON.stringify({
        rooms: [...this.memRooms.values()],
        messages: [...this.memMessages.values()],
        outbox: [...this.memOutbox.values()],
        media: [...this.memMedia.values()],
        meta: Object.fromEntries(this.memMeta.entries()),
      }));
    } catch { /* noop */ }
  }

  async getMeta(key: string): Promise<string | null> {
    await this.ensureInitialized();
    if (!this.sqliteDb) return this.memMeta.get(key) ?? null;
    const row = await this.sqliteDb.getFirstAsync<{ value: string }>('SELECT value FROM sync_meta WHERE key = ?', [key]);
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.sqliteDb) {
      this.memMeta.set(key, value);
      this.persistWebStorage();
      return;
    }
    await this.sqliteDb.runAsync('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)', [key, value]);
  }

  async upsertRooms(rooms: LocalRoom[]): Promise<void> {
    if (rooms.length === 0) return;
    await this.ensureInitialized();
    if (!this.sqliteDb) {
      rooms.forEach((r) => this.memRooms.set(r.id, r));
      this.persistWebStorage();
      this.notify();
      return;
    }
    for (const r of rooms) {
      await this.sqliteDb.runAsync(
        `INSERT OR REPLACE INTO rooms (id, subject_type, subject_id, title, subtitle, avatar_url, admin_org_id, participant_org_ids, unread_count, last_message_body, last_message_at, status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.id, r.subject_type, r.subject_id, r.title, r.subtitle, r.avatar_url, r.admin_org_id, JSON.stringify(r.participant_org_ids), r.unread_count, r.last_message_body, r.last_message_at, r.status, r.updated_at],
      );
    }
    this.notify();
  }

  async getRooms(): Promise<LocalRoom[]> {
    await this.ensureInitialized();
    if (!this.sqliteDb) return [...this.memRooms.values()].sort((a, b) => b.updated_at - a.updated_at);
    const rows = await this.sqliteDb.getAllAsync<Omit<LocalRoom, 'participant_org_ids'> & { participant_org_ids: string }>(
      'SELECT * FROM rooms ORDER BY updated_at DESC',
    );
    return rows.map((r) => ({ ...r, participant_org_ids: JSON.parse(r.participant_org_ids || '[]') as string[] }));
  }

  async getMessagesByRoom(roomId: string): Promise<LocalMessage[]> {
    await this.ensureInitialized();
    if (!this.sqliteDb) {
      return [...this.memMessages.values()].filter((m) => m.room_id === roomId && m.deleted_at === null).sort((a, b) => a.created_at - b.created_at);
    }
    const rows = await this.sqliteDb.getAllAsync<Omit<LocalMessage, 'attachments' | 'read_by'> & { attachments: string; read_by: string }>(
      'SELECT * FROM messages WHERE room_id = ? AND deleted_at IS NULL ORDER BY created_at ASC',
      [roomId],
    );
    return rows.map((m) => ({ ...m, attachments: JSON.parse(m.attachments || '[]') as string[], read_by: JSON.parse(m.read_by || '[]') as string[] }));
  }

  async enqueueOptimisticMessage(input: {
    roomId: string;
    senderId: string;
    senderOrgId?: string | null;
    type: MessageContentType;
    content: string;
    localMediaUri?: string | null;
    mediaMeta?: { filename: string; mimeType: string; kind: 'AUDIO' | 'IMAGE' | 'DOCUMENT'; sizeBytes: number };
  }): Promise<LocalMessage> {
    await this.ensureInitialized();
    const now = Date.now();
    const localTempId = generateUuidV4();
    const hasMedia = Boolean(input.localMediaUri && input.mediaMeta);
    const initialStatus: MessageSyncStatus = hasMedia ? 'UPLOADING' : 'PENDING';

    const msg: LocalMessage = {
      id: localTempId,
      server_id: null,
      local_temp_id: localTempId,
      room_id: input.roomId,
      sender_id: input.senderId,
      sender_org_id: input.senderOrgId ?? null,
      type: input.type,
      content: input.content,
      local_media_uri: input.localMediaUri ?? null,
      remote_media_url: null,
      attachments: input.localMediaUri ? [input.localMediaUri] : [],
      read_by: [input.senderId],
      sync_status: initialStatus,
      retry_count: 0,
      error_message: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };

    const outboxItem: OutboxQueueItem = {
      id: generateUuidV4(),
      local_temp_id: localTempId,
      room_id: input.roomId,
      action_type: 'SEND_MESSAGE',
      payload_json: JSON.stringify({ roomId: input.roomId, content: input.content, type: input.type, localTempId }),
      status: initialStatus,
      retry_count: 0,
      next_retry_at: now,
      created_at: now,
    };

    if (!this.sqliteDb) {
      this.memMessages.set(localTempId, msg);
      this.memOutbox.set(localTempId, outboxItem);
      if (hasMedia && input.localMediaUri && input.mediaMeta) {
        this.memMedia.set(localTempId, {
          id: generateUuidV4(),
          local_temp_id: localTempId,
          room_id: input.roomId,
          local_uri: input.localMediaUri,
          filename: input.mediaMeta.filename,
          mime_type: input.mediaMeta.mimeType,
          kind: input.mediaMeta.kind,
          size_bytes: input.mediaMeta.sizeBytes,
          remote_url: null,
          status: 'PENDING',
          retry_count: 0,
          created_at: now,
        });
      }
      const existingRoom = this.memRooms.get(input.roomId);
      if (existingRoom) {
        this.memRooms.set(input.roomId, { ...existingRoom, last_message_body: input.content, last_message_at: now, updated_at: now });
      }
      this.persistWebStorage();
      this.notify();
      return msg;
    }

    await this.sqliteDb.runAsync(
      `INSERT INTO messages (id, server_id, local_temp_id, room_id, sender_id, sender_org_id, type, content, local_media_uri, remote_media_url, attachments, read_by, sync_status, retry_count, error_message, created_at, updated_at, deleted_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, NULL, ?, ?, NULL)`,
      [msg.id, msg.local_temp_id, msg.room_id, msg.sender_id, msg.sender_org_id, msg.type, msg.content, msg.local_media_uri, JSON.stringify(msg.attachments), JSON.stringify(msg.read_by), msg.sync_status, now, now],
    );

    await this.sqliteDb.runAsync(
      `INSERT INTO outbox_queue (id, local_temp_id, room_id, action_type, payload_json, status, retry_count, next_retry_at, created_at)
       VALUES (?, ?, ?, 'SEND_MESSAGE', ?, ?, 0, ?, ?)`,
      [outboxItem.id, outboxItem.local_temp_id, outboxItem.room_id, outboxItem.payload_json, outboxItem.status, now, now],
    );

    if (hasMedia && input.localMediaUri && input.mediaMeta) {
      await this.sqliteDb.runAsync(
        `INSERT INTO media_upload_queue (id, local_temp_id, room_id, local_uri, filename, mime_type, kind, size_bytes, remote_url, status, retry_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'PENDING', 0, ?)`,
        [generateUuidV4(), localTempId, input.roomId, input.localMediaUri, input.mediaMeta.filename, input.mediaMeta.mimeType, input.mediaMeta.kind, input.mediaMeta.sizeBytes, now],
      );
    }

    await this.sqliteDb.runAsync('UPDATE rooms SET last_message_body = ?, last_message_at = ?, updated_at = ? WHERE id = ?', [input.content, now, now, input.roomId]);
    this.notify();
    return msg;
  }

  async getPendingMediaUploads(): Promise<MediaUploadQueueItem[]> {
    await this.ensureInitialized();
    if (!this.sqliteDb) {
      return [...this.memMedia.values()].filter((m) => m.status === 'PENDING' || m.status === 'FAILED').sort((a, b) => a.created_at - b.created_at);
    }
    return this.sqliteDb.getAllAsync<MediaUploadQueueItem>("SELECT * FROM media_upload_queue WHERE status IN ('PENDING', 'FAILED') ORDER BY created_at ASC");
  }

  async markMediaUploaded(localTempId: string, remoteUrl: string): Promise<void> {
    await this.ensureInitialized();
    const now = Date.now();
    if (!this.sqliteDb) {
      this.memMedia.delete(localTempId);
      const m = this.memMessages.get(localTempId);
      if (m) this.memMessages.set(localTempId, { ...m, remote_media_url: remoteUrl, attachments: [remoteUrl], sync_status: 'PENDING', updated_at: now });
      const o = this.memOutbox.get(localTempId);
      if (o) this.memOutbox.set(localTempId, { ...o, status: 'PENDING', next_retry_at: now });
      this.persistWebStorage();
      this.notify();
      return;
    }
    await this.sqliteDb.runAsync('DELETE FROM media_upload_queue WHERE local_temp_id = ?', [localTempId]);
    await this.sqliteDb.runAsync("UPDATE messages SET remote_media_url = ?, attachments = ?, sync_status = 'PENDING', updated_at = ? WHERE local_temp_id = ?", [remoteUrl, JSON.stringify([remoteUrl]), now, localTempId]);
    await this.sqliteDb.runAsync("UPDATE outbox_queue SET status = 'PENDING', next_retry_at = ? WHERE local_temp_id = ?", [now, localTempId]);
    this.notify();
  }

  async getReadyOutboxItems(now = Date.now()): Promise<OutboxQueueItem[]> {
    await this.ensureInitialized();
    if (!this.sqliteDb) {
      return [...this.memOutbox.values()].filter((o) => (o.status === 'PENDING' || o.status === 'FAILED') && o.next_retry_at <= now).sort((a, b) => a.created_at - b.created_at);
    }
    return this.sqliteDb.getAllAsync<OutboxQueueItem>("SELECT * FROM outbox_queue WHERE status IN ('PENDING', 'FAILED') AND next_retry_at <= ? ORDER BY created_at ASC", [now]);
  }

  async getMessageByTempId(localTempId: string): Promise<LocalMessage | null> {
    await this.ensureInitialized();
    if (!this.sqliteDb) return this.memMessages.get(localTempId) ?? null;
    const row = await this.sqliteDb.getFirstAsync<Omit<LocalMessage, 'attachments' | 'read_by'> & { attachments: string; read_by: string }>(
      'SELECT * FROM messages WHERE local_temp_id = ?',
      [localTempId],
    );
    if (!row) return null;
    return { ...row, attachments: JSON.parse(row.attachments || '[]') as string[], read_by: JSON.parse(row.read_by || '[]') as string[] };
  }

  async markMessageSent(localTempId: string, serverId: string, serverTimestamp: number): Promise<void> {
    await this.ensureInitialized();
    if (!this.sqliteDb) {
      this.memOutbox.delete(localTempId);
      const m = this.memMessages.get(localTempId);
      if (m) this.memMessages.set(localTempId, { ...m, server_id: serverId, sync_status: 'SENT', error_message: null, updated_at: serverTimestamp });
      this.persistWebStorage();
      this.notify();
      return;
    }
    await this.sqliteDb.runAsync('DELETE FROM outbox_queue WHERE local_temp_id = ?', [localTempId]);
    await this.sqliteDb.runAsync("UPDATE messages SET server_id = ?, sync_status = 'SENT', error_message = NULL, updated_at = ? WHERE local_temp_id = ?", [serverId, serverTimestamp, localTempId]);
    this.notify();
  }

  async markOutboxRetry(localTempId: string, retryCount: number, nextRetryAt: number, errorMessage: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.sqliteDb) {
      const o = this.memOutbox.get(localTempId);
      if (o) this.memOutbox.set(localTempId, { ...o, status: 'FAILED', retry_count: retryCount, next_retry_at: nextRetryAt });
      const m = this.memMessages.get(localTempId);
      if (m) this.memMessages.set(localTempId, { ...m, sync_status: 'FAILED', retry_count: retryCount, error_message: errorMessage });
      this.persistWebStorage();
      this.notify();
      return;
    }
    await this.sqliteDb.runAsync("UPDATE outbox_queue SET status = 'FAILED', retry_count = ?, next_retry_at = ? WHERE local_temp_id = ?", [retryCount, nextRetryAt, localTempId]);
    await this.sqliteDb.runAsync("UPDATE messages SET sync_status = 'FAILED', retry_count = ?, error_message = ? WHERE local_temp_id = ?", [retryCount, errorMessage, localTempId]);
    this.notify();
  }

  async applyServerDelta(payload: { created?: LocalMessage[]; updated?: LocalMessage[]; deleted?: string[] }): Promise<void> {
    await this.ensureInitialized();
    const incoming = [...(payload.created ?? []), ...(payload.updated ?? [])];
    const deletedIds = payload.deleted ?? [];

    if (!this.sqliteDb) {
      for (const m of incoming) {
        const key = m.local_temp_id || m.server_id || m.id;
        this.memMessages.set(key, { ...m, local_temp_id: key, server_id: m.server_id ?? m.id, sync_status: 'SENT' });
      }
      for (const delId of deletedIds) {
        for (const [k, msg] of this.memMessages.entries()) {
          if (msg.id === delId || msg.server_id === delId) this.memMessages.set(k, { ...msg, deleted_at: Date.now() });
        }
      }
      this.persistWebStorage();
      this.notify();
      return;
    }

    for (const m of incoming) {
      const key = m.local_temp_id || m.server_id || m.id;
      await this.sqliteDb.runAsync(
        `INSERT INTO messages (id, server_id, local_temp_id, room_id, sender_id, sender_org_id, type, content, local_media_uri, remote_media_url, attachments, read_by, sync_status, retry_count, error_message, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'SENT', 0, NULL, ?, ?, ?) ON CONFLICT(local_temp_id) DO UPDATE SET server_id = excluded.server_id, content = excluded.content, remote_media_url = excluded.remote_media_url, attachments = excluded.attachments, read_by = excluded.read_by, sync_status = 'SENT', updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`,
[m.id, m.server_id ?? m.id, key, m.room_id, m.sender_id, m.sender_org_id, m.type ?? 'TEXT', m.content, m.remote_media_url ?? null, JSON.stringify(m.attachments ?? []), JSON.stringify(m.read_by ?? []), m.created_at, m.updated_at, m.deleted_at ?? null],
);
}
for (const delId of deletedIds) {
await this.sqliteDb.runAsync('UPDATE messages SET deleted_at = ? WHERE id = ? OR server_id = ?', [Date.now(), delId, delId]);
}
this.notify();
}
}
export const localDb = new LocalCommsDatabase();
