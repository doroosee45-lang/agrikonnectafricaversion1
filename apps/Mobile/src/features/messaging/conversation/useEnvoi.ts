import { useCallback, useEffect, useRef } from 'react';

import * as FileSystem from 'expo-file-system/legacy';

import { localDb } from '@/db/database';
import { offlineSyncEngine } from '@/services/OfflineSyncEngine';
import { realtime } from '@/services/realtime';
import { useAuthStore } from '@/store/auth';

import { corpsParcelle, corpsPosition, mimeDepuisNom, MIMES_ACCEPTES, TAILLE_MAX_MEDIA, type Parcelle, type Position } from './messageContent';

export type GenreMedia = 'IMAGE' | 'AUDIO' | 'DOCUMENT';

export class ErreurMedia extends Error {
  constructor(public readonly code: 'TROP_VOLUMINEUX' | 'TYPE_REFUSE') {
    super(code);
  }
}

/**
 * Envois de l'écran de discussion. TOUS passent par la file hors ligne :
 * le message apparaît immédiatement (« en attente »), puis part dès que le
 * réseau est là (médias : téléversement d'abord, message ensuite). Le renvoi
 * est idempotent (identifiant local = identifiant serveur).
 */
export function useEnvoi(conversationId: string) {
  const moi = useAuthStore((s) => s.user?.id ?? 'local-user');
  const ecritEnCours = useRef(false);
  const arret = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arreterFrappe = useCallback(() => {
    if (arret.current) clearTimeout(arret.current);
    arret.current = null;
    if (ecritEnCours.current) {
      ecritEnCours.current = false;
      realtime.setTyping(conversationId, false);
    }
  }, [conversationId]);

  /** « En train d'écrire… » : un signal au début, arrêt après 4 s sans frappe. */
  const signalerFrappe = useCallback(() => {
    if (!ecritEnCours.current) {
      ecritEnCours.current = true;
      realtime.setTyping(conversationId, true);
    }
    if (arret.current) clearTimeout(arret.current);
    arret.current = setTimeout(arreterFrappe, 4000);
  }, [conversationId, arreterFrappe]);

  useEffect(() => arreterFrappe, [arreterFrappe]);

  const envoyerTexte = useCallback(
    async (texte: string) => {
      const contenu = texte.trim();
      if (!contenu) return;
      arreterFrappe();
      await offlineSyncEngine.sendTextMessage({ roomId: conversationId, senderId: moi, content: contenu.slice(0, 3000) });
    },
    [conversationId, moi, arreterFrappe],
  );

  const envoyerMedia = useCallback(
    async ({ uri, nom, taille, genre, corps, mime: mimeConnu }: { uri: string; nom: string; taille: number; genre: GenreMedia; corps: string; mime?: string }) => {
      const mime = mimeConnu && MIMES_ACCEPTES[mimeConnu] ? mimeConnu : mimeDepuisNom(nom);
      if (!mime) throw new ErreurMedia('TYPE_REFUSE');
      // Le serveur exige la taille réelle (> 0) : lue sur le disque si le sélecteur ne la donne pas.
      let octets = taille;
      if (!octets || octets <= 0) {
        const info = await FileSystem.getInfoAsync(uri);
        octets = info.exists && 'size' in info ? info.size : 0;
      }
      if (!octets) throw new ErreurMedia('TYPE_REFUSE');
      if (octets > TAILLE_MAX_MEDIA) throw new ErreurMedia('TROP_VOLUMINEUX');
      await offlineSyncEngine.sendMessageOptimistic({
        roomId: conversationId,
        content: corps,
        type: genre,
        localMediaUri: uri,
        mediaMeta: { filename: nom, mimeType: mime, kind: genre, sizeBytes: octets },
      });
    },
    [conversationId],
  );

  const envoyerPosition = useCallback(
    (position: Position) => offlineSyncEngine.sendTextMessage({ roomId: conversationId, senderId: moi, content: corpsPosition(position) }),
    [conversationId, moi],
  );

  const envoyerParcelle = useCallback(
    (parcelle: Parcelle) => offlineSyncEngine.sendTextMessage({ roomId: conversationId, senderId: moi, content: corpsParcelle(parcelle) }),
    [conversationId, moi],
  );

  const renvoyer = useCallback(async (localTempId: string) => {
    await localDb.retryNow(localTempId);
    void offlineSyncEngine.syncNow();
  }, []);

  return { envoyerTexte, envoyerMedia, envoyerPosition, envoyerParcelle, renvoyer, signalerFrappe, arreterFrappe };
}
