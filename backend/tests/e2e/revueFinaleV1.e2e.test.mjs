import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startHarness } from './support/harness.mjs';
import { connecterSocket } from './support/socketClient.mjs';

/**
 * Revue contradictoire finale de `correction/backend-v1` — preuves manquantes.
 * TESTÉ (PostgreSQL embarqué, faux GoTrue, stockage simulé) ; rien de VALIDÉ.
 *
 *  A3-X  : aucune clé d'un autre tenant ne peut être signée (même déjà stockée) ;
 *  TX3-* : identité des groupes — sérialisation ≠ unicité fonctionnelle ;
 *  WH-*  : autorisation effective dans les handlers Socket.IO ;
 *  WC-*  : comportement du client Socket.IO (même version que Web et Mobile)
 *          face à `session:revoked` et à une coupure décidée par le serveur.
 */

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let h;
let rt;
let port;
let admin;
let supabaseAdmin;
const signees = [];
const PASSWORD = 'MotDePasse!2026';
const comptes = {};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const inscrire = async (cle, accountType = 'FARMER') => {
  const email = `${cle}-rf@agrikonnect.test`;
  const r = await h.request('POST', '/auth/register', {
    body: { accountType, firstName: cle, lastName: 'Rf', email, password: PASSWORD, countryCode: 'CD', locale: 'fr' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await h.prisma.profile.update({ where: { id: r.body.data.user.id }, data: { emailVerifiedAt: new Date() } });
  const c = await h.request('POST', '/auth/login', { body: { identifier: email, password: PASSWORD } });
  comptes[cle] = { id: r.body.data.user.id, organizationId: r.body.data.organization.id, token: c.body.data.session.accessToken };
};
const as = (cle, method, p, opts = {}) => h.request(method, p, { token: comptes[cle].token, ...opts });
const groupe = async (createur, nom, autres) => {
  const g = await as(createur, 'POST', '/messaging/groups', { body: { name: nom, participantOrgIds: autres.map((k) => comptes[k].organizationId) } });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  return g.body.data;
};
const reqAdmin = () => ({ user: { id: comptes.awa.id, roles: ['SUPER_ADMIN'] }, headers: {}, ip: '127.0.0.1' });

before(async () => {
  h = await startHarness();
  for (const cle of ['awa', 'ben', 'cleo', 'dan', 'eli', 'fay']) await inscrire(cle);
  await inscrire('ivan', 'INVESTOR');
  ({ supabaseAdmin } = await import('../../src/config/supabase.js'));
  Object.defineProperty(supabaseAdmin, 'storage', {
    configurable: true,
    value: {
      from: () => ({
        createSignedUrls: async (cles) => {
          signees.push(...cles);
          return { data: cles.map((p) => ({ path: p, signedUrl: `https://stub.storage/${p}?t=1` })), error: null };
        },
      }),
    },
  });
  admin = await import('../../src/modules/admin/admin.service.js');
  const { attachRealtime } = await import('../../src/realtime/index.js');
  const serveur = http.createServer();
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  port = serveur.address().port;
  rt = { serveur, io: attachRealtime(serveur, { intervalleFiletMs: 60_000 }) };
}, { timeout: 240_000 });

after(async () => {
  delete supabaseAdmin?.storage;
  rt?.io?.close();
  await new Promise((r) => (rt?.serveur ? rt.serveur.close(() => r()) : r()));
  await h?.stop?.();
});

// ═══ A3 ══════════════════════════════════════════════════════════════════

test('A3-X — message ANCIEN de A contenant une clé conforme de B (participant) : jamais signée pour personne', async (t) => {
  const g = await groupe('awa', 'A3X', ['ben']);
  const cleDeBen = `${comptes.ben.organizationId}/documents/2026-11/${randomUUID()}.pdf`;
  await h.prisma.message.create({
    data: { id: randomUUID(), conversationId: g.id, senderId: comptes.awa.id, senderOrgId: comptes.awa.organizationId, body: 'ancien A3X', attachments: [cleDeBen], readBy: [] },
  });
  const avant = signees.length;
  const vueAwa = await as('awa', 'GET', `/messaging/conversations/${g.id}/messages`);
  const sync = await as('awa', 'POST', '/messaging/sync', { body: { lastPulledAt: 0, roomIds: [g.id] } });
  const m = vueAwa.body.data.messages.find((x) => x.body === 'ancien A3X');
  const ms = sync.body.data.created.find((x) => x.content === 'ancien A3X');
  t.diagnostic(`A3-X : attachmentUrls ${JSON.stringify(m.attachmentUrls)} ; sync ${JSON.stringify(ms.attachment_urls)} ; clé transmise au stockage : ${signees.slice(avant).includes(cleDeBen)}`);
  assert.deepEqual(m.attachmentUrls, [null], 'la clé d’un AUTRE tenant que l’expéditeur n’est jamais signée');
  assert.deepEqual(ms.attachment_urls, [null]);
  assert.equal(signees.slice(avant).includes(cleDeBen), false);
});

test('A3-Y — clé conforme de l’EXPÉDITEUR : signée pour les participants (non-régression)', async () => {
  const g = await groupe('awa', 'A3Y', ['ben']);
  const cle = `${comptes.awa.organizationId}/media/2026-11/${randomUUID()}.jpg`;
  assert.equal((await as('awa', 'POST', `/messaging/conversations/${g.id}/messages`, { body: { body: 'a3y', attachments: [cle] } })).status, 201);
  const vueBen = await as('ben', 'GET', `/messaging/conversations/${g.id}/messages`);
  assert.match(vueBen.body.data.messages.find((x) => x.body === 'a3y').attachmentUrls[0], /^https:\/\/stub\.storage\//);
});

// ═══ TX-3 : identité des groupes ═════════════════════════════════════════

test('TX3-1 — même nom « Famille », administrateurs et membres différents, en concurrence : DEUX groupes distincts', async (t) => {
  const corpsA = { name: 'Famille', participantOrgIds: [comptes.ben.organizationId] };
  const corpsB = { name: 'Famille', participantOrgIds: [comptes.dan.organizationId] };
  const reps = await Promise.all([
    ...Array.from({ length: 10 }, () => as('awa', 'POST', '/messaging/groups', { body: corpsA })),
    ...Array.from({ length: 10 }, () => as('cleo', 'POST', '/messaging/groups', { body: corpsB })),
  ]);
  const idsA = new Set(reps.slice(0, 10).map((r) => r.body.data.id));
  const idsB = new Set(reps.slice(10).map((r) => r.body.data.id));
  const groupes = await h.prisma.conversation.findMany({ where: { subjectType: 'GROUP', subjectId: 'GRP:Famille' } });
  t.diagnostic(`TX3-1 : groupes « Famille » ${groupes.length} ; administrateurs ${groupes.map((g) => g.participantOrgIds[0] === comptes.awa.organizationId ? 'awa' : 'cleo').join(',')}`);
  assert.equal(idsA.size, 1);
  assert.equal(idsB.size, 1);
  assert.notEqual([...idsA][0], [...idsB][0], 'aucune collision entre tenants');
  assert.equal(groupes.length, 2);
});

test('TX3-2 — même administrateur, même nom, membres différents : deux groupes (la déduplication exige des membres identiques)', async () => {
  const a = await groupe('awa', 'Projet', ['ben']);
  const b = await groupe('awa', 'Projet', ['dan']);
  const c = await groupe('awa', 'Projet', ['ben']);
  assert.notEqual(a.id, b.id);
  assert.equal(c.id, a.id, 'identique (nom, administrateur, membres) : rejeu');
});

// ═══ W : autorisation effective dans les handlers ═══════════════════════

test('WH-1 — rôle retiré : `typing`, `conversation:join` et `send_message` sont refusés EN PLUS de la sortie des rooms', async (t) => {
  const g = await groupe('awa', 'WH1', ['eli']);
  const eli = await connecterSocket(port, comptes.eli.token);
  const awa = await connecterSocket(port, comptes.awa.token);
  await admin.revokeRole(comptes.eli.id, 'FARMER', reqAdmin());
  eli.emit('typing', { conversationId: g.id });
  await pause(200);
  const typingRecu = awa.recus('typing').some((p) => p.conversationId === g.id);
  const join = await eli.emitAck('conversation:join', { conversationId: g.id });
  const envoi = await eli.emitAck('send_message', { roomId: g.id, content: 'après retrait' });
  t.diagnostic(`WH-1 : typing relayé=${typingRecu} ; join ${JSON.stringify(join)} ; send ${JSON.stringify(envoi)}`);
  assert.equal(typingRecu, false);
  assert.equal(join.ok, false);
  assert.equal(envoi.ok, false);
  assert.equal(await h.prisma.message.count({ where: { conversationId: g.id, body: 'après retrait' } }), 0);
  eli.fermer();
  awa.fermer();
});

test('WH-2 — compte sans `messages.read` (INVESTOR) : ne reçoit aucun contenu de fil, ni à la connexion ni après `conversation:join`', async (t) => {
  const g = await groupe('awa', 'WH2', ['ivan']);
  const ivan = await connecterSocket(port, comptes.ivan.token);
  await as('awa', 'POST', `/messaging/conversations/${g.id}/messages`, { body: { body: 'contenu WH2 a' } });
  await pause(200);
  const recuConnexion = ivan.recus('message:new').some((p) => JSON.stringify(p).includes('contenu WH2 a'));
  const join = await ivan.emitAck('conversation:join', { conversationId: g.id });
  await as('awa', 'POST', `/messaging/conversations/${g.id}/messages`, { body: { body: 'contenu WH2 b' } });
  await pause(200);
  const recuApresJoin = ivan.recus('message:new').some((p) => JSON.stringify(p).includes('contenu WH2 b'));
  const rest = await as('ivan', 'GET', `/messaging/conversations/${g.id}/messages`);
  t.diagnostic(`WH-2 : REST lecture ${rest.status} ; reçu via socket dès la connexion=${recuConnexion} ; join ${JSON.stringify(join)} ; reçu après join=${recuApresJoin}`);
  ivan.fermer();
  assert.equal(rest.status, 403, 'le REST refuse la lecture');
  assert.equal(recuConnexion, false);
  assert.equal(join.ok, false);
  assert.equal(recuApresJoin, false);
});

// ═══ WC : client Socket.IO (version des applications) ══════════════════

const clientIo = () => {
  const require = createRequire(path.join(racine, 'apps/web/package.json'));
  return { io: require('socket.io-client').io, version: require('socket.io-client/package.json').version };
};

test('WC-1 — client Socket.IO des applications : `session:revoked` reçu, coupure serveur, AUCUNE reconnexion automatique', async (t) => {
  const { io, version } = clientIo();
  const client = io(`http://127.0.0.1:${port}`, { path: '/realtime', auth: { token: comptes.fay.token }, transports: ['websocket'], reconnection: true, reconnectionDelay: 200, reconnectionDelayMax: 400 });
  const evenements = [];
  client.on('session:revoked', (p) => evenements.push(`session:revoked:${p.reason}`));
  client.on('disconnect', (raison) => evenements.push(`disconnect:${raison}`));
  client.io.on('reconnect_attempt', () => evenements.push('reconnect_attempt'));
  await new Promise((r, j) => { client.on('connect', r); client.on('connect_error', j); });
  await admin.forceLogout(comptes.fay.id, { reason: 'recette WC-1' }, reqAdmin());
  await pause(1500);
  t.diagnostic(`WC-1 : socket.io-client ${version} ; événements ${JSON.stringify(evenements)} ; connecté après 1,5 s=${client.connected}`);
  client.close();
  assert.ok(evenements.includes('session:revoked:SESSIONS_REVOKED'));
  assert.ok(evenements.includes('disconnect:io server disconnect'));
  assert.equal(evenements.includes('reconnect_attempt'), false, 'aucune reconnexion automatique après coupure serveur');
});

test('WC-2 — comparaison : coupure RÉSEAU (non décidée par le serveur) → le client se reconnecte de lui-même', async (t) => {
  const { io } = clientIo();
  const client = io(`http://127.0.0.1:${port}`, { path: '/realtime', auth: { token: comptes.dan.token }, transports: ['websocket'], reconnection: true, reconnectionDelay: 200, reconnectionDelayMax: 400 });
  const evenements = [];
  client.on('disconnect', (raison) => evenements.push(`disconnect:${raison}`));
  client.io.on('reconnect', () => evenements.push('reconnect'));
  await new Promise((r, j) => { client.on('connect', r); client.on('connect_error', j); });
  client.io.engine.close();
  await pause(1500);
  t.diagnostic(`WC-2 : événements ${JSON.stringify(evenements)} ; connecté=${client.connected}`);
  client.close();
  assert.ok(evenements.includes('reconnect'));
});
