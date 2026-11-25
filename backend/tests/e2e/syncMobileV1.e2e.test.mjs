import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { startHarness } from './support/harness.mjs';

/**
 * Synchronisation Mobile ↔ API — OFF-1, OFF-4a, OFF-4b, OFF-6.
 *
 * Exécute le CODE RÉEL du Mobile (modules purs `db/deltaPlan.ts` et
 * `services/syncPull.ts`, importés tels quels par Node) contre la vraie API
 * du banc, avec le schéma SQLite EXTRAIT de `db/schema.ts`, dans node:sqlite.
 * TESTÉ ; ce n'est PAS un appareil (expo-sqlite et le réseau mobile ne sont
 * pas exercés) ; rien de VALIDÉ.
 */

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let h;
let plan;
let pull;
const PASSWORD = 'MotDePasse!2026';
const comptes = {};

const inscrire = async (cle) => {
  const email = `${cle}-sm@agrikonnect.test`;
  const r = await h.request('POST', '/auth/register', {
    body: { accountType: 'FARMER', firstName: cle, lastName: 'Sm', email, password: PASSWORD, countryCode: 'CD', locale: 'fr' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await h.prisma.profile.update({ where: { id: r.body.data.user.id }, data: { emailVerifiedAt: new Date() } });
  const c = await h.request('POST', '/auth/login', { body: { identifier: email, password: PASSWORD } });
  comptes[cle] = { id: r.body.data.user.id, organizationId: r.body.data.organization.id, token: c.body.data.session.accessToken };
};
const as = (cle, method, p, opts = {}) => h.request(method, p, { token: comptes[cle].token, ...opts });

const schemaMessages = () => {
  const schema = fs.readFileSync(path.join(racine, 'apps/Mobile/src/db/schema.ts'), 'utf8');
  const m = /`(CREATE TABLE IF NOT EXISTS messages \([\s\S]*?\);)`/.exec(schema);
  assert.ok(m, 'CREATE TABLE messages introuvable dans apps/Mobile/src/db/schema.ts');
  return m[1];
};

/** Base locale : schéma du Mobile + exécuteur au format de deltaPlan (expo-sqlite → node:sqlite). */
const baseLocale = () => {
  const d = new DatabaseSync(':memory:');
  d.exec(schemaMessages());
  const executeur = {
    premier: async (sql, params) => d.prepare(sql).get(...params) ?? null,
    executer: async (sql, params) => d.prepare(sql).run(...params),
  };
  return {
    d,
    executeur,
    appliquer: async (page) => { for (const m of [...(page.created ?? []), ...(page.updated ?? [])]) await plan.appliquerMessageServeur(executeur, m); },
    compte: () => d.prepare('SELECT count(*) n FROM messages').get().n,
    ids: () => d.prepare('SELECT server_id FROM messages').all().map((r) => r.server_id),
  };
};

const groupe = async (nom) => {
  const g = await as('awa', 'POST', '/messaging/groups', { body: { name: nom, participantOrgIds: [comptes.ben.organizationId] } });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  return g.body.data.id;
};
const tirerAPI = (cle, roomIds) => async (lastPulledAt) =>
  (await as(cle, 'POST', pull.ROUTE_TIRAGE_MESSAGES, { body: { lastPulledAt, roomIds } })).body.data;

before(async () => {
  h = await startHarness();
  for (const cle of ['awa', 'ben']) await inscrire(cle);
  plan = await import(pathToFileURL(path.join(racine, 'apps/Mobile/src/db/deltaPlan.ts')).href);
  pull = await import(pathToFileURL(path.join(racine, 'apps/Mobile/src/services/syncPull.ts')).href);
}, { timeout: 240_000 });

after(async () => {
  await h?.stop?.();
});

test('SM-1 (OFF-1) — la route de tirage du Mobile existe et répond', async () => {
  const roomId = await groupe('SM1');
  const r = await as('ben', 'POST', pull.ROUTE_TIRAGE_MESSAGES, { body: { lastPulledAt: 0, roomIds: [roomId] } });
  assert.equal(pull.ROUTE_TIRAGE_MESSAGES, '/messaging/sync');
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('SM-2 (OFF-4a) — repli REST du Mobile renvoyé deux fois (réponse perdue) : 1 message, id = localTempId', async (t) => {
  const roomId = await groupe('SM2');
  const localTempId = randomUUID();
  const corps = { localTempId, body: 'sm2', attachments: [] };
  const a = await as('awa', 'POST', `/messaging/conversations/${roomId}/messages`, { body: corps });
  const b = await as('awa', 'POST', `/messaging/conversations/${roomId}/messages`, { body: corps });
  const n = await h.prisma.message.count({ where: { conversationId: roomId, body: 'sm2' } });
  t.diagnostic(`SM-2 : ${a.status}/${b.status} ; ids ${a.body.data.id} / ${b.body.data.id} ; messages ${n}`);
  assert.equal(n, 1);
  assert.equal(a.body.data.id, localTempId);
  assert.equal(b.body.data.id, localTempId);
});

test('SM-3 (OFF-4b) — ligne locale portant un id serveur ≠ id local (données d’avant correctif) : intégration sans erreur, 1 ligne', async () => {
  const roomId = await groupe('SM3');
  const r = await as('awa', 'POST', `/messaging/conversations/${roomId}/messages`, { body: { body: 'sm3' } });
  const idServeur = r.body.data.id;
  const loc = baseLocale();
  const uuid = randomUUID();
  // État laissé par l'ancien repli REST : ligne locale = uuid, server_id = id serveur différent.
  loc.d.prepare("INSERT INTO messages (id, server_id, local_temp_id, room_id, sender_id, type, content, sync_status, created_at, updated_at) VALUES (?, ?, ?, ?, 'u', 'TEXT', 'sm3', 'SENT', 0, 0)").run(uuid, idServeur, uuid, roomId);
  const page = await tirerAPI('awa', [roomId])(0);
  await loc.appliquer(page);
  await loc.appliquer(page);
  assert.equal(loc.d.prepare("SELECT count(*) n FROM messages WHERE content = 'sm3'").get().n, 1);
});

test('SM-4 (OFF-6) — longue absence : 1 200 messages, toutes les pages tirées, chacun présent une seule fois', async (t) => {
  const roomId = await groupe('SM4');
  const base = Date.now() - 5 * 24 * 3600_000;
  await h.prisma.message.createMany({
    data: Array.from({ length: 1200 }, (_, i) => ({
      id: `01SM4${String(i).padStart(21, '0')}`, conversationId: roomId, senderId: comptes.awa.id, senderOrgId: comptes.awa.organizationId,
      body: `sm4-${i}`, attachments: [], readBy: [], createdAt: new Date(base + i * 10),
    })),
  });
  const attendus = await h.prisma.message.count({ where: { conversationId: roomId } });
  const loc = baseLocale();
  let curseur = 0;
  const bilan = await pull.tirerToutesLesPages({
    tirer: tirerAPI('ben', [roomId]),
    appliquer: loc.appliquer,
    lireCurseur: async () => curseur,
    ecrireCurseur: async (c) => { curseur = c; },
  });
  t.diagnostic(`SM-4 : bilan ${JSON.stringify(bilan)} ; lignes locales ${loc.compte()} / ${attendus} attendus`);
  assert.equal(bilan.complet, true);
  assert.ok(bilan.pages >= 3);
  assert.equal(loc.compte(), attendus);
  assert.equal(new Set(loc.ids()).size, attendus);
});

test('SM-5 — interruption réseau à la page 2 puis reprise : rien perdu, rien en double, curseur repris', async (t) => {
  const roomId = await groupe('SM5');
  await h.prisma.message.createMany({
    data: Array.from({ length: 1100 }, (_, i) => ({
      id: `01SM5${String(i).padStart(21, '0')}`, conversationId: roomId, senderId: comptes.awa.id, senderOrgId: comptes.awa.organizationId,
      body: `sm5-${i}`, attachments: [], readBy: [], createdAt: new Date(Date.now() - 3600_000 + i),
    })),
  });
  const attendus = await h.prisma.message.count({ where: { conversationId: roomId } });
  const loc = baseLocale();
  let curseur = 0;
  let appels = 0;
  const reel = tirerAPI('ben', [roomId]);
  const options = {
    appliquer: loc.appliquer,
    lireCurseur: async () => curseur,
    ecrireCurseur: async (c) => { curseur = c; },
  };
  await assert.rejects(pull.tirerToutesLesPages({ ...options, tirer: async (c) => { appels += 1; if (appels === 2) throw new Error('réseau coupé'); return reel(c); } }));
  const apresCoupure = { lignes: loc.compte(), curseur };
  const bilan = await pull.tirerToutesLesPages({ ...options, tirer: reel });
  t.diagnostic(`SM-5 : après coupure ${JSON.stringify(apresCoupure)} ; reprise ${JSON.stringify(bilan)} ; lignes ${loc.compte()} / ${attendus}`);
  assert.ok(apresCoupure.lignes > 0 && apresCoupure.curseur > 0, 'page 1 appliquée et curseur enregistré');
  assert.equal(loc.compte(), attendus);
  assert.equal(new Set(loc.ids()).size, attendus);
});

test('SM-6 — page relivrée (même curseur) : absorbée, aucune ligne en double', async () => {
  const roomId = await groupe('SM6');
  for (let i = 0; i < 5; i += 1) await as('awa', 'POST', `/messaging/conversations/${roomId}/messages`, { body: { body: `sm6-${i}` } });
  const loc = baseLocale();
  const page = await tirerAPI('ben', [roomId])(0);
  await loc.appliquer(page);
  await loc.appliquer(page);
  assert.equal(loc.compte(), page.created.length);
});
