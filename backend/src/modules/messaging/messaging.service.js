/**
 * Exigences CDC couvertes : MSG-01, MSG-02, MSG-03, MSG-04.
 *
 * Chaque identifiant renvoie à la règle appliquée dans ce fichier ; la preuve
 * exécutable correspondante est référencée dans `tests/` (voir docs/TRACEABILITY.md).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { supabaseAdmin } from '../../config/supabase.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import { isClientId, resolveId } from '../../shared/ids.js';
import { estCleDeLOrganisation, estCleStockageConforme, prefixeStockage } from '../../shared/storageKeys.js';
import { logger } from '../../shared/http/logger.js';
import { audit } from '../../shared/audit.js';
import { notifyMany } from '../../shared/events.js';
import { ensureBusinessConversationDetaille, cleVerrouSujet, SUBJECT_TYPES } from '../../shared/conversations.js';
import {
  emitToConversation,
  emitToOrganizations,
  retirerOrganisationDuFil,
} from '../../realtime/bus.js';

/**
 * MSG-01 → MSG-04 — Messagerie rattachée à un objet métier.
 *
 * Règles :
 *  - aucune conversation « libre » : `subjectType` + `subjectId` obligatoires ;
 *  - les participants doivent être parties au dossier ;
 *  - un message n'est jamais supprimé (signalement conservé pour modération) ;
 *  - pagination par curseur (`before`) adaptée au défilement d'un fil ;
 *  - les accusés de lecture sont stockés par utilisateur (`readBy`).
 */

/**
 * Délégué Prisma par type d'objet métier. Résolu **au moment de l'appel**
 * (`prisma[name]`) et non à l'import, pour rester testable avec un double.
 */
const SUBJECT_MODEL = {
  LISTING: 'listing',
  ORDER: 'order',
  TRANSPORT: 'transportRequest',
  DISPUTE: 'dispute',
  PROJECT: 'project',
};

/** Champs qui identifient une partie selon le type de dossier. */
const partiesOf = (subject) =>
  [
    subject.organizationId,
    subject.buyerOrgId,
    subject.sellerOrgId,
    subject.requesterOrgId,
    subject.openedByOrgId,
    subject.ownerOrgId,
  ].filter(Boolean);

export const listContacts = async (req) => {
  const myOrgId = req.tenant.organizationId;
  const myCountry = req.tenant.organization?.countryCode ?? "";
  const isPlatformAdmin = (req.tenant.effectiveRoles ?? []).some((r) => ["SUPER_ADMIN", "ADMIN", "MODERATOR"].includes(r));

  const rows = isPlatformAdmin
    ? await prisma.$queryRaw`
        SELECT DISTINCT ON (o.id)
          o.id,
          o.name AS "orgName",
          o.type::text AS type,
          o.country_code AS "countryCode",
          NULL AS "avatarUrl",
          p.first_name AS "firstName",
          p.last_name AS "lastName",
          m.roles::text[] AS roles
        FROM organizations o
        LEFT JOIN memberships m ON m."organizationId" = o.id AND m.status = 'ACTIVE'
        LEFT JOIN profiles p ON p.id = m."userId"
        WHERE o.deleted_at IS NULL AND o.id <> ${myOrgId}
        ORDER BY o.id, o.name ASC
        LIMIT 100
      `
    : await prisma.$queryRaw`
        SELECT DISTINCT ON (o.id)
          o.id,
          o.name AS "orgName",
          o.type::text AS type,
          o.country_code AS "countryCode",
          NULL AS "avatarUrl",
          p.first_name AS "firstName",
          p.last_name AS "lastName",
          m.roles::text[] AS roles
        FROM organizations o
        LEFT JOIN memberships m ON m."organizationId" = o.id AND m.status = 'ACTIVE'
        LEFT JOIN profiles p ON p.id = m."userId"
        WHERE o.deleted_at IS NULL
          AND o.id <> ${myOrgId}
          AND o.country_code = ${myCountry}
        ORDER BY o.id, o.name ASC
        LIMIT 100
      `;

  return rows
    .map((r) => {
      const fullName = [r.firstName, r.lastName].filter(Boolean).join(" ").trim();
      const primaryRole = Array.isArray(r.roles) && r.roles.length > 0 ? r.roles : r.type;
      return {
        id: r.id,
        name: fullName || r.orgName,
        agency: r.orgName,
        role: primaryRole,
        type: r.type,
        countryCode: r.countryCode,
        avatarUrl: r.avatarUrl ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};

const validateAllowedOrgs = async (orgIds, req) => {
  const myCountry = req?.tenant?.organization?.countryCode;
  const isPlatformAdmin = (req?.tenant?.effectiveRoles ?? []).some((r) => ["SUPER_ADMIN", "ADMIN", "MODERATOR"].includes(r));
  return prisma.organization.findMany({
    where: { id: { in: orgIds }, deletedAt: null, ...(!isPlatformAdmin && myCountry ? { countryCode: myCountry } : {}) },
    select: { id: true, name: true },
  });
};

const loadSubject = async (subjectType, subjectId, organizationId, participantOrgIds = [], req = null) => {
  if (subjectType === "DIRECT" || subjectType === "GROUP") {
    const others = await validateAllowedOrgs(participantOrgIds, req);
    if (others.length === 0) throw ApiError.forbidden("Destinataire introuvable ou hors de votre périmètre géographique autorisé");
    return { subject: { id: subjectId }, parties: [...new Set([organizationId, ...others.map((o) => o.id)])] };
  }
  if (!SUBJECT_TYPES.includes(subjectType)) {
    throw ApiError.badRequest(`Objet métier invalide. Valeurs acceptées : ${SUBJECT_TYPES.join(', ')}`);
  }
  /*
   * `ORGANIZATION`, `COOPERATIVE` et `FARM` sont acceptés par le schéma mais
   * n'ont aucun modèle associé : `prisma[undefined]` levait une TypeError et la
   * route répondait 500. Refus explicite tant qu'aucune règle de parties n'est
   * spécifiée pour ces objets.
   */
  if (!SUBJECT_MODEL[subjectType]) {
    throw ApiError.badRequest(`Conversation sur un objet « ${subjectType} » non prise en charge`, [
      { field: 'subjectType', code: 'unsupported' },
    ]);
  }

  const subject = await prisma[SUBJECT_MODEL[subjectType]].findUnique({ where: { id: subjectId } });
  if (!subject) throw ApiError.notFound('Objet métier introuvable');

  const parties = partiesOf(subject);
  if (!parties.includes(organizationId)) throw ApiError.notFound('Objet métier introuvable');

  return { subject, parties: [...new Set(parties)] };
};

const estUrl = (valeur) => /^https?:\/\//i.test(valeur);

export { prefixeStockage };

/**
 * Validation des pièces jointes d'un NOUVEAU message (A3).
 *
 *  - seules les clés de stockage produites par le serveur sont acceptées
 *    (`shared/storageKeys.js`) : `..`, segments vides, formes libres refusés ;
 *  - URL externes refusées (hameçonnage, fuite d'adresse IP au préchargement,
 *    contenu non contrôlé) : aucun client V1 n'en produit ;
 *  - la clé doit appartenir à l'organisation de l'EXPÉDITEUR (D3) : la lecture
 *    du fil signe ces clés pour les destinataires.
 * Les pièces jointes déjà enregistrées ne sont pas modifiées (voir signature).
 */
export const assertAttachments = (attachments = [], senderOrgId = null) => {
  if (!Array.isArray(attachments)) {
    throw ApiError.badRequest('Pièces jointes invalides (liste attendue)', [{ field: 'attachments', code: 'invalid' }]);
  }
  for (const attachment of attachments) {
    if (typeof attachment === 'string' && estUrl(attachment)) {
      throw ApiError.badRequest(
        'Pièce jointe refusée : les liens externes ne sont pas acceptés (dépose le fichier sur la plateforme)',
        [{ field: 'attachments', code: 'external_url_refused' }],
      );
    }
    if (!estCleStockageConforme(attachment)) {
      throw ApiError.badRequest(
        `Pièce jointe invalide : ${String(attachment).slice(0, 40)}… (clé de stockage de la plateforme attendue)`,
        [{ field: 'attachments', code: 'invalid_storage_key' }],
      );
    }
    if (senderOrgId && !estCleDeLOrganisation(attachment, senderOrgId)) {
      throw ApiError.badRequest(
        'Pièce jointe refusée : ce fichier n\'appartient pas à ton organisation',
        [{ field: 'attachments', code: 'foreign_storage_key' }],
      );
    }
  }
  return attachments;
};

/** Bucket d'une clé : `<org>/documents/…` → privé, `<org>/media/…` → médias. */
const bucketDeCle = (cle) =>
  cle.split('/')[1] === 'documents' ? env.SUPABASE_BUCKET_PRIVATE : env.SUPABASE_BUCKET_MEDIA;

/**
 * Ajoute `attachmentUrls` (aligné sur `attachments`) : URL signée fraîche pour
 * chaque clé CONFORME appartenant à une organisation PARTICIPANTE ; `null`
 * sinon. Compatibilité des données antérieures (A3) : `attachments` est
 * renvoyé tel quel, mais une ancienne URL externe ou une clé non conforme
 * (traversée, forme libre) n'est jamais signée ni relayée comme lien.
 * Ne fait jamais échouer la lecture du fil.
 */
export const signerPiecesJointes = async (messages, participantOrgIds = []) => {
  const parBucket = new Map();
  for (const message of messages) {
    for (const piece of message.attachments ?? []) {
      // A3-X : seule une clé de l'organisation EXPÉDITRICE (participante) est signée.
      // Une clé d'un autre participant, présente dans un ancien message, ne l'est jamais.
      if (!participantOrgIds.includes(message.senderOrgId) || !estCleDeLOrganisation(piece, message.senderOrgId)) continue;
      const bucket = bucketDeCle(piece);
      if (!parBucket.has(bucket)) parBucket.set(bucket, new Set());
      parBucket.get(bucket).add(piece);
    }
  }

  const signees = new Map();
  if (supabaseAdmin && parBucket.size > 0) {
    for (const [bucket, cles] of parBucket) {
      try {
        const { data, error } = await supabaseAdmin.storage
          .from(bucket)
          .createSignedUrls([...cles], env.SIGNED_URL_TTL_SECONDS);
        if (error) throw error;
        for (const entree of data ?? []) {
          if (entree?.signedUrl && entree.path) signees.set(entree.path, entree.signedUrl);
        }
      } catch (erreur) {
        logger.warn('[messaging] signature des pièces jointes impossible :', erreur?.message ?? erreur);
      }
    }
  }

  return messages.map((message) => ({
    ...message,
    attachmentUrls: (message.attachments ?? []).map((piece) =>
      participantOrgIds.includes(message.senderOrgId) && estCleDeLOrganisation(piece, message.senderOrgId)
        ? signees.get(piece) ?? null
        : null,
    ),
  }));
};

export const startConversation = async ({ subjectType, subjectId, participantOrgIds = [], firstMessage }, req) => {
  const { parties } = await loadSubject(subjectType, subjectId, req.tenant.organizationId, participantOrgIds, req);

  const participants = [...new Set([req.tenant.organizationId, ...participantOrgIds])];
  if (participants.length < 2) {
    throw ApiError.badRequest('Une conversation requiert au moins deux organisations participantes');
  }
  if (participants.some((p) => !parties.includes(p))) {
    throw ApiError.forbidden('Chaque participant doit être partie à l\'objet métier');
  }

  const existing = await prisma.conversation.findFirst({
    where: { subjectType, subjectId, participantOrgIds: { hasEvery: participants }, status: 'OPEN' },
  });
  if (existing) return { conversation: existing, replayed: true };

  // TX-2 : création sérialisée par sujet ; `created` faux si une requête
  // concurrente l'a créé entre-temps (alors : rejeu, ni audit ni émission).
  const { conversation, created } = await ensureBusinessConversationDetaille({
    subjectType,
    subjectId,
    participantOrgIds: participants,
    firstMessage: firstMessage ? String(firstMessage).trim() : null,
    actorUserId: req.user.id,
  });
  if (!created) return { conversation, replayed: true };

  await audit({
    actorId: req.user.id,
    action: 'conversation.create',
    resource: 'conversations',
    resourceId: conversation.id,
    req,
    newValue: { subjectType, subjectId, participants },
  });

  if (firstMessage) {
    emitToConversation(conversation.id, 'message:new', {
      conversationId: conversation.id,
      preview: String(firstMessage).slice(0, 120),
    });
    emitToOrganizations(participants.filter((p) => p !== req.tenant.organizationId), 'conversation:new', {
      conversationId: conversation.id,
      subjectType,
      subjectId,
    });
  }

  return { conversation, replayed: false };
};

/** Ouverture d'un fil depuis une annonce (« contacter le vendeur »). */
export const contactAboutListing = async (listingId, { message }, req) => {
  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing || listing.deletedAt) throw ApiError.notFound('Annonce introuvable');
  if (listing.status !== 'PUBLISHED') throw ApiError.conflict('Cette annonce n\'est pas publiée');
  if (listing.organizationId === req.tenant.organizationId) {
    throw ApiError.badRequest('Tu ne peux pas te contacter toi-même');
  }

  return startConversation(
    {
      subjectType: 'LISTING',
      subjectId: listingId,
      participantOrgIds: [listing.organizationId],
      firstMessage: message,
    },
    req,
  );
};


export const createGroup = async ({ name, description, participantOrgIds = [] }, req) => {
  const allowed = await validateAllowedOrgs(participantOrgIds, req);
  if (allowed.length === 0) throw ApiError.forbidden("Aucun membre autorisé sélectionné");
  const participants = [...new Set([req.tenant.organizationId, ...allowed.map((o) => o.id)])];
  const intro = description?.trim() ? `Groupe « ${name.trim()} » créé — ${description.trim()}` : `Groupe « ${name.trim()} » créé`;
  const subjectId = `GRP:${name.trim()}`;

  /*
   * Rejeu (double envoi) : on ne renvoie un groupe existant que s'il est
   * IDENTIQUE — même nom, même administrateur (premier participant), mêmes
   * membres. `ensureBusinessConversation` cherche un sur-ensemble
   * (`hasEvery`) : créer « Famille » avec A et B renvoyait le « Famille »
   * d'un autre administrateur contenant aussi C, et les messages partaient à
   * un membre que le créateur n'avait pas choisi.
   */
  // TX-2 (étude createGroup) : recherche du groupe identique et création dans
  // UNE transaction, sérialisée par le verrou du sujet `GROUP:<nom>`. Sans cela,
  // deux envois simultanés créaient deux groupes identiques.
  const { conversation, created } = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${cleVerrouSujet("GROUP", subjectId)}, 0))`;
    const candidats = await tx.conversation.findMany({
      where: { subjectType: "GROUP", subjectId, status: "OPEN", participantOrgIds: { hasEvery: participants } },
    });
    const identique = candidats.find(
      (c) => c.participantOrgIds[0] === req.tenant.organizationId && c.participantOrgIds.length === participants.length,
    );
    if (identique) return { conversation: identique, created: false };

    const cree = await tx.conversation.create({
      data: { id: resolveId(), subjectType: "GROUP", subjectId, participantOrgIds: participants, status: "OPEN" },
    });
    await tx.message.create({
      data: {
        id: resolveId(),
        conversationId: cree.id,
        senderId: req.user.id,
        senderOrgId: req.tenant.organizationId,
        body: intro,
        attachments: [],
        readBy: [req.user.id],
      },
    });
    return { conversation: cree, created: true };
  });
  if (!created) return conversation;

  await audit({
    actorId: req.user.id,
    action: "conversation.create",
    resource: "conversations",
    resourceId: conversation.id,
    req,
    newValue: { subjectType: "GROUP", subjectId, participants },
  });
  emitToOrganizations(participants.filter((id) => id !== req.tenant.organizationId), "conversation:new", { conversationId: conversation.id, subjectType: "GROUP", title: name.trim() });
  return conversation;
};

export const addGroupMember = async (conversationId, orgId, req) => {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conv || conv.subjectType !== "GROUP" || !conv.participantOrgIds.includes(req.tenant.organizationId)) throw ApiError.notFound("Groupe introuvable");
  const isAdmin = conv.participantOrgIds[0] === req.tenant.organizationId || (req.tenant.effectiveRoles ?? []).some((r) => ["SUPER_ADMIN", "ADMIN", "MODERATOR"].includes(r));
  if (!isAdmin) throw ApiError.forbidden("Seul l'administrateur du groupe peut ajouter des membres");
  const allowed = await validateAllowedOrgs([orgId], req);
  if (allowed.length === 0) throw ApiError.forbidden("Organisation non autorisée");
  const updated = await prisma.conversation.update({ where: { id: conversationId }, data: { participantOrgIds: [...new Set([...conv.participantOrgIds, orgId])] } });
  await postMessage(conversationId, { body: `+ ${allowed[0].name} a rejoint le groupe`, attachments: [] }, req);
  // Le nouveau membre n'est dans aucune room de ce fil : on le prévient pour
  // qu'il la rejoigne (`conversation:join`, qui revérifie l'appartenance).
  if (!conv.participantOrgIds.includes(orgId)) {
    emitToOrganizations([orgId], 'conversation:new', { conversationId, subjectType: 'GROUP', title: conv.subjectId?.startsWith('GRP:') ? conv.subjectId.slice(4) : null });
  }
  return updated;
};

export const removeGroupMember = async (conversationId, orgId, req) => {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conv || conv.subjectType !== "GROUP" || !conv.participantOrgIds.includes(req.tenant.organizationId)) throw ApiError.notFound("Groupe introuvable");
  const isAdmin = conv.participantOrgIds[0] === req.tenant.organizationId || (req.tenant.effectiveRoles ?? []).some((r) => ["SUPER_ADMIN", "ADMIN", "MODERATOR"].includes(r));
  if (!isAdmin && orgId !== req.tenant.organizationId) throw ApiError.forbidden("Seul l'administrateur du groupe peut retirer un membre");
  if (orgId === conv.participantOrgIds[0]) throw ApiError.badRequest("L'administrateur principal ne peut pas être retiré");
  const restants = conv.participantOrgIds.filter((id) => id !== orgId);
  const updated = await prisma.conversation.update({ where: { id: conversationId }, data: { participantOrgIds: restants } });
  /*
   * Le retrait doit aussi valoir en temps réel : sans cela, les sockets de
   * l'organisation retirée restaient dans la room et continuaient de recevoir
   * le contenu des nouveaux messages jusqu'à leur déconnexion.
   */
  await retirerOrganisationDuFil(conversationId, orgId, restants);
  await audit({
    actorId: req.user.id,
    action: 'conversation.member.remove',
    resource: 'conversations',
    resourceId: conversationId,
    req,
    newValue: { removedOrganizationId: orgId },
  });
  return updated;
};

export const listConversations = async (query, req) => {
  const { page, limit } = query;
  const where = { participantOrgIds: { has: req.tenant.organizationId } };

  const [items, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { updatedAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    }),
    prisma.conversation.count({ where }),
  ]);

  // Comptage réel des non-lus par conversation (une seule requête groupée)
  const unreadGroups = await prisma.message.groupBy({
    by: ['conversationId'],
    where: {
      conversationId: { in: items.map((c) => c.id) },
      senderOrgId: { not: req.tenant.organizationId },
      NOT: { readBy: { has: req.user.id } },
    },
    _count: { _all: true },
  });
  const unreadByConversation = new Map(unreadGroups.map((g) => [g.conversationId, g._count._all]));

  const allOrgIds = [...new Set(items.flatMap((c) => c.participantOrgIds))];
  const orgRows = allOrgIds.length > 0
    ? await prisma.$queryRaw`SELECT id, name, type::text AS type, country_code AS "countryCode", NULL AS "avatarUrl" FROM organizations WHERE id = ANY(${allOrgIds}::text[])`
    : [];
  const orgMap = new Map(orgRows.map((o) => [o.id, o]));
  return {
    items: items.map((conversation) => {
      const unread = unreadByConversation.get(conversation.id) ?? 0;
      const otherIds = conversation.participantOrgIds.filter((id) => id !== req.tenant.organizationId);
      const participants = conversation.participantOrgIds.map((id) => orgMap.get(id) ?? { id, name: "Membre", type: "INDIVIDUAL", countryCode: "", avatarUrl: null });
      const primaryPeer = orgMap.get(otherIds[0]) ?? participants[0];
      const isGroup = conversation.subjectType === "GROUP";
      const title = isGroup && conversation.subjectId?.startsWith("GRP:") ? conversation.subjectId.slice(4) : isGroup ? (conversation.subjectId || "Groupe") : (primaryPeer?.name ?? "Discussion");
      return {
        ...conversation,
        title,
        subtitle: isGroup ? `${participants.length} participants` : `${primaryPeer?.type ?? "ACTIF"} · ${primaryPeer?.countryCode ?? ""}`,
        avatarUrl: isGroup ? null : (primaryPeer?.avatarUrl ?? null),
        adminOrgId: isGroup ? conversation.participantOrgIds[0] : null,
        participants,
        unread,
        unreadCount: unread,
        lastMessage: conversation.messages[0] ?? null,
        otherParticipants: otherIds,
      };
    }),
    total,
    page,
    limit,
    totalUnread: [...unreadByConversation.values()].reduce((acc, n) => acc + n, 0),
  };
};

/**
 * Messages d'une conversation.
 * Pagination par curseur : `?before=<ISO>&limit=30` pour remonter le fil.
 */
export const listMessages = async (conversationId, query, req) => {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation || !conversation.participantOrgIds.includes(req.tenant.organizationId)) {
    throw ApiError.notFound('Conversation introuvable');
  }

  const limit = Math.min(Number(query.limit ?? 30), 100);
  const before = query.before ? new Date(query.before) : null;

  const rows = await prisma.message.findMany({
    where: { conversationId, ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).reverse();

  // Accusé de lecture : une seule écriture pour tous les messages non lus
  await prisma.message.updateMany({
    where: {
      conversationId,
      senderOrgId: { not: req.tenant.organizationId },
      NOT: { readBy: { has: req.user.id } },
    },
    data: { readBy: { push: req.user.id } },
  });

  if (items.length > 0) {
    emitToConversation(conversationId, 'message:read', {
      conversationId,
      userId: req.user.id,
      organizationId: req.tenant.organizationId,
    });
  }

  // Les messages renvoyés reflètent l'accusé de lecture que l'on vient d'écrire
  const withReadReceipt = await signerPiecesJointes(
    items.map((message) =>
      message.readBy?.includes(req.user.id) || message.senderOrgId === req.tenant.organizationId
        ? message
        : { ...message, readBy: [...(message.readBy ?? []), req.user.id] },
    ),
    conversation.participantOrgIds,
  );

  return {
    conversation: {
      id: conversation.id,
      subjectType: conversation.subjectType,
      subjectId: conversation.subjectId,
      status: conversation.status,
      participants: conversation.participantOrgIds,
    },
    items: withReadReceipt,
    hasMore,
    nextCursor: hasMore && items.length > 0 ? items[0].createdAt.toISOString() : null,
  };
};

/**
 * Réémission idempotente (`localTempId`, envoi hors ligne) : on ne renvoie un
 * message existant QUE s'il appartient à ce fil et à cet expéditeur. Un même
 * identifiant déjà pris ailleurs est un conflit (409), jamais un 500 ni une
 * fuite du message d'autrui.
 */
const rejouerSiDejaRecu = async (localTempId, conversationId, req) => {
  if (!localTempId) return null;
  const existing = await prisma.message.findUnique({ where: { id: localTempId } });
  if (!existing) return null;
  if (existing.conversationId === conversationId && existing.senderId === req.user.id) return existing;
  throw ApiError.conflict('Identifiant de message déjà utilisé');
};

export const postMessage = async (conversationId, { body, attachments, localTempId }, req) => {
  if (localTempId !== undefined && localTempId !== null && !isClientId(localTempId)) {
    throw ApiError.badRequest('Identifiant local de message invalide', [{ field: 'localTempId', code: 'invalid' }]);
  }

  // Contrôle d'accès AVANT toute lecture de message, réémission comprise.
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation || !conversation.participantOrgIds.includes(req.tenant.organizationId)) {
    throw ApiError.notFound('Conversation introuvable');
  }

  const deja = await rejouerSiDejaRecu(localTempId, conversationId, req);
  if (deja) return deja;

  if (conversation.status !== 'OPEN') throw ApiError.conflict(`Conversation ${conversation.status.toLowerCase()}`);

  const safeAttachments = assertAttachments(attachments ?? [], req.tenant.organizationId);

  let message;
  try {
    message = await prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          id: localTempId || resolveId(),
          conversationId,
          senderId: req.user.id,
          senderOrgId: req.tenant.organizationId,
          body,
          attachments: safeAttachments,
          readBy: [req.user.id],
        },
      });
      await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
      return created;
    });
  } catch (erreur) {
    // Deux envois simultanés du même `localTempId` : le second rejoue le premier.
    if (localTempId && erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === 'P2002') {
      const gagnant = await rejouerSiDejaRecu(localTempId, conversationId, req);
      if (gagnant) return gagnant;
    }
    throw erreur;
  }

  const [signe] = await signerPiecesJointes([message], conversation.participantOrgIds);

  const recipients = await prisma.membership.findMany({
    where: {
      organizationId: { in: conversation.participantOrgIds.filter((id) => id !== req.tenant.organizationId) },
      status: 'ACTIVE',
    },
    select: { userId: true },
  });

  await notifyMany(recipients.map((r) => r.userId), {
    type: 'message.received',
    title: 'Nouveau message',
    body: body.slice(0, 120),
    payload: { conversationId },
    dedupeKey: `msg:${message.id}`,
  });

  // Temps réel : le contenu part uniquement vers les membres du fil
  emitToConversation(conversationId, 'message:new', {
    conversationId,
    message: {
      id: message.id,
      body: message.body,
      attachments: message.attachments,
      attachmentUrls: signe.attachmentUrls,
      senderId: message.senderId,
      senderOrgId: message.senderOrgId,
      createdAt: message.createdAt,
    },
  });

  return signe;
};

/** MSG-03 — signalement d'un message (conservé pour la modération). */
export const reportMessage = async (messageId, { reason }, req) => {
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) throw ApiError.notFound('Message introuvable');

  // Le contrôle d'accès passe par la conversation, jamais par le message seul.
  const conversation = await prisma.conversation.findUnique({ where: { id: message.conversationId } });
  if (!conversation || !conversation.participantOrgIds.includes(req.tenant.organizationId)) {
    throw ApiError.notFound('Message introuvable');
  }

  await audit({
    actorId: req.user.id,
    action: 'message.report',
    resource: 'messages',
    resourceId: messageId,
    req,
    newValue: { reason, conversationId: conversation.id },
  });

  return {
    reported: true,
    messageId,
    conversationId: message.conversationId,
    retention: 'Message conservé pour analyse de la modération.',
  };
};

export const archiveConversation = async (conversationId, req) => {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation || !conversation.participantOrgIds.includes(req.tenant.organizationId)) {
    throw ApiError.notFound('Conversation introuvable');
  }

  const updated = await prisma.conversation.update({ where: { id: conversationId }, data: { status: 'ARCHIVED' } });
  await audit({ actorId: req.user.id, action: 'conversation.archive', resource: 'conversations', resourceId: conversationId, req });
  return updated;
};

/** Blocage d'un fil (modération) — les parties ne peuvent plus écrire. */
export const blockConversation = async (conversationId, { reason }, req) => {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) throw ApiError.notFound('Conversation introuvable');

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: 'BLOCKED' },
  });

  await audit({
    actorId: req.user.id,
    action: 'conversation.block',
    resource: 'conversations',
    resourceId: conversationId,
    req,
    newValue: { reason: reason ?? null, participants: conversation.participantOrgIds },
  });

  emitToConversation(conversationId, 'conversation:blocked', { conversationId, reason: reason ?? null });
  return updated;
};


/** Taille maximale d'une page de synchronisation différée. */
export const DELTA_SYNC_PAGE = 500;

export const deltaSync = async ({ lastPulledAt = 0, roomIds = [] }, req) => {
  const now = Date.now();
  const since = new Date(Number(lastPulledAt) || 0);

  const allowedConvs = await prisma.conversation.findMany({
    where: {
      participantOrgIds: { has: req.tenant.organizationId },
      ...(roomIds.length > 0 ? { id: { in: roomIds } } : {}),
    },
    select: { id: true, participantOrgIds: true },
  });
  const allowedIds = allowedConvs.map((c) => c.id);
  if (allowedIds.length === 0) {
    return { created: [], updated: [], deleted: [], serverTimestamp: now, hasMore: false };
  }

  const fetched = await prisma.message.findMany({
    where: {
      conversationId: { in: allowedIds },
      createdAt: { gt: since },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: DELTA_SYNC_PAGE + 1,
  });

  /*
   * Page pleine : le curseur renvoyé est la date du DERNIER message livré, pas
   * « maintenant ». Renvoyer `Date.now()` faisait sauter définitivement tous
   * les messages au-delà de la page à un client resté longtemps hors ligne.
   *
   * On ne coupe jamais au milieu d'un groupe de messages de même milliseconde :
   * le curseur est strict (`gt`), un message laissé de l'autre côté de la
   * coupure ne reviendrait pas.
   */
  let rows = fetched;
  let hasMore = false;
  if (fetched.length > DELTA_SYNC_PAGE) {
    hasMore = true;
    rows = fetched.slice(0, DELTA_SYNC_PAGE);
    const borne = rows[rows.length - 1].createdAt.getTime();
    const premierApres = fetched[DELTA_SYNC_PAGE].createdAt.getTime();
    if (premierApres === borne) {
      rows = rows.filter((m) => m.createdAt.getTime() < borne);
      // Cas extrême : toute la page partage la même milliseconde.
      if (rows.length === 0) {
        rows = await prisma.message.findMany({
          where: { conversationId: { in: allowedIds }, createdAt: new Date(borne) },
          orderBy: { id: 'asc' },
        });
      }
    }
  }
  const serverTimestamp = hasMore ? rows[rows.length - 1].createdAt.getTime() : now;

  const participantsParFil = new Map(allowedConvs.map((c) => [c.id, c.participantOrgIds]));
  const signes = [];
  for (const [filId, participants] of participantsParFil) {
    const duFil = rows.filter((m) => m.conversationId === filId);
    if (duFil.length) signes.push(...(await signerPiecesJointes(duFil, participants)));
  }
  const urlsParMessage = new Map(signes.map((m) => [m.id, m.attachmentUrls]));

  const mapped = rows.map((m) => ({
    id: m.id,
    server_id: m.id,
    local_temp_id: m.id,
    room_id: m.conversationId,
    sender_id: m.senderId,
    sender_org_id: m.senderOrgId,
    type: m.attachments?.some((a) => /\.(webm|m4a|mp3|ogg|wav)$/i.test(a)) ? 'AUDIO' : m.attachments?.length ? 'DOCUMENT' : 'TEXT',
    content: m.body,
    remote_media_url: m.attachments?.[0] ?? null,
    attachments: m.attachments ?? [],
    // URL signées de courte durée, pour l'affichage uniquement : ne pas les
    // stocker comme identité du média (`remote_media_url` reste la clé stable).
    attachment_urls: urlsParMessage.get(m.id) ?? [],
    read_by: m.readBy ?? [],
    created_at: new Date(m.createdAt).getTime(),
    updated_at: new Date(m.createdAt).getTime(),
    deleted_at: null,
  }));

  return {
    created: mapped,
    updated: [],
    deleted: [],
    serverTimestamp,
    hasMore,
  };
};
