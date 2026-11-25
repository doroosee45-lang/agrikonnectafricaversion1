import { io, type Socket } from 'socket.io-client';

import { REALTIME_URL } from '@/lib/config';
import { queryClient, queryKeys } from '@/services/query';

import { sessionStore } from './api/session';

/**
 * Temps réel Socket.IO.
 *
 * Contrat serveur (`backend/src/realtime/index.js` + `bus.js`) :
 * - chemin `/realtime`, authentification par `handshake.auth.token` (aucun accès
 *   anonyme), payload ≤ 100 ko ;
 * - le serveur ne pousse que des identifiants et des statuts : le détail est
 *   toujours rechargé via l'API (d'où les invalidations ci-dessous) ;
 * - événements réellement émis : `ready`, `typing`, `message:new`,
 *   `message:read`, `conversation:new`, `conversation:blocked`, `order:new`,
 *   `order:updated`, `order:disputed`, `call:incoming`, `call:updated` (appels
 *   audio : seulement des identifiants et statuts, l'état est relu via l'API).
 */

export interface RealtimeEvent {
  at: string;
  [key: string]: unknown;
}

type Listener = (payload: RealtimeEvent) => void;

let socket: Socket | null = null;
/** Utilisateur du socket (événement serveur `ready`) : sert à ne pas acquitter ses propres messages. */
let utilisateurSocket: string | null = null;
const listeners = new Map<string, Set<Listener>>();

export const REALTIME_EVENTS = [
  'ready',
  'typing',
  'message:new',
  'message:read',
  'message:delivered',
  'presence:update',
  'conversation:new',
  'conversation:blocked',
  'order:new',
  'order:updated',
  'order:disputed',
  'notification:new',
  'alert:new',
  'call:incoming',
  'call:updated',
] as const;

export type RealtimeEventName = (typeof REALTIME_EVENTS)[number];

function emitLocal(event: RealtimeEventName, payload: RealtimeEvent) {
  listeners.get(event)?.forEach((listener) => listener(payload));
}

export const realtime = {
  get connected(): boolean {
    return Boolean(socket?.connected);
  },

  /** Connexion idempotente : appelée après le login et au retour au premier plan. */
  connect(): void {
    const token = sessionStore.accessToken;
    if (!token || socket?.connected) return;

    if (socket) {
      socket.auth = { token };
      socket.connect();
      return;
    }

    socket = io(REALTIME_URL, {
      path: '/realtime',
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1_500,
      reconnectionDelayMax: 15_000,
    });

    // Un événement serveur invalide le cache concerné : l'UI recharge la donnée
    // fraîche plutôt que de faire confiance au payload poussé.
    socket.on('message:new', (payload: RealtimeEvent) => {
      // Accusé de RÉCEPTION dès l'arrivée sur l'appareil, écran ouvert ou non (coches ✓✓ grises).
      const recu = payload.message as { id?: unknown; senderId?: unknown } | undefined;
      if (
        typeof payload.conversationId === 'string' &&
        typeof recu?.id === 'string' &&
        utilisateurSocket &&
        recu.senderId !== utilisateurSocket
      ) {
        socket?.emit('message:delivered', { conversationId: payload.conversationId, messageIds: [recu.id] });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.messaging.conversations });
      if (typeof payload.conversationId === 'string') {
        queryClient.invalidateQueries({
          queryKey: queryKeys.messaging.messages(payload.conversationId),
        });
      }
      emitLocal('message:new', payload);
    });

    socket.on('message:read', (payload: RealtimeEvent) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.messaging.conversations });
      emitLocal('message:read', payload);
    });

    socket.on('conversation:new', (payload: RealtimeEvent) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.messaging.conversations });
      emitLocal('conversation:new', payload);
    });

    socket.on('conversation:blocked', (payload: RealtimeEvent) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.messaging.conversations });
      emitLocal('conversation:blocked', payload);
    });

    for (const event of ['order:new', 'order:updated', 'order:disputed'] as const) {
      socket.on(event, (payload: RealtimeEvent) => {
        queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
        emitLocal(event, payload);
      });
    }

    socket.on('notification:new', (payload: RealtimeEvent) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
      emitLocal('notification:new', payload);
    });

    socket.on('alert:new', (payload: RealtimeEvent) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
      emitLocal('alert:new', payload);
    });

    socket.on('call:incoming', (payload: RealtimeEvent) => emitLocal('call:incoming', payload));
    socket.on('call:updated', (payload: RealtimeEvent) => emitLocal('call:updated', payload));

    socket.on('ready', (payload: RealtimeEvent) => {
      if (typeof payload.userId === 'string') utilisateurSocket = payload.userId;
      emitLocal('ready', payload);
    });
    socket.on('typing', (payload: RealtimeEvent) => emitLocal('typing', payload));
    socket.on('message:delivered', (payload: RealtimeEvent) => emitLocal('message:delivered', payload));
    socket.on('presence:update', (payload: RealtimeEvent) => emitLocal('presence:update', payload));
    // Reconnexion : l'écran ouvert relit la présence et resynchronise.
    socket.on('connect', () => emitLocal('ready', {} as RealtimeEvent));
  },

  disconnect(): void {
    utilisateurSocket = null;
    socket?.disconnect();
    socket?.removeAllListeners();
    socket = null;
  },

  on(event: RealtimeEventName, listener: Listener): () => void {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(listener);
    return () => listeners.get(event)?.delete(listener);
  },

  /** Indicateur de saisie : accepté par le serveur uniquement dans nos fils. */
  setTyping(conversationId: string, isTyping: boolean): void {
    socket?.emit('typing', { conversationId, isTyping });
  },

  /** Accusé de RÉCEPTION des messages arrivés sur cet appareil (coches ✓✓ de l'expéditeur). */
  sendDelivered(conversationId: string, messageIds: string[]): void {
    if (messageIds.length === 0) return;
    socket?.emit('message:delivered', { conversationId, messageIds: messageIds.slice(0, 100) });
  },

  /** Présence des interlocuteurs d'un fil (« En ligne » / « Vu récemment »). Null hors ligne. */
  queryPresence(conversationId: string): Promise<Array<{ organizationId: string; online: boolean; lastSeenAt: string | null }> | null> {
    const s = socket;
    if (!s?.connected) return Promise.resolve(null);
    return new Promise((resolve) => {
      const delai = setTimeout(() => resolve(null), 5000);
      s.emit('presence:query', { conversationId }, (reponse: { ok?: boolean; presence?: Array<{ organizationId: string; online: boolean; lastSeenAt: string | null }> }) => {
        clearTimeout(delai);
        resolve(reponse?.ok ? reponse.presence ?? [] : null);
      });
    });
  },

  /** Rejoint un fil ouvert après la connexion (nouvelle commande, par exemple). */
  joinConversation(conversationId: string): void {
    socket?.emit('conversation:join', { conversationId });
  },
};
