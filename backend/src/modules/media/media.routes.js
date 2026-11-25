import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { authenticate } from '../../middleware/auth.js';
import { resolveTenant } from '../../middleware/tenant.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './media.controller.js';
import * as schema from './media.schema.js';

const router = Router();

router.use(authenticate, resolveTenant);

/*
 * Téléversement : producteur (`media.upload`) OU acteur de la messagerie
 * (`messages.write`) pour les pièces jointes de conversation. Sans cette
 * alternative, acheteurs, fournisseurs, transporteurs, agronomes et
 * modérateurs — autorisés à écrire — recevaient un 403 dès qu'ils joignaient
 * un fichier. Le fichier reste rangé sous l'organisation ACTIVE et tout
 * rattachement (exploitation, parcelle, annonce) passe par `assertOwnership`.
 */
router.post(
  '/upload-url',
  authorize('media.upload', 'messages.write'),
  validate(schema.uploadUrlSchema),
  asyncHandler(controller.createUploadUrl),
);
router.post(
  '/:id/confirm',
  authorize('media.upload', 'messages.write'),
  validate(schema.mediaIdParam, 'params'),
  asyncHandler(controller.confirm),
);
router.get('/', asyncHandler(controller.list));
router.delete(
  '/:id',
  authorize('media.delete'),
  validate(schema.mediaIdParam, 'params'),
  asyncHandler(controller.remove),
);

export default router;
