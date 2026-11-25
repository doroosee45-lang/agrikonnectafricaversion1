import { prisma } from '../config/prisma.js';
import { resolveId } from './ids.js';
import { logger } from './http/logger.js';

/**
 * Conversations rattachées à un objet métier (MSG-01).
 *
 * Centralisé ici pour que les autres modules (commandes, transport, litiges)
 * puissent ouvrir un fil de discussion **sans importer le module messagerie**
 * (évite les dépendances circulaires) tout en gardant la même règle :
 * une conversation existe toujours pour un dossier, entre ses parties.
 */

export const SUBJECT_TYPES = ['LISTING', 'ORDER', 'TRANSPORT', 'DISPUTE', 'PROJECT', 'DIRECT', 'GROUP', 'ORGANIZATION', 'COOPERATIVE', 'FARM'];

/**
 * Clé du verrou consultatif d'un sujet de conversation. Toutes les ouvertures
 * d'un même sujet sont sérialisées ; des sujets différents restent parallèles.
 */
export const cleVerrouSujet = (subjectType, subjectId) => `conversation:${subjectType}:${subjectId}`;

/**
 * Retourne la conversation ouverte du dossier, ou la crée — `{ conversation, created }`.
 *
 * TX-2 : la lecture (`findFirst`) et la création se faisaient sans protection :
 * 30 ouvertures simultanées créaient jusqu'à 21 fils identiques (aucune
 * contrainte d'unicité sur `conversations`). Elles sont désormais dans UNE
 * transaction, précédée d'un verrou consultatif TRANSACTIONNEL
 * (`pg_advisory_xact_lock`) : libéré à la validation, compatible avec
 * PgBouncer en mode transaction, sans migration. Le premier message est créé
 * dans la même transaction (plus de fil sans message après une panne).
 */
export const ensureBusinessConversationDetaille = async ({
  subjectType,
  subjectId,
  participantOrgIds,
  firstMessage = null,
  actorUserId = null,
}) => {
  const participants = [...new Set(participantOrgIds.filter(Boolean))];
  if (participants.length < 2) return { conversation: null, created: false };

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${cleVerrouSujet(subjectType, subjectId)}, 0))`;

    const existing = await tx.conversation.findFirst({
      where: {
        subjectType,
        subjectId,
        status: 'OPEN',
        participantOrgIds: { hasEvery: participants },
      },
    });
    if (existing) return { conversation: existing, created: false };

    const conversation = await tx.conversation.create({
      data: { id: resolveId(), subjectType, subjectId, participantOrgIds: participants, status: 'OPEN' },
    });

    if (firstMessage) {
      await tx.message.create({
        data: {
          id: resolveId(),
          conversationId: conversation.id,
          senderId: actorUserId,
          senderOrgId: participants[0],
          body: firstMessage,
          attachments: [],
          readBy: actorUserId ? [actorUserId] : [],
        },
      });
    }

    return { conversation, created: true };
  });
};

/** Contrat historique : la conversation seule (ou `null` à moins de deux parties). */
export const ensureBusinessConversation = async (params) =>
  (await ensureBusinessConversationDetaille(params)).conversation;

/**
 * Ouverture « best effort » : un échec de création de conversation ne doit
 * jamais faire échouer l'opération métier (commande, litige…).
 */
export const ensureBusinessConversationSafe = async (params) => {
  try {
    return await ensureBusinessConversation(params);
  } catch (error) {
    logger.warn('Conversation métier non créée :', error.message);
    return null;
  }
};
