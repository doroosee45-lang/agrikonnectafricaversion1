import { logger } from '../shared/http/logger.js';

/**
 * Bus temps réel (Socket.IO) — CDC V2 §8.7.
 *
 * Les services publient des événements métier (`order.updated`,
 * `message.new`, `notification.new`) sans connaître le transport. Si le
 * serveur Socket.IO n'est pas monté (tests, scripts, démarrage partiel),
 * l'émission est simplement ignorée : l'API REST reste la source de vérité.
 */

let io = null;

export const setIo = (instance) => {
  io = instance;
};

export const getIo = () => io;

export const roomForOrganization = (organizationId) => `org:${organizationId}`;
export const roomForConversation = (conversationId) => `conversation:${conversationId}`;
export const roomForUser = (userId) => `user:${userId}`;

/**
 * Émet vers toutes les sessions d'une organisation.
 * Aucune donnée sensible n'est poussée : uniquement des identifiants et des
 * statuts, le client recharge le détail via l'API.
 */
export const emitToOrganization = (organizationId, event, payload) => {
  if (!io || !organizationId) return false;
  io.to(roomForOrganization(organizationId)).emit(event, { ...payload, at: new Date().toISOString() });
  return true;
};

export const emitToConversation = (conversationId, event, payload) => {
  if (!io || !conversationId) return false;
  io.to(roomForConversation(conversationId)).emit(event, { ...payload, at: new Date().toISOString() });
  return true;
};

export const emitToUser = (userId, event, payload) => {
  if (!io || !userId) return false;
  io.to(roomForUser(userId)).emit(event, { ...payload, at: new Date().toISOString() });
  return true;
};

/** Émission multi-organisations (les deux parties d'une commande). */
export const emitToOrganizations = (organizationIds, event, payload) => {
  const sent = (organizationIds ?? []).filter(Boolean).map((id) => emitToOrganization(id, event, payload));
  return sent.some(Boolean);
};

/**
 * Retire du fil les sessions d'une organisation qui n'en fait plus partie.
 *
 * Un socket rejoint la room d'un fil à la connexion ; sans ce retrait, une
 * organisation exclue d'un groupe continuait de recevoir les nouveaux messages
 * jusqu'à sa déconnexion. Un socket qui appartient AUSSI à une organisation
 * encore participante reste dans la room (il y a toujours droit).
 */
export const retirerOrganisationDuFil = async (conversationId, organizationId, participantsRestants = []) => {
  if (!io || !conversationId || !organizationId) return 0;
  try {
    const sockets = await io.in(roomForOrganization(organizationId)).fetchSockets();
    let retires = 0;
    for (const socket of sockets) {
      const organisations = socket.data?.organizationIds ?? [];
      if (organisations.some((id) => participantsRestants.includes(id))) continue;
      socket.leave(roomForConversation(conversationId));
      socket.data?.conversationIds?.delete?.(conversationId);
      retires += 1;
    }
    io.to(roomForOrganization(organizationId)).emit('conversation:removed', {
      conversationId,
      at: new Date().toISOString(),
    });
    return retires;
  } catch (error) {
    logger.warn(`[realtime] retrait du fil ${conversationId} impossible :`, error.message);
    return 0;
  }
};

export const realtimeStats = () => ({
  enabled: Boolean(io),
  connections: io?.engine?.clientsCount ?? 0,
  rooms: io?.sockets?.adapter?.rooms?.size ?? 0,
});

export const logRealtime = (message) => logger.info(`[realtime] ${message}`);
