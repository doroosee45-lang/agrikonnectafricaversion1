import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { startHarness } from './support/harness.mjs';
import { connecterSocket } from './support/socketClient.mjs';

/**
 * A3 — pièces jointes : clés strictes, URL externes refusées, compatibilité
 * des données antérieures. TESTÉ (PostgreSQL embarqué, stockage simulé) ;
 * rien de VALIDÉ sur Supabase réel (Storage n'est pas exercé).
 */

let h;
let rt;
let port;
let supabaseAdmin;
const PASSWORD = 'MotDePasse!2026';
const comptes = {};
const signees = [];

const inscrire = async (cle) => {
  const email = `${cle}-pj@agrikonnect.test`;
  const r = await h.request('POST', '/auth/register', {
    body: { accountType: 'FARMER', firstName: cle, lastName: 'Pj', email, password: PASSWORD, countryCode: 'CD', locale: 'fr' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.data.user.id;
  await h.prisma.profile.update({ where: { id }, data: { emailVerifiedAt: new Date() } });
  const c = await h.request('POST', '/auth/login', { body: { identifier: email, password: PASSWORD } });
  comptes[cle] = { id, organizationId: r.body.data.organization.id, token: c.body.data.session.accessToken };
};
const as = (cle, method, p, opts = {}) => h.request(method, p, { token: comptes[cle].token, ...opts });
const envoyer = (roomId, attachments) => as('awa', 'POST', `/messaging/conversations/${roomId}/messages`, { body: { body: 'pj', attachments } });

before(async () => {
  h = await startHarness();
  for (const cle of ['awa', 'ben']) await inscrire(cle);
  ({ supabaseAdmin } = await import('../../src/config/supabase.js'));
  // Stockage simulé : enregistre chaque clé transmise à la signature.
  Object.defineProperty(supabaseAdmin, 'storage', {
    configurable: true,
    value: {
      from: () => ({
        createSignedUploadUrl: async (cle) => ({ data: { signedUrl: `https://stub.storage/upload/${cle}`, path: cle, token: 't' }, error: null }),
        createSignedUrl: async (cle) => ({ data: { signedUrl: `https://stub.storage/${cle}?t=1` }, error: null }),
        createSignedUrls: async (cles) => {
          signees.push(...cles);
          return { data: cles.map((p) => ({ path: p, signedUrl: `https://stub.storage/${p}?t=1` })), error: null };
        },
      }),
    },
  });
  const { attachRealtime } = await import('../../src/realtime/index.js');
  const serveur = http.createServer();
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  port = serveur.address().port;
  rt = { serveur, io: attachRealtime(serveur) };
}, { timeout: 240_000 });

after(async () => {
  delete supabaseAdmin?.storage;
  rt?.io?.close();
  await new Promise((r) => (rt?.serveur ? rt.serveur.close(() => r()) : r()));
  await h?.stop?.();
});

const groupe = async (nom) => {
  const g = await as('awa', 'POST', '/messaging/groups', { body: { name: nom, participantOrgIds: [comptes.ben.organizationId] } });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  return g.body.data.id;
};

test('PJ-1 — clé obtenue par le vrai `POST /media/upload-url` : conforme, acceptée, signée pour le destinataire', async (t) => {
  const roomId = await groupe('PJ1');
  const presign = await as('awa', 'POST', '/media/upload-url', { body: { filename: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 1000, kind: 'IMAGE' } });
  assert.equal(presign.status, 201, JSON.stringify(presign.body));
  const cle = presign.body.data.storageKey;
  const envoi = await envoyer(roomId, [cle]);
  const fil = await as('ben', 'GET', `/messaging/conversations/${roomId}/messages`);
  const m = fil.body.data.messages.find((x) => x.attachments.includes(cle));
  t.diagnostic(`PJ-1 : clé ${cle} ; envoi ${envoi.status} ; URL destinataire ${m?.attachmentUrls?.[0]}`);
  assert.equal(envoi.status, 201, JSON.stringify(envoi.body));
  assert.match(m.attachmentUrls[0], /^https:\/\/stub\.storage\//);
});

test('PJ-2 — URL externe refusée pour un nouveau message, en REST comme en socket', async () => {
  const roomId = await groupe('PJ2');
  const rest = await envoyer(roomId, ['https://exemple.cd/a.mp3']);
  assert.equal(rest.status, 422);
  assert.equal(rest.body.errors?.[0]?.code, 'external_url_refused');
  const s = await connecterSocket(port, comptes.awa.token);
  const ack = await s.emitAck('send_message', { roomId, content: 'lien', attachments: ['http://exemple.cd/x.png'] });
  s.fermer();
  assert.equal(ack.ok, false);
  assert.equal(ack.error, 'VALIDATION_ERROR');
  assert.equal(await h.prisma.message.count({ where: { conversationId: roomId, body: 'lien' } }), 0);
});

test('PJ-3 — formes non conformes refusées en `invalid_storage_key` (traversée, forme libre, catégorie, mois)', async () => {
  const roomId = await groupe('PJ3');
  const org = comptes.awa.organizationId;
  const u = randomUUID();
  for (const piece of [`${org}/../${comptes.ben.organizationId}/documents/2026-11/${u}.pdf`, `${org}/media/2026-11/photo.jpg`, `${org}/autre/2026-11/${u}.jpg`, `${org}/media/2026-13/${u}.jpg`, `${org}//media/2026-11/${u}.jpg`]) {
    const r = await envoyer(roomId, [piece]);
    assert.equal(r.status, 422, piece);
    assert.equal(r.body.errors?.[0]?.code, 'invalid_storage_key', piece);
  }
});

test('PJ-4 — données antérieures (URL externe, traversée) : renvoyées INCHANGÉES, jamais signées', async (t) => {
  const roomId = await groupe('PJ4');
  const traversee = `${comptes.awa.organizationId}/../${comptes.ben.organizationId}/documents/2026-11/${randomUUID()}.pdf`;
  const ancienne = ['https://ancien.exemple/a.png', traversee];
  await h.prisma.message.create({
    data: { id: randomUUID(), conversationId: roomId, senderId: comptes.awa.id, senderOrgId: comptes.awa.organizationId, body: 'ancien message', attachments: ancienne, readBy: [] },
  });
  const avant = signees.length;
  const fil = await as('ben', 'GET', `/messaging/conversations/${roomId}/messages`);
  const sync = await as('ben', 'POST', '/messaging/sync', { body: { lastPulledAt: 0, roomIds: [roomId] } });
  const m = fil.body.data.messages.find((x) => x.body === 'ancien message');
  const ms = sync.body.data.created.find((x) => x.content === 'ancien message');
  const signeesIci = signees.slice(avant);
  t.diagnostic(`PJ-4 : attachments ${JSON.stringify(m.attachments)} ; attachmentUrls ${JSON.stringify(m.attachmentUrls)} ; sync attachment_urls ${JSON.stringify(ms.attachment_urls)} ; clés transmises à la signature ${JSON.stringify(signeesIci)}`);
  assert.deepEqual(m.attachments, ancienne, 'aucune modification des données existantes');
  assert.deepEqual(m.attachmentUrls, [null, null]);
  assert.deepEqual(ms.attachment_urls, [null, null]);
  assert.equal(signeesIci.some((c) => ancienne.includes(c)), false, 'aucune clé non conforme transmise au stockage');
  assert.equal(await h.prisma.message.count({ where: { body: 'ancien message', attachments: { equals: ancienne } } }), 1);
});
