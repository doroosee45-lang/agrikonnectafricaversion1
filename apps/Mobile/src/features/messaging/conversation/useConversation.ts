import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { localDb } from '@/db/database';
import type { LocalMessage } from '@/db/models';
import { useI18n } from '@/i18n';
import { offlineSyncEngine } from '@/services/OfflineSyncEngine';
import { realtime } from '@/services/realtime';
import { useAuthStore } from '@/store/auth';

import {
  appelsEnCache,
  chargerAppels,
  chargerFiche,
  ficheEnCache,
  tirerPageServeur,
  type FicheConversation,
} from './conversationApi';
import { aAcquitter, construireFil, type AppelFil, type ElementFil } from './timeline';

/** Taille d'une page locale (ouverture instantanée) et pas de chargement vers le haut. */
export const PAGE_LOCALE = 40;

export interface Presence {
  enLigne: boolean;
  vuA: string | null;
}

/**
 * État complet de l'écran de discussion.
 *
 * - Source unique : SQLite. L'écran s'ouvre sur les 40 derniers messages
 *   locaux, sans attendre le réseau ; le défilement vers le haut agrandit la
 *   fenêtre locale, puis tire les pages plus anciennes du serveur.
 * - En ligne : page serveur la plus récente (accusés de lecture + URL signées),
 *   synchronisation de la file d'envoi, historique des appels, fiche contact.
 * - Temps réel : nouveaux messages, « en train d'écrire », lecture (coches
 *   vertes), réception (coches grises), présence.
 */
export function useConversation(conversationId: string) {
  const { locale } = useI18n();
  const moi = useAuthStore((s) => s.user?.id ?? 'local-user');

  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [limite, setLimite] = useState(PAGE_LOCALE);
  const [appels, setAppels] = useState<AppelFil[]>([]);
  const [fiche, setFiche] = useState<FicheConversation | null>(null);
  const [presence, setPresence] = useState<Presence | null>(null);
  const [ecrit, setEcrit] = useState(false);
  const [recus, setRecus] = useState<Set<string>>(new Set());
  const [chargementAncien, setChargementAncien] = useState(false);
  const serveurEpuise = useRef(false);
  const curseurServeur = useRef<string | null>(null);
  const dejaAcquittes = useRef(new Set<string>());

  /* ───── lecture locale ───── */
  const relire = useCallback(async () => {
    const lignes = await localDb.getLatestMessages(conversationId, limite);
    setMessages(lignes);
    const ids = lignes.filter((m) => m.sender_id === moi && m.server_id).map((m) => m.server_id as string);
    setRecus(await localDb.getDeliveredIds(ids));
  }, [conversationId, limite, moi]);

  useEffect(() => {
    void relire();
    return localDb.subscribe(() => { void relire(); });
  }, [relire]);

  /* ───── réseau : page récente, file d'envoi, appels, fiche ───── */
  const rafraichir = useCallback(async () => {
    void offlineSyncEngine.syncNow();
    try {
      const page = await tirerPageServeur(conversationId);
      if (curseurServeur.current === null) curseurServeur.current = page.nextCursor;
      if (!page.hasMore) serveurEpuise.current = true;
    } catch {
      /* hors ligne : affichage local */
    }
    setAppels(await chargerAppels(conversationId));
  }, [conversationId]);

  useEffect(() => {
    let actif = true;
    void (async () => {
      const [ficheLocale, appelsLocaux] = await Promise.all([ficheEnCache(conversationId), appelsEnCache(conversationId)]);
      if (!actif) return;
      if (ficheLocale) setFiche(ficheLocale);
      setAppels(appelsLocaux);
      const ficheFraiche = await chargerFiche(conversationId);
      if (actif && ficheFraiche) setFiche(ficheFraiche);
    })();
    void rafraichir();
    const sub = AppState.addEventListener('change', (etat) => {
      if (etat === 'active') void rafraichir();
    });
    return () => {
      actif = false;
      sub.remove();
    };
  }, [conversationId, rafraichir]);

  /* ───── présence ───── */
  const lirePresence = useCallback(async () => {
    const r = await realtime.queryPresence(conversationId);
    if (!r || r.length === 0) {
      setPresence(null);
      return;
    }
    const enLigne = r.some((p) => p.online);
    const derniere = r.map((p) => p.lastSeenAt).filter(Boolean).sort().at(-1) ?? null;
    setPresence({ enLigne, vuA: enLigne ? null : derniere });
  }, [conversationId]);

  useEffect(() => {
    void lirePresence();
    const minuterie = setInterval(() => { void lirePresence(); }, 30_000);
    return () => clearInterval(minuterie);
  }, [lirePresence]);

  /* ───── temps réel ───── */
  useEffect(() => {
    let finFrappe: ReturnType<typeof setTimeout> | null = null;
    const pourCeFil = (p: Record<string, unknown>) => p.conversationId === conversationId;
    const nettoyages = [
      realtime.on('message:new', (p) => {
        if (!pourCeFil(p)) return;
        setEcrit(false);
        // Lecture immédiate (l'écran est ouvert) : page serveur = accusé « lu ».
        void rafraichir();
      }),
      realtime.on('typing', (p) => {
        if (!pourCeFil(p) || p.userId === moi) return;
        setEcrit(Boolean(p.isTyping));
        if (finFrappe) clearTimeout(finFrappe);
        // Filet : sans signal d'arrêt, l'indicateur s'éteint seul.
        if (p.isTyping) finFrappe = setTimeout(() => setEcrit(false), 6000);
      }),
      realtime.on('message:read', (p) => {
        if (!pourCeFil(p) || typeof p.userId !== 'string' || p.userId === moi) return;
        void localDb.markReadByPeer(conversationId, p.userId, moi);
      }),
      realtime.on('message:delivered', (p) => {
        if (!pourCeFil(p) || p.userId === moi || !Array.isArray(p.messageIds)) return;
        void localDb.markDelivered(p.messageIds.filter((id): id is string => typeof id === 'string'));
      }),
      realtime.on('presence:update', (p) => {
        if (pourCeFil(p)) void lirePresence();
      }),
      realtime.on('call:updated', (p) => {
        if (pourCeFil(p) || p.conversationId === undefined) void chargerAppels(conversationId).then(setAppels);
      }),
      realtime.on('ready', () => {
        void lirePresence();
        void rafraichir();
      }),
    ];
    return () => {
      if (finFrappe) clearTimeout(finFrappe);
      nettoyages.forEach((retirer) => retirer());
    };
  }, [conversationId, moi, rafraichir, lirePresence]);

  /* ───── accusés de réception des messages reçus ───── */
  useEffect(() => {
    const nouveaux = aAcquitter(messages, moi).filter((id) => !dejaAcquittes.current.has(id));
    if (nouveaux.length === 0 || !realtime.connected) return;
    nouveaux.forEach((id) => dejaAcquittes.current.add(id));
    realtime.sendDelivered(conversationId, nouveaux);
  }, [messages, moi, conversationId]);

  /* ───── pagination vers le haut ───── */
  const chargerPlusAnciens = useCallback(async () => {
    if (chargementAncien) return;
    if (messages.length >= limite) {
      setLimite((l) => l + PAGE_LOCALE);
      return;
    }
    // Fenêtre locale épuisée : pages plus anciennes du serveur.
    if (serveurEpuise.current || !curseurServeur.current) return;
    setChargementAncien(true);
    try {
      const page = await tirerPageServeur(conversationId, curseurServeur.current);
      curseurServeur.current = page.nextCursor;
      serveurEpuise.current = !page.hasMore;
      setLimite((l) => l + page.recus.length);
    } catch {
      /* hors ligne */
    } finally {
      setChargementAncien(false);
    }
  }, [chargementAncien, messages.length, limite, conversationId]);

  const fil: ElementFil[] = useMemo(
    () => construireFil(messages, appels, { moi, maintenant: Date.now(), recus, locale: locale === 'en' ? 'en' : 'fr' }),
    [messages, appels, moi, recus, locale],
  );

  return { fil, fiche, presence, ecrit, chargementAncien, chargerPlusAnciens, moi };
}
