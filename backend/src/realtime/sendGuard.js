import { z } from 'zod';
import { can } from '../shared/permissions.js';
import { rolesEffectifs } from '../middleware/tenant.js';

/**
 * Envoi de message par WebSocket (`send_message`) — mêmes règles que le REST.
 *
 * Avant ce garde, l'événement appelait `postMessage` sans permission, sans
 * validation et au nom de la PREMIÈRE organisation de l'utilisateur, quelle
 * que soit la conversation. Il contournait ainsi `authorize('messages.write')`,
 * la garde « compte vérifié » (H-07) et le schéma Zod de la route
 * `POST /messaging/conversations/:id/messages`.
 *
 * Fonction pure : elle ne lit rien en base, ce qui la rend testable sans
 * serveur Socket.IO ni PostgreSQL.
 */

/** Même contrat que `messageSchema` (routes REST), plus le routage socket. */
export const sendMessageSchema = z.object({
  roomId: z.string().min(10).max(60),
  content: z.string().trim().min(1, 'Message vide').max(3000),
  attachments: z.array(z.string().max(500)).max(5).default([]),
  localTempId: z
    .string()
    .min(20)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  /** Organisation active choisie par le client (équivalent de `X-Organization-Id`). */
  organizationId: z.string().min(10).max(60).optional(),
});

/**
 * Construit le contexte d'appel de `postMessage`, ou un refus explicite.
 *
 * @param {object} p
 * @param {string} p.userId
 * @param {boolean} p.verified e-mail ou téléphone vérifié
 * @param {{organizationId: string, roles: string[], organization?: object}[]} p.memberships adhésions ACTIVES
 * @param {string[]} p.participantOrgIds organisations du fil
 * @param {string} [p.organisationDemandee]
 */
export const contexteEnvoi = ({ userId, verified, memberships = [], participantOrgIds = [], organisationDemandee }) => {
  if (!verified) return { ok: false, error: 'ACCOUNT_NOT_VERIFIED' };

  let candidates = memberships.filter((m) => participantOrgIds.includes(m.organizationId));
  if (organisationDemandee) candidates = candidates.filter((m) => m.organizationId === organisationDemandee);
  // Même réponse qu'en REST : on ne révèle pas l'existence d'un fil tiers.
  if (candidates.length === 0) return { ok: false, error: 'NOT_FOUND' };

  const tousRoles = [...new Set(memberships.flatMap((m) => m.roles ?? []))];
  for (const membership of candidates) {
    const effectiveRoles = rolesEffectifs(membership.roles ?? [], tousRoles);
    if (!can(effectiveRoles, 'messages.write')) continue;
    return {
      ok: true,
      req: {
        user: { id: userId, roles: tousRoles },
        tenant: {
          organizationId: membership.organizationId,
          organization: membership.organization ?? null,
          roles: membership.roles ?? [],
          effectiveRoles,
        },
        headers: {},
        ip: 'socket',
      },
    };
  }
  return { ok: false, error: 'PERMISSION_DENIED' };
};
