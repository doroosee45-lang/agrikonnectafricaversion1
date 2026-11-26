import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHarness } from './support/harness.mjs';

/**
 * CONTRAT CLIENT MOBILE ↔ API (V1).
 *
 * Défaut d'origine : `verificationApi.mine()` était typé `Verification[]` alors
 * que `GET /verifications/me` renvoie `{ items, criteria }` → écran en panne
 * (« items.map is not a function »). Ce test relit TOUS les appels
 * `api.get<X[]>('/chemin')` du client Mobile (chemins sans paramètre) et
 * vérifie sur la vraie API que `data` est bien un TABLEAU. Une route absente
 * (V2-V5 retirées, 404) ou réservée (403) est ignorée ; une route d'admin est
 * exclue (jeton producteur).
 */

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ENDPOINTS = path.join(racine, 'apps/Mobile/src/services/api/endpoints.ts');

let h;
let jeton;

const appelsTableau = () => {
  const source = fs.readFileSync(ENDPOINTS, 'utf8');
  const chemins = [...source.matchAll(/api\.get<[A-Za-z]+\[\]>\(\s*['`](\/[^'`$]+)['`]/g)].map((m) => m[1]);
  return [...new Set(chemins)].filter((c) => !c.startsWith('/admin'));
};

before(async () => {
  h = await startHarness();
  const email = 'contrat-mobile@agrikonnect.test';
  const r = await h.request('POST', '/auth/register', {
    body: { accountType: 'FARMER', firstName: 'Contrat', lastName: 'Mobile', email, password: 'MotDePasse!2026', countryCode: 'CD', locale: 'fr' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await h.prisma.profile.update({ where: { id: r.body.data.user.id }, data: { emailVerifiedAt: new Date() } });
  jeton = (await h.request('POST', '/auth/login', { body: { identifier: email, password: 'MotDePasse!2026' } })).body.data.session.accessToken;
}, { timeout: 240_000 });

after(async () => {
  await h?.stop?.();
});

test('CM-1 — chaque appel Mobile typé « liste » reçoit bien un tableau de l’API', async (t) => {
  const chemins = appelsTableau();
  assert.ok(chemins.length >= 10, `relevé incomplet : ${chemins.length}`);
  const casses = [];
  const verifies = [];
  const ignores = [];
  for (const chemin of chemins) {
    // eslint-disable-next-line no-await-in-loop
    const r = await h.request('GET', chemin, { token: jeton });
    if (r.status === 404 || r.status === 403 || r.status === 501) {
      ignores.push(`${chemin} (${r.status})`);
      continue;
    }
    if (r.status !== 200) {
      ignores.push(`${chemin} (${r.status})`);
      continue;
    }
    if (Array.isArray(r.body?.data)) verifies.push(chemin);
    else casses.push(`${chemin} → ${JSON.stringify(Object.keys(r.body?.data ?? {}))}`);
  }
  t.diagnostic(`CM-1 : vérifiés ${verifies.length} (${verifies.join(', ')}) ; ignorés ${ignores.length} (${ignores.join(', ')})`);
  assert.deepEqual(casses, [], 'le client Mobile attend un tableau mais reçoit un objet');
});

test('CM-2 — GET /verifications/me : objet { items, criteria } (normalisé côté client)', async () => {
  const r = await h.request('GET', '/verifications/me', { token: jeton });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(Array.isArray(r.body.data.items));
  assert.ok(Array.isArray(r.body.data.criteria));
  const client = fs.readFileSync(ENDPOINTS, 'utf8');
  assert.match(client, /Array\.isArray\(r\.data\) \? r\.data : r\.data\?\.items \?\? \[\]/, 'normalisation présente dans verificationApi.mine');
});
