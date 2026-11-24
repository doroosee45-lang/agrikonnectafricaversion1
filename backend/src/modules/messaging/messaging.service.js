/**
 * Exigences CDC couvertes : MSG-01, MSG-02, MSG-03, MSG-04.
 *
 * Chaque identifiant renvoie à la règle appliquée dans ce fichier ; la preuve
 * exécutable correspondante est référencée dans `tests/` (voir docs/TRACEABILITY.md).
 */
import { prisma } from '../../config/prisma.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import { resolveId } from '../../shared/ids.js';
import { audit } from '../../shared/audit.js';
import { notifyMany } from '../../shared/events.js';
import { ensureBusinessConversation, SUBJECT_TYPES } from '../../shared/conversations.js';
import { emitToConversation, emitToOrganizations } from '../../realtime/bus.js';

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
          o.logo_url AS "avatarUrl",
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
          o.logo_url AS "avatarUrl",
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

  const subject = await prisma[SUBJECT_MODEL[subjectType]].findUnique({ where: { id: subjectId } });
  if (!subject) throw ApiError.notFound('Objet métier introuvable');

  const parties = partiesOf(subject);
  if (!parties.includes(organizationId)) throw ApiError.notFound('Objet métier introuvable');

  return { subject, parties: [...new Set(parties)] };
};

/** Validation des pièces jointes : URL http(s) ou clé de stockage interne. */
const assertAttachments = (attachments = []) => {
  for (const attachment of attachments) {
    const ok = /^https?:\/\//i.test(attachment) || /^[A-Za-z0-9._\-/]+$/.test(attachment);
    if (!ok) {
      throw ApiError.badRequest(
        `Pièce jointe invalide : ${String(attachment).slice(0, 40)}… (URL http(s) ou clé de stockage attendue)`,
        [{ field: 'attachments', code: 'invalid' }],
      );
    }
  }
  return attachments;
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

  const conversation = await ensureBusinessConversation({
    subjectType,
    subjectId,
    participantOrgIds: participants,
    firstMessage: firstMessage ? String(firstMessage).trim() : null,
    actorUserId: req.user.id,
  });

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
  const conversation = await ensureBusinessConversation({
    subjectType: "GROUP",
    subjectId: `GRP:${name.trim()}`,
    participantOrgIds: participants,
    firstMessage: intro,
    actorUserId: req.user.id,
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
  return updated;
};

export const removeGroupMember = async (conversationId, orgId, req) => {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conv || conv.subjectType !== "GROUP" || !conv.participantOrgIds.includes(req.tenant.organizationId)) throw ApiError.notFound("Groupe introuvable");
  const isAdmin = conv.participantOrgIds[0] === req.tenant.organizationId || (req.tenant.effectiveRoles ?? []).some((r) => ["SUPER_ADMIN", "ADMIN", "MODERATOR"].includes(r));
  if (!isAdmin && orgId !== req.tenant.organizationId) throw ApiError.forbidden("Seul l'administrateur du groupe peut retirer un membre");
  if (orgId === conv.participantOrgIds[0]) throw ApiError.badRequest("L'administrateur principal ne peut pas être retiré");
  return prisma.conversation.update({ where: { id: conversationId }, data: { participantOrgIds: conv.participantOrgIds.filter((id) => id !== orgId) } });
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
    ? await prisma.$queryRaw`SELECT id, name, type::text AS type, country_code AS "countryCode", logo_url AS "avatarUrl" FROM organizations WHERE id = ANY(${allOrgIds}::text[])`
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
  const withReadReceipt = items.map((message) =>
    message.readBy?.includes(req.user.id) || message.senderOrgId === req.tenant.organizationId
      ? message
      : { ...message, readBy: [...(message.readBy ?? []), req.user.id] },
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

export const postMessage = async (conversationId, { body, attachments }, req) => {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation || !conversation.participantOrgIds.includes(req.tenant.organizationId)) {
    throw ApiError.notFound('Conversation introuvable');
  }
  if (conversation.status !== 'OPEN') throw ApiError.conflict(`Conversation ${conversation.status.toLowerCase()}`);

  const safeAttachments = assertAttachments(attachments ?? []);

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        id: resolveId(),
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
      senderId: message.senderId,
      senderOrgId: message.senderOrgId,
      createdAt: message.createdAt,
    },
  });

  return message;
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
