import { Server } from 'socket.io';
import { supabase } from '../config/supabase.js';
import { prisma } from '../config/prisma.js';
import { postMessage } from '../modules/messaging/messaging.service.js';
import { env } from '../config/env.js';
import { isOriginAllowed } from '../config/cors.js';
import { logger } from '../shared/http/logger.js';
import { contexteEnvoi, sendMessageSchema } from './sendGuard.js';
import {
  empreinteJeton,
  passageFilet,
  setIo,
  roomForOrganization,
  roomForConversation,
  roomForUser,
  realtimeStats,
} from './bus.js';

/**
 * Couche temps réel (CDC V2 §8.7) — Socket.IO.
 *
 * Principes :
 *  - **Les écritures passent par l'API REST** : validation Zod, permissions,
 *    audit et idempotence restent centralisés. Le WebSocket ne sert qu'à
 *    pousser les nouveautés et les indicateurs de saisie.
 *  - **Authentification identique au REST** : jeton Supabase dans
 *    `handshake.auth.token`. Aucun accès anonyme.
 *  - **Cloisonnement** : chaque socket rejoint une room par organisation et
 *    une room par conversation à laquelle son organisation participe. Aucun
 *    message n'est diffusé en dehors de ces rooms.
 */

/** Durée de validité d'un indicateur de saisie (côté client). */
export const TYPING_TTL_MS = 5000;

/**
 * Profil ACTIF et adhésions ACTIVES — même requête que `authenticate` (REST).
 *
 * Relue à chaque action sensible (`send_message`, `conversation:join`) et pas
 * seulement à la connexion : sinon un compte suspendu, une adhésion retirée ou
 * un rôle révoqué continuait d'agir par WebSocket jusqu'à la reconnexion,
 * alors que le REST le refusait déjà.
 */
export const chargerProfilActif = async (userId) => {
  if (!userId) return null;
  const profile = await prisma.profile.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        where: { status: 'ACTIVE', organization: { deletedAt: null } },
        include: { organization: { select: { id: true, type: true, name: true, slug: true, countryCode: true } } },
      },
    },
  });
  if (!profile || profile.status !== 'ACTIVE') return null;
  return profile;
};

const adhesionsDe = (profile) =>
  profile.memberships.map((m) => ({ organizationId: m.organizationId, roles: m.roles ?? [], organization: m.organization }));

const estVerifie = (profile) => Boolean(profile.emailVerifiedAt || profile.phoneVerifiedAt);

/** Charge l'utilisateur applicatif à partir du jeton Supabase. */
const authenticateSocket = async (token) => {
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  return chargerProfilActif(data.user.id);
};

/**
 * Enregistre un écouteur Socket.IO protégé.
 *
 * Socket.IO (4.8) appelle les écouteurs dans un `process.nextTick` SANS
 * try/catch : une exception synchrone y devient une `uncaughtException`, que
 * `server.js` traite par un arrêt du serveur. Il suffisait donc qu'un client
 * authentifié émette `typing` avec `null` (la valeur par défaut `= {}` ne
 * s'applique pas à `null`), ou `ping:app` avec un argument qui n'est pas une
 * fonction, pour arrêter l'API de tous les utilisateurs.
 *
 * Ici : charge utile ramenée à un objet, accusé de réception ramené à une
 * fonction, erreurs synchrones et asynchrones capturées et journalisées.
 */
export const ecouteurProtege = (evenement, handler) => (...args) => {
  const dernier = args[args.length - 1];
  const ack = typeof dernier === 'function' ? dernier : () => {};
  const premier = args[0];
  const payload = premier && typeof premier === 'object' && !Array.isArray(premier) ? premier : {};
  const journaliser = (erreur) => logger.warn(`[realtime] ${evenement} en échec :`, erreur?.message ?? erreur);
  try {
    const resultat = handler(payload, ack);
    if (resultat && typeof resultat.catch === 'function') resultat.catch(journaliser);
  } catch (erreur) {
    journaliser(erreur);
  }
};

/** Conversations ouvertes de l'utilisateur (par organisation). */
const loadConversationRooms = async (organizationIds) => {
  if (organizationIds.length === 0) return [];

  const conversations = await prisma.conversation.findMany({
    where: {
      participantOrgIds: { hasSome: organizationIds },
      status: { in: ['OPEN', 'BLOCKED'] },
    },
    select: { id: true },
    take: 500,
    orderBy: { updatedAt: 'desc' },
  });

  return conversations.map((c) => c.id);
};

/**
 * Lit `exp` d'un JWT déjà vérifié par Supabase (`getUser`) : sert uniquement à
 * COMPTER les sockets au jeton expiré (aucune coupure à ce stade, voir bus.js).
 */
const expirationJeton = (jeton) => {
  try {
    const charge = JSON.parse(Buffer.from(String(jeton).split('.')[1] ?? '', 'base64url').toString('utf8'));
    return Number.isFinite(charge?.exp) ? charge.exp : null;
  } catch {
    return null;
  }
};

/**
 * @param {import('node:http').Server} httpServer
 * @param {{ intervalleFiletMs?: number }} [options] intervalle du filet de
 *   révocation (défaut : `REALTIME_RECHECK_MS`) ; surchargeable pour les tests.
 */
export const attachRealtime = (httpServer, { intervalleFiletMs = env.REALTIME_RECHECK_MS } = {}) => {
  const io = new Server(httpServer, {
    path: '/realtime',
    cors: {
      // Même règle que l'API (src/config/cors.js) : ports locaux libres en dev.
      origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
      credentials: true,
    },
    // Payloads courts : on ne transporte que des identifiants et statuts.
    maxHttpBufferSize: 1e5,
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token ?? socket.handshake.headers?.authorization?.slice(7);
      const profile = await authenticateSocket(token);
      if (!profile) return next(new Error('UNAUTHORIZED'));

      socket.data.userId = profile.id;
      // W13 : empreinte du jeton (jamais le jeton) pour couper CETTE session à la déconnexion.
      socket.data.jetonEmpreinte = empreinteJeton(token);
      socket.data.expiration = expirationJeton(token);
      // Instantané de connexion : sert UNIQUEMENT à choisir les rooms initiales.
      // Les actions sensibles relisent le profil (`chargerProfilActif`).
      socket.data.organizationIds = profile.memberships.map((m) => m.organizationId);
      return next();
    } catch (error) {
      logger.warn('[realtime] échec d\'authentification :', error.message);
      return next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', async (socket) => {
    const { userId, organizationIds } = socket.data;

    socket.join(roomForUser(userId));
    organizationIds.forEach((organizationId) => socket.join(roomForOrganization(organizationId)));

    /*
     * Les écouteurs sont enregistrés AVANT toute attente : un événement reçu
     * pendant le chargement des rooms était perdu sans accusé (Socket.IO ne
     * met pas en file les événements sans écouteur). C'est précisément le cas
     * du moteur hors ligne mobile, qui vide sa file d'envoi dès la connexion.
     */
    socket.data.conversationIds = new Set();

    /**
     * Indicateur de saisie. On vérifie l'appartenance avant diffusion :
     * un socket ne peut pas « typer » dans une conversation qui n'est pas la sienne.
     */
    socket.on('typing', ecouteurProtege('typing', (payload) => {
      const { conversationId, isTyping = true } = payload;
      if (typeof conversationId !== 'string' || !socket.data.conversationIds.has(conversationId)) return;

      socket.to(roomForConversation(conversationId)).emit('typing', {
        conversationId,
        userId,
        isTyping: Boolean(isTyping),
        at: new Date().toISOString(),
      });
    }));

    /**
     * Profil relu pour une action sensible. Compte suspendu ou supprimé
     * depuis la connexion : refus et coupure du socket (le REST répond déjà 403).
     */
    const profilCourant = async (ack) => {
      const profile = await chargerProfilActif(userId);
      if (!profile) {
        ack({ ok: false, error: 'UNAUTHORIZED' });
        socket.disconnect(true);
      }
      return profile;
    };

    /** Rejoindre un fil créé après la connexion (nouvelle commande, par ex.). */
    socket.on('conversation:join', ecouteurProtege('conversation:join', async ({ conversationId }, ack) => {
      if (typeof conversationId !== 'string' || !conversationId) return ack({ ok: false, error: 'MISSING_ID' });

      const profile = await profilCourant(ack);
      if (!profile) return undefined;
      const organisationsActuelles = profile.memberships.map((m) => m.organizationId);

      const conversation = await prisma.conversation
        .findUnique({ where: { id: conversationId }, select: { participantOrgIds: true } })
        .catch(() => null);

      const allowed =
        conversation && conversation.participantOrgIds.some((id) => organisationsActuelles.includes(id));

      if (!allowed) return ack({ ok: false, error: 'FORBIDDEN' });

      socket.join(roomForConversation(conversationId));
      socket.data.conversationIds.add(conversationId);
      return ack({ ok: true });
    }));

    socket.on('conversation:leave', ecouteurProtege('conversation:leave', ({ conversationId }) => {
      if (typeof conversationId !== 'string' || !conversationId) return;
      socket.leave(roomForConversation(conversationId));
      socket.data.conversationIds.delete(conversationId);
    }));

    /** Envoi temps réel idempotent via localTempId avec accusé de réception immédiat (Offline-First). */
    socket.on('send_message', ecouteurProtege('send_message', async (payload, ack) => {
      try {
        const parsed = sendMessageSchema.safeParse(payload);
        if (!parsed.success) return ack({ ok: false, error: 'INVALID_PAYLOAD' });
        const { roomId, content, attachments, localTempId, organizationId: demandee } = parsed.data;

        const profile = await profilCourant(ack);
        if (!profile) return undefined;

        const conversation = await prisma.conversation.findUnique({
          where: { id: roomId },
          select: { participantOrgIds: true },
        });
        const contexte = contexteEnvoi({
          userId,
          verified: estVerifie(profile),
          memberships: adhesionsDe(profile),
          participantOrgIds: conversation?.participantOrgIds ?? [],
          organisationDemandee: demandee,
        });
        if (!contexte.ok) return ack({ ok: false, error: contexte.error });

        const created = await postMessage(
          roomId,
          { body: content, attachments, localTempId },
          contexte.req,
        );
        socket.join(roomForConversation(roomId));
        socket.data.conversationIds.add(roomId);
        return ack({
          ok: true,
          serverId: created.id,
          serverTimestamp: new Date(created.createdAt).getTime(),
        });
      } catch (err) {
        // Seules les erreurs métier (ApiError) sont renvoyées telles quelles :
        // un message Prisma ou système ne doit pas fuiter vers le client.
        if (err?.name === 'ApiError' || Number.isInteger(err?.status)) {
          return ack({ ok: false, error: err.code ?? 'SEND_FAILED', message: err.message });
        }
        logger.warn('[realtime] send_message en échec :', err?.message);
        return ack({ ok: false, error: 'SEND_FAILED' });
      }
    }));

    /** Battement de cœur applicatif : utile derrière un proxy mobile instable. */
    socket.on('ping:app', ecouteurProtege('ping:app', (_payload, ack) => ack({ at: new Date().toISOString() })));

    socket.on('disconnect', (reason) => {
      logger.debug?.(`[realtime] déconnexion ${userId} (${reason})`);
    });

    const conversationIds = await loadConversationRooms(organizationIds).catch(() => []);
    conversationIds.forEach((id) => {
      socket.join(roomForConversation(id));
      socket.data.conversationIds.add(id);
    });

    socket.emit('ready', {
      userId,
      organizations: organizationIds,
      conversations: conversationIds.length,
      at: new Date().toISOString(),
    });
  });

  setIo(io);

  /*
   * Filet de révocation (W11/W12) : relit périodiquement les droits des sockets
   * de CETTE instance. Couvre les modifications hors API et les autres instances
   * (aucun adaptateur partagé) ; délai maximal = intervalle.
   */
  let filetEnCours = false;
  const minuterieFilet = setInterval(async () => {
    if (filetEnCours) return;
    filetEnCours = true;
    try {
      await passageFilet();
    } catch (error) {
      logger.warn('[realtime] filet de révocation en échec :', error?.message ?? error);
    } finally {
      filetEnCours = false;
    }
  }, intervalleFiletMs);
  minuterieFilet.unref?.();
  const fermer = io.close.bind(io);
  io.close = (...args) => {
    clearInterval(minuterieFilet);
    return fermer(...args);
  };
  logger.info(`[realtime] Socket.IO actif sur le chemin /realtime (${realtimeStats().connections} connexion(s))`);

  return io;
};

export { realtimeStats };
