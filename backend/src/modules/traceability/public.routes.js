import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { success } from '../../shared/http/response.js';
import { publicRateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import * as service from './traceability.service.js';

/**
 * Vue publique d'un lot (QR code produit).
 * Aucune authentification — mais strictement limitée aux `publicFields`.
 */
const router = Router();

router.get('/lots/:code/qr.png', publicRateLimit,
  validate(z.object({ code: z.string().min(4).max(60) }), 'params'),
  validate(z.object({ size: z.coerce.number().int().min(128).max(1024).default(512) }), 'query'),
  asyncHandler(async (req, res) => {
    const { buffer, contentType, filename } = await service.lotQr(req.params.code, {
      size: req.query.size,
    });
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.end(buffer);
  }));

router.get('/lots/:code', publicRateLimit, asyncHandler(async (req, res) =>
  success(res, await service.publicView(req.params.code), {
    message: 'Fiche publique du lot (champs publiés uniquement)',
  })));

export default router;
