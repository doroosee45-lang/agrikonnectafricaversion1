import * as service from './plots.service.js';
import { success, paginated, noContent } from '../../shared/http/response.js';
import { executerIdempotent } from '../../middleware/idempotency.js';

export const list = async (req, res) => {
  const { items, total, page, limit } = await service.list(req.query, req);
  return paginated(res, items, { page, limit, total });
};

export const getOne = async (req, res) => success(res, await service.getOne(req.params.id, req));

// Idempotente si `Idempotency-Key` est fourni : création, audit et réponse dans une transaction.
export const create = async (req, res) =>
  executerIdempotent(req, res, async (db) => {
    const { plot, computed } = await service.create(req.body, req, db);
    return { plot, computed };
  }, { message: 'Parcelle créée' });

export const update = async (req, res) =>
  success(res, await service.update(req.params.id, req.body, req), { message: 'Parcelle mise à jour' });

export const archive = async (req, res) => {
  await service.archive(req.params.id, req);
  return noContent(res);
};

export const listHistory = async (req, res) =>
  success(res, await service.listHistory(req.params.id, req));

export const addHistory = async (req, res) =>
  executerIdempotent(req, res, (db) => service.addHistory(req.params.id, req.body, req, db), {
    message: 'Historique cultural ajouté',
  });

export const updateHistory = async (req, res) =>
  success(
    res,
    await service.updateHistory(req.params.id, req.params.historyId, req.body, req),
    { message: 'Historique mis à jour' },
  );
