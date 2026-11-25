import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { startHarness } from './support/harness.mjs';

/**
 * Idempotence transactionnelle — I4c, I4b, I7, I6b et exigences de la décision
 * d'architecture : requêtes simultanées, erreurs après écriture métier, arrêt
 * réel du serveur, expirations, reprises, contenu différent.
 * TESTÉ (PostgreSQL embarqué) ; rien de VALIDÉ sur Supabase réel (PgBouncer
 * en mode transaction non exercé).
 */

const ici = path.dirname(fileURLToPath(import.meta.url));
let h;
let idem;
const PASSWORD = 'MotDePasse!2026';
const comptes = {};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const inscrire = async (cle) => {
  const email = `${cle}-idem@agrikonnect.test`;
  const r = await h.request('POST', '/auth/register', {
    body: { accountType: 'FARMER', firstName: cle, lastName: 'Idem', email, password: PASSWORD, countryCode: 'CD', locale: 'fr' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await h.prisma.profile.update({ where: { id: r.body.data.user.id }, data: { emailVerifiedAt: new Date() } });
  const c = await h.request('POST', '/auth/login', { body: { identifier: email, password: PASSWORD } });
  comptes[cle] = { id: r.body.data.user.id, organizationId: r.body.data.organization.id, token: c.body.data.session.accessToken };
};
const post = async (cle, chemin, body, idemKey, extraHeaders = {}) => {
  const r = await h.request('POST', chemin, { token: comptes[cle].token, body, raw: true, headers: { ...(idemKey ? { 'idempotency-key': idemKey } : {}), ...extraHeaders } });
  const texte = r.buffer.toString('utf8');
  return { status: r.status, rejoue: r.headers.get('idempotent-replayed') === 'true', body: texte ? JSON.parse(texte) : null };
};
const fermes = (nom) => h.prisma.farm.count({ where: { name: nom } });
const cles = (cleClient) => h.prisma.idempotencyKey.count({ where: { key: { endsWith: `:${cleClient}` } } });

before(async () => {
  h = await startHarness();
  for (const cle of ['awa', 'ben']) await inscrire(cle);
  idem = await import('../../src/middleware/idempotency.js');
}, { timeout: 240_000 });

after(async () => {
  await h?.stop?.();
});

test('ID-1 — 20 requêtes SIMULTANÉES, même clé : 1 exploitation ; 201 (exécution/rejeu) ou 409 en cours ; le renvoi rejoue', async (t) => {
  const k = `simul-${randomUUID()}`;
  const reps = await Promise.all(Array.from({ length: 20 }, () => post('awa', '/farms', { name: 'ID1', countryCode: 'CD' }, k)));
  const executees = reps.filter((r) => r.status === 201 && !r.rejoue);
  const enCours = reps.filter((r) => r.status === 409);
  const renvoi = await post('awa', '/farms', { name: 'ID1', countryCode: 'CD' }, k);
  t.diagnostic(`ID-1 : exécutée ${executees.length} ; rejouées ${reps.filter((r) => r.rejoue).length} ; 409 en cours ${enCours.length} ; autres ${reps.filter((r) => ![201, 409].includes(r.status)).map((r) => r.status)} ; exploitations ${await fermes('ID1')} ; renvoi ${renvoi.status} rejoué=${renvoi.rejoue}`);
  assert.equal(await fermes('ID1'), 1, 'jamais de doublon');
  assert.ok(reps.every((r) => [201, 409].includes(r.status)), reps.map((r) => `${r.status}:${r.body?.code}`).join(','));
  assert.equal(executees.length, 1, 'une seule exécution réelle');
  assert.ok(enCours.every((r) => r.body.code === 'IDEMPOTENCY_REQUEST_IN_PROGRESS'));
  assert.equal(renvoi.status, 201);
  assert.equal(renvoi.rejoue, true);
  assert.equal(renvoi.body.data.farm.id, executees[0].body.data.farm.id);
});

test('ID-1b — rafale de 30 requêtes sur la même clé : le pool de connexions n’est pas épuisé (requête sans rapport servie)', async (t) => {
  const k = `pool-${randomUUID()}`;
  const rafale = Promise.all(Array.from({ length: 30 }, () => post('awa', '/farms', { name: 'ID1b', countryCode: 'CD' }, k)));
  await pause(20);
  const debut = Date.now();
  const autre = await h.request('GET', '/me', { token: comptes.ben.token });
  const duree = Date.now() - debut;
  const reps = await rafale;
  t.diagnostic(`ID-1b : GET /me pendant la rafale ${autre.status} en ${duree} ms ; statuts rafale ${[...new Set(reps.map((r) => r.status))]} ; exploitations ${await fermes('ID1b')}`);
  assert.equal(autre.status, 200);
  assert.ok(duree < 3000, `requête sans rapport servie en ${duree} ms`);
  assert.ok(reps.every((r) => [201, 409].includes(r.status)), [...new Set(reps.map((r) => `${r.status}:${r.body?.code}`))].join(','));
  assert.equal(await fermes('ID1b'), 1);
});

test('ID-2 (I4c) — erreur APRÈS l’écriture métier, avant validation : rien n’est validé ; la reprise crée 1 exploitation', async (t) => {
  const k = `erreur-${randomUUID()}`;
  const original = h.prisma.$transaction;
  h.prisma.$transaction = (fn, o) => original.call(h.prisma, async (tx) => { const r = await fn(tx); throw new Error('panne après écriture métier'); }, o);
  let a;
  try {
    a = await post('awa', '/farms', { name: 'ID2', countryCode: 'CD' }, k);
  } finally {
    h.prisma.$transaction = original;
  }
  const apresPanne = { fermes: await fermes('ID2'), cles: await cles(k), audits: await h.prisma.auditLog.count({ where: { action: 'farm.create', newValue: { path: ['name'], equals: 'ID2' } } }) };
  const b = await post('awa', '/farms', { name: 'ID2', countryCode: 'CD' }, k);
  t.diagnostic(`ID-2 : 1er appel ${a.status} ; après panne ${JSON.stringify(apresPanne)} ; reprise ${b.status} rejouée=${b.rejoue} ; exploitations finales ${await fermes('ID2')}`);
  assert.equal(a.status, 500);
  assert.deepEqual(apresPanne, { fermes: 0, cles: 0, audits: 0 }, 'ni exploitation, ni clé, ni audit');
  assert.equal(b.status, 201);
  assert.equal(b.rejoue, false);
  assert.equal(await fermes('ID2'), 1);
});

test('ID-3 — ARRÊT RÉEL du serveur (SIGKILL) pendant la transaction : rien de validé ; la reprise crée 1 exploitation', async (t) => {
  const k = `kill-${randomUUID()}`;
  const enfant = spawn(process.execPath, [path.join(ici, 'support', 'instanceApi.mjs')], { env: { ...process.env }, stdio: ['ignore', 'pipe', 'ignore'] });
  let liberer;
  const verrouLibere = new Promise((r) => { liberer = r; });
  let verrou;
  try {
    const port2 = await new Promise((resolve, reject) => {
      const d = setTimeout(() => reject(new Error('instance API non démarrée')), 60_000);
      let tampon = '';
      enfant.stdout.on('data', (x) => { tampon += x; const m = /PORT=(\d+)/.exec(tampon); if (m) { clearTimeout(d); resolve(Number(m[1])); } });
      enfant.on('exit', (c) => reject(new Error(`instance arrêtée (${c})`)));
    });
    // Verrou EXCLUSIVE sur `farms` : l'INSERT de l'instance 2 bloque APRÈS la réservation de la clé.
    let verrouPose;
    const pose = new Promise((r) => { verrouPose = r; });
    verrou = h.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`LOCK TABLE farms IN EXCLUSIVE MODE`;
      verrouPose();
      await verrouLibere;
    }, { timeout: 60_000, maxWait: 10_000 });
    await pose;
    const requete = fetch(`http://127.0.0.1:${port2}/api/v1/farms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${comptes.awa.token}`, 'idempotency-key': k },
      body: JSON.stringify({ name: 'ID3', countryCode: 'CD' }),
    }).then((r) => `HTTP ${r.status}`, (e) => `interrompue (${e.cause?.code ?? e.message})`);
    // Attendre que la transaction de l'instance 2 soit bloquée sur le verrou.
    let bloquee = false;
    for (let i = 0; i < 100 && !bloquee; i += 1) {
      const [{ n }] = await h.prisma.$queryRaw`SELECT count(*)::int AS n FROM pg_locks WHERE relation = 'farms'::regclass AND NOT granted`;
      bloquee = n > 0;
      if (!bloquee) await pause(50);
    }
    assert.ok(bloquee, 'la transaction de l’instance 2 est en attente sur farms');
    enfant.kill('SIGKILL');
    const issue = await requete;
    liberer();
    await verrou;
    // Laisser PostgreSQL constater la fin de la connexion et annuler.
    let etat;
    for (let i = 0; i < 50; i += 1) {
      etat = { fermes: await fermes('ID3'), cles: await cles(k) };
      if (etat.fermes === 0 && etat.cles === 0) break;
      await pause(100);
    }
    const reprise = await post('awa', '/farms', { name: 'ID3', countryCode: 'CD' }, k);
    t.diagnostic(`ID-3 : requête vers l’instance tuée ${issue} ; état après arrêt ${JSON.stringify(etat)} ; reprise ${reprise.status} rejouée=${reprise.rejoue} ; exploitations finales ${await fermes('ID3')}`);
    assert.deepEqual(etat, { fermes: 0, cles: 0 }, 'aucune écriture validée par le processus tué');
    assert.equal(reprise.status, 201);
    assert.equal(await fermes('ID3'), 1);
  } finally {
    liberer();
    enfant.kill('SIGKILL');
    await verrou?.catch?.(() => {});
  }
});

test('ID-4 (I6b) — même clé, corps différent : 422 IDEMPOTENCY_KEY_REUSED, aucune 2e création', async () => {
  const k = `corps-${randomUUID()}`;
  const a = await post('awa', '/farms', { name: 'ID4-A', countryCode: 'CD' }, k);
  const b = await post('awa', '/farms', { name: 'ID4-B', countryCode: 'CD' }, k);
  assert.equal(a.status, 201);
  assert.equal(b.status, 422);
  assert.equal(b.body.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(await fermes('ID4-B'), 0);
});

test('ID-5 — rejeu après succès : réponse identique, en-tête Idempotent-Replayed, aucune 2e création ni 2e audit', async () => {
  const k = `rejeu-${randomUUID()}`;
  const a = await post('awa', '/farms', { name: 'ID5', countryCode: 'CD' }, k);
  const b = await post('awa', '/farms', { name: 'ID5', countryCode: 'CD' }, k);
  assert.equal(b.status, 201);
  assert.equal(b.rejoue, true);
  assert.deepEqual(b.body, a.body);
  assert.equal(await fermes('ID5'), 1);
  assert.equal(await h.prisma.auditLog.count({ where: { action: 'farm.create', resourceId: a.body.data.farm.id } }), 1);
});

test('ID-6 (I7) — clé expirée : nouvelle exécution (pas de rejeu) ; la purge supprime les clés expirées', async () => {
  const k = `expire-${randomUUID()}`;
  await post('awa', '/farms', { name: 'ID6', countryCode: 'CD' }, k);
  await h.prisma.idempotencyKey.updateMany({ where: { key: { endsWith: `:${k}` } }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const b = await post('awa', '/farms', { name: 'ID6', countryCode: 'CD' }, k);
  assert.equal(b.status, 201);
  assert.equal(b.rejoue, false);
  assert.equal(await fermes('ID6'), 2, 'nouvelle exécution après expiration (sémantique voulue)');
  assert.equal(await cles(k), 1, 'une seule clé, renouvelée');
  await h.prisma.idempotencyKey.updateMany({ where: { key: { endsWith: `:${k}` } }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const { deleted } = await idem.purgerClesExpirees();
  assert.ok(deleted >= 1);
  assert.equal(await cles(k), 0);
});

test('ID-7 (I4b, transition) — ligne « en cours » héritée de l’ancien mécanisme : 409 tant qu’elle vit, reprise après expiration', async () => {
  const k = `herite-${randomUUID()}`;
  const cleStockee = idem.cleIdempotenceV1(comptes.awa.id, comptes.awa.organizationId, k);
  await h.prisma.idempotencyKey.create({ data: { key: cleStockee, scope: 'farms.create', userId: comptes.awa.id, responseStatus: null, expiresAt: new Date(Date.now() + 3600_000) } });
  const a = await post('awa', '/farms', { name: 'ID7', countryCode: 'CD' }, k);
  await h.prisma.idempotencyKey.updateMany({ where: { key: cleStockee }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const b = await post('awa', '/farms', { name: 'ID7', countryCode: 'CD' }, k);
  assert.equal(a.status, 409);
  assert.equal(b.status, 201);
  assert.equal(await fermes('ID7'), 1);
});

test('ID-8 — même clé : autre utilisateur, autre organisation active, autre opération → portées indépendantes', async () => {
  const k = `portee-${randomUUID()}`;
  const a = await post('awa', '/farms', { name: 'ID8', countryCode: 'CD' }, k);
  const b = await post('ben', '/farms', { name: 'ID8', countryCode: 'CD' }, k);
  const coop = await h.request('POST', '/organizations', { token: comptes.awa.token, body: { type: 'COOPERATIVE', name: 'Coop ID8', countryCode: 'CD' } });
  assert.equal(coop.status, 201, JSON.stringify(coop.body));
  const c = await post('awa', '/farms', { name: 'ID8', countryCode: 'CD' }, k, { 'X-Organization-Id': coop.body.data.id });
  const p = await post('awa', '/plots', { farmId: a.body.data.farm.id, name: 'Parcelle ID8', areaHa: 1, geometry: { type: 'Point', coordinates: [15.3, -4.3] } }, k);
  assert.deepEqual([a.status, b.status, c.status, p.status], [201, 201, 201, 201], JSON.stringify([b.body, c.body, p.body].map((x) => x?.code)));
  assert.deepEqual([b.rejoue, c.rejoue, p.rejoue], [false, false, false]);
  assert.equal(await fermes('ID8'), 3);
});

test('ID-9 — les quatre créations idempotentes rejouent (exploitation, parcelle, production, historique cultural)', async () => {
  const f = await post('awa', '/farms', { name: 'ID9', countryCode: 'CD' }, `f-${randomUUID()}`);
  const geo = { type: 'Point', coordinates: [15.3, -4.3] };
  const kp = `p-${randomUUID()}`;
  const p1 = await post('awa', '/plots', { farmId: f.body.data.farm.id, name: 'P-ID9', areaHa: 1, geometry: geo }, kp);
  const p2 = await post('awa', '/plots', { farmId: f.body.data.farm.id, name: 'P-ID9', areaHa: 1, geometry: geo }, kp);
  const crop = await h.prisma.crop.findFirst({ where: { deletedAt: null } });
  const kh = `h-${randomUUID()}`;
  const corpsH = { cropId: crop.id, season: '2026A', year: 2026 };
  const h1 = await post('awa', `/plots/${p1.body.data.plot.id}/crop-history`, corpsH, kh);
  const h2 = await post('awa', `/plots/${p1.body.data.plot.id}/crop-history`, corpsH, kh);
  const kr = `r-${randomUUID()}`;
  const corpsR = { farmId: f.body.data.farm.id, cropId: crop.id, harvestedAt: '2026-06-01T00:00:00.000Z', season: '2026A', quantity: 100, unit: 'kg' };
  const r1 = await post('awa', '/productions', corpsR, kr);
  const r2 = await post('awa', '/productions', corpsR, kr);
  const statuts = [p1, p2, h1, h2, r1, r2].map((x) => `${x.status}${x.rejoue ? 'R' : ''}${x.status >= 400 ? `:${JSON.stringify(x.body?.errors ?? x.body?.message).slice(0, 80)}` : ''}`);
  assert.deepEqual([p2.rejoue, h2.rejoue, r2.rejoue], [true, true, true], statuts.join(' '));
  assert.equal(await h.prisma.plot.count({ where: { name: 'P-ID9' } }), 1);
  assert.equal(await h.prisma.production.count({ where: { farmId: f.body.data.farm.id } }), 1);
});

test('ID-10 — sans en-tête (Web) : comportement inchangé, deux créations', async () => {
  const a = await post('awa', '/farms', { name: 'ID10', countryCode: 'CD' });
  const b = await post('awa', '/farms', { name: 'ID10', countryCode: 'CD' });
  assert.deepEqual([a.status, b.status], [201, 201]);
  assert.equal(await fermes('ID10'), 2);
});
