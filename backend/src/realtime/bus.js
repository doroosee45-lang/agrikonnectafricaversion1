import { createHash } from 'node:crypto';
import { logger } from '../shared/http/logger.js';
import { prisma } from '../config/prisma.js';
import { can } from '../shared/permissions.js';
import { rolesEffectifs } from '../middleware/tenant.js';

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

/* ════════════════════ Révocation des droits sur les sockets (W11, W12, W13) ════════════════════
 *
 * Quatre situations, quatre comportements :
 *  - DÉCONNEXION d'une session (`POST /auth/logout`) : coupure des seuls sockets
 *    ouverts avec CE jeton (les autres appareils restent connectés) ;
 *  - COMPTE INACTIF (suspension, suppression, déconnexion forcée) : coupure de
 *    TOUS les sockets de l'utilisateur ; la reconnexion est refusée tant que le
 *    profil n'est pas ACTIF ;
 *  - DROITS RÉDUITS (rôle retiré, adhésion retirée) : SANS coupure, sortie des
 *    rooms d'organisation et de fil qui ne sont plus autorisées. Les clients ne
 *    se reconnectent pas après une coupure décidée par le serveur : couper
 *    priverait un utilisateur légitime de tout le temps réel ;
 *  - EXPIRATION du jeton : AUCUNE coupure à ce stade (décision d'architecture :
 *    pas avant adaptation des clients Web et Mobile). Comptée dans les stats.
 *
 * Immédiat : appelé par les services après l'écriture, sur l'instance qui traite
 * la requête. Filet périodique (`realtime/index.js`) : mêmes règles, sur chaque
 * instance, pour ses propres sockets. Il couvre le multi-instances sans
 * adaptateur et les modifications faites hors API. Délai maximal = intervalle.
 */

export const MOTIFS_REVOCATION = Object.freeze({
  DECONNEXION: 'LOGOUT',
  DECONNEXION_FORCEE: 'SESSIONS_REVOKED',
  COMPTE_INACTIF: 'ACCOUNT_INACTIVE',
});

/** Empreinte du jeton d'un socket (on ne conserve jamais le jeton lui-même). */
export const empreinteJeton = (jeton) => createHash('sha256').update(String(jeton ?? '')).digest('hex');

const couper = (socket, motif) => {
  socket.emit('session:revoked', { reason: motif, at: new Date().toISOString() });
  socket.disconnect(true);
};

/** Organisations dont les adhésions ACTIVES donnent le droit de LIRE la messagerie. */
const organisationsLisibles = (memberships = []) => {
  const tousRoles = [...new Set(memberships.flatMap((m) => m.roles ?? []))];
  return memberships
    .filter((m) => can(rolesEffectifs(m.roles ?? [], tousRoles), 'messages.read'))
    .map((m) => m.organizationId);
};

/**
 * Applique les droits ACTUELS d'un utilisateur à ses sockets.
 * `profil` : profil avec adhésions actives (ou null s'il n'existe plus).
 * Renvoie { coupes, rooms } : sockets coupés, rooms quittées.
 */
export const appliquerDroits = async (profil, sockets) => {
  const bilan = { coupes: 0, rooms: 0 };
  if (!sockets.length) return bilan;
  if (!profil || profil.status !== 'ACTIVE') {
    sockets.forEach((s) => couper(s, MOTIFS_REVOCATION.COMPTE_INACTIF));
    bilan.coupes = sockets.length;
    return bilan;
  }
  const autorisees = organisationsLisibles(profil.memberships);
  const fils = [...new Set(sockets.flatMap((s) => [...s.rooms]
    .filter((r) => r.startsWith('conversation:'))
    .map((r) => r.slice('conversation:'.length))))];
  const participants = fils.length
    ? new Map(
        (await prisma.conversation.findMany({ where: { id: { in: fils } }, select: { id: true, participantOrgIds: true } }))
          .map((c) => [c.id, c.participantOrgIds]),
      )
    : new Map();
  for (const socket of sockets) {
    for (const room of [...socket.rooms]) {
      const orgRetiree = room.startsWith('org:') && !autorisees.includes(room.slice('org:'.length));
      const filId = room.startsWith('conversation:') ? room.slice('conversation:'.length) : null;
      const filRetire = filId !== null && !(participants.get(filId) ?? []).some((id) => autorisees.includes(id));
      if (orgRetiree || filRetire) {
        socket.leave(room);
        if (filRetire) socket.data?.conversationIds?.delete?.(filId);
        bilan.rooms += 1;
      }
    }
    if (socket.data) socket.data.organizationIds = autorisees;
  }
  return bilan;
};

const chargerProfils = (userIds) =>
  prisma.profile.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      status: true,
      memberships: {
        where: { status: 'ACTIVE', organization: { deletedAt: null } },
        select: { organizationId: true, roles: true },
      },
    },
  });

/** Révocation immédiate : compte inactif ou déconnexion forcée, coupure de tous ses sockets. */
export const revoquerSessionsUtilisateur = async (userId, motif = MOTIFS_REVOCATION.COMPTE_INACTIF) => {
  if (!io || !userId) return 0;
  try {
    const sockets = await io.in(roomForUser(userId)).fetchSockets();
    sockets.forEach((s) => couper(s, motif));
    return sockets.length;
  } catch (error) {
    logger.warn(`[realtime] révocation des sessions de ${userId} impossible :`, error.message);
    return 0;
  }
};

/** Révocation immédiate : déconnexion d'UNE session, coupure des seuls sockets ouverts avec ce jeton. */
export const revoquerSessionJeton = async (userId, jeton) => {
  if (!io || !userId || !jeton) return 0;
  try {
    const empreinte = empreinteJeton(jeton);
    const sockets = (await io.in(roomForUser(userId)).fetchSockets()).filter((s) => s.data?.jetonEmpreinte === empreinte);
    sockets.forEach((s) => couper(s, MOTIFS_REVOCATION.DECONNEXION));
    return sockets.length;
  } catch (error) {
    logger.warn(`[realtime] révocation de session de ${userId} impossible :`, error.message);
    return 0;
  }
};

/** Révocation immédiate : droits modifiés, réapplication (coupure si inactif, sinon sortie de rooms). */
export const reajusterDroitsUtilisateur = async (userId) => {
  if (!io || !userId) return { coupes: 0, rooms: 0 };
  try {
    const sockets = await io.in(roomForUser(userId)).fetchSockets();
    if (!sockets.length) return { coupes: 0, rooms: 0 };
    const [profil] = await chargerProfils([userId]);
    return await appliquerDroits(profil ?? null, sockets);
  } catch (error) {
    logger.warn(`[realtime] réajustement des droits de ${userId} impossible :`, error.message);
    return { coupes: 0, rooms: 0 };
  }
};

const statsFilet = { passages: 0, coupes: 0, rooms: 0, jetonsExpires: 0, dernierPassage: null };

/** Filet périodique : relit en UNE requête les profils de tous les sockets de CETTE instance. */
export const passageFilet = async () => {
  if (!io) return { ...statsFilet };
  const sockets = await io.fetchSockets();
  const parUtilisateur = new Map();
  for (const s of sockets) {
    const uid = s.data?.userId;
    if (!uid) continue;
    if (!parUtilisateur.has(uid)) parUtilisateur.set(uid, []);
    parUtilisateur.get(uid).push(s);
  }
  const profils = parUtilisateur.size
    ? new Map((await chargerProfils([...parUtilisateur.keys()])).map((p) => [p.id, p]))
    : new Map();
  const maintenant = Math.floor(Date.now() / 1000);
  let expires = 0;
  for (const [uid, liste] of parUtilisateur) {
    const bilan = await appliquerDroits(profils.get(uid) ?? null, liste);
    statsFilet.coupes += bilan.coupes;
    statsFilet.rooms += bilan.rooms;
    expires += liste.filter((s) => Number.isFinite(s.data?.expiration) && s.data.expiration < maintenant).length;
  }
  statsFilet.jetonsExpires = expires;
  statsFilet.passages += 1;
  statsFilet.dernierPassage = new Date().toISOString();
  return { ...statsFilet };
};

export const realtimeStats = () => ({
  enabled: Boolean(io),
  connections: io?.engine?.clientsCount ?? 0,
  rooms: io?.sockets?.adapter?.rooms?.size ?? 0,
  filet: { ...statsFilet },
});

export const logRealtime = (message) => logger.info(`[realtime] ${message}`);
