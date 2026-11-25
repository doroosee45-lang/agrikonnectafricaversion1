/**
 * POOL-1 — saturation du pool de connexions Prisma traduite en 503.
 *
 * Avant : P2024 tombait dans le cas par défaut → 422 « Erreur base de
 * données (P2024) ». Un client (file hors ligne mobile, React Query) classe un
 * 4xx comme définitif et ne rejoue pas : une surcharge passagère devenait une
 * perte d'écriture côté utilisateur. Après : 503 + Retry-After.
 * TESTÉ (unitaire, erreurs Prisma réelles de @prisma/client 5.22.0).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

import * as gestionnaire from '../src/shared/http/errorHandler.js';

// Import tolérant : la contre-preuve s'exécute aussi sur l'ancien fichier.
const { errorHandler } = gestionnaire;
const RETRY_AFTER_POOL_SECONDES = gestionnaire.RETRY_AFTER_POOL_SECONDES ?? 2;

const capturer = (erreur) => {
  const sortie = { entetes: {} };
  const req = { id: 'req-pool', method: 'POST', originalUrl: '/test', headers: {} };
  const res = {
    set(k, v) { sortie.entetes[k] = v; return this; },
    status(s) { sortie.statut = s; return this; },
    json(c) { sortie.corps = c; return this; },
  };
  errorHandler(erreur, req, res, () => {});
  return sortie;
};

const erreurPrisma = (code, message) =>
  new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: Prisma.prismaVersion?.client ?? '5.22.0' });

test('POOL-1a — P2024 (délai de connexion au pool) → 503 DB_POOL_EXHAUSTED + Retry-After', () => {
  const r = capturer(erreurPrisma('P2024', 'Timed out fetching a new connection from the connection pool. (Current connection pool timeout: 10, connection limit: 5)'));
  assert.equal(r.statut, 503);
  assert.equal(r.corps.code, 'DB_POOL_EXHAUSTED');
  assert.equal(r.entetes['Retry-After'], String(RETRY_AFTER_POOL_SECONDES));
  assert.deepEqual(r.corps.details, { retryAfterSeconds: RETRY_AFTER_POOL_SECONDES });
  assert.equal(r.corps.success, false);
  assert.ok(r.corps.requestId);
});

test('POOL-1b — P2028 « Unable to start a transaction » (maxWait dépassé) → 503', () => {
  const r = capturer(erreurPrisma('P2028', 'Transaction API error: Unable to start a transaction in the given time.'));
  assert.equal(r.statut, 503);
  assert.equal(r.corps.code, 'DB_POOL_EXHAUSTED');
});

test('POOL-1c — autres P2028 (transaction expirée) : traitement inchangé (422), pas de Retry-After', () => {
  const r = capturer(erreurPrisma('P2028', 'Transaction API error: Transaction already closed: A commit cannot be executed on an expired transaction.'));
  assert.equal(r.statut, 422);
  assert.equal(r.entetes['Retry-After'], undefined);
});

test('POOL-1d — non-régression : P2002 → 409, P2025 → 404, code inconnu → 422', () => {
  assert.equal(capturer(erreurPrisma('P2002', 'unique')).statut, 409);
  assert.equal(capturer(erreurPrisma('P2025', 'absent')).statut, 404);
  assert.equal(capturer(erreurPrisma('P2034', 'conflit')).statut, 422);
});
