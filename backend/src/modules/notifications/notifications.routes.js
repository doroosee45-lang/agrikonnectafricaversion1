import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { success, created } from '../../shared/http/response.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as push from '../push/push.service.js';
import { paginationSchema } from '../../shared/pagination.js';
import * as service from './notifications.service.js';

const listSchema = paginationSchema.omit({ sort: true, order: true }).extend({
  unread: z.enum(['true', 'false']).optional(),
});

const preferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        type: z.string().trim().min(2).max(80),
        channel: z.enum(['IN_APP', 'EMAIL', 'PUSH', 'SMS']),
        enabled: z.boolean(),
      }),
    )
    .min(1)
    .max(100),
});

const idParam = z.object({ id: z.string().min(5).max(60) });

/** Jeton FCM de l'appareil (Android ou iOS). */
export const registerTokenSchema = z
  .object({
    token: z.string().trim().min(32, 'Jeton push invalide').max(4096),
    platform: z.enum(['android', 'ios']),
    installationId: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/, 'Identifiant d’installation invalide').optional(),
    appVersion: z.string().trim().max(40).optional(),
    locale: z.enum(['fr', 'en']).optional(),
  })
  .strict();

/** Clés réservées par FCM dans `data` (refusées par Google). */
const CLE_DONNEE_RESERVEE = /^(from|notification|message_type|collapse_key)$|^(google|gcm)/i;

export const sendTestSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().min(1).max(500).optional(),
    data: z
      .record(z.string().min(1).max(64), z.union([z.string().max(1000), z.number(), z.boolean()]))
      .refine((d) => Object.keys(d).length <= 20, 'Au plus 20 données')
      .refine((d) => !Object.keys(d).some((k) => CLE_DONNEE_RESERVEE.test(k)), 'Clé de donnée réservée par FCM')
      .optional(),
    userId: z.string().uuid().optional(),
  })
  .strict();

const router = Router();
router.use(authenticate);

// NOTIF-01 — boîte de réception de l'utilisateur courant
router.get('/', authorize('notifications.read'), validate(listSchema, 'query'), asyncHandler(async (req, res) => {
  const { items, total, page, limit, unreadCount } = await service.list(req.query, req);
  return success(res, { items, unreadCount }, {
    meta: { page: Number(page), limit: Number(limit), total: Number(total) },
  });
}));

router.post('/read-all', authorize('notifications.write'), asyncHandler(async (req, res) =>
  success(res, await service.markAllRead(req), { message: 'Notifications marquées comme lues' })));

router.post('/:id/read', authorize('notifications.write'), validate(idParam, 'params'), asyncHandler(async (req, res) =>
  success(res, await service.markRead(req.params.id, req))));

// NOTIF-03 — préférences par type × canal
router.get('/preferences', authorize('notifications.read'), asyncHandler(async (req, res) =>
  success(res, await service.getPreferences(req))));

// Notifications push (FCM) — jeton de l'appareil et envoi de test.
router.post('/register-token', writeLimiter, validate(registerTokenSchema), asyncHandler(async (req, res) =>
  created(res, await push.enregistrerJetonFcm(req.body, req), { message: 'Jeton enregistré' })));

router.post('/send-test', writeLimiter, validate(sendTestSchema), asyncHandler(async (req, res) =>
  success(res, await push.envoyerTest(req.body, req), { message: 'Notification de test traitée' })));

router.put('/preferences', authorize('notifications.write'), validate(preferencesSchema), asyncHandler(async (req, res) =>
  success(res, await service.setPreferences(req.body.preferences, req), { message: 'Préférences enregistrées' })));

export default router;
