import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { startHarness } from './support/harness.mjs';
import { connecterSocket } from './support/socketClient.mjs';

/**
 * Écran de discussion (Mobile) — appuis serveur, SANS migration :
 * - GET /messaging/conversations/:id/peers : fiche des interlocuteurs ;
 * - GET /calls/history?conversationId= : cartes d'appel du fil ;
 * - Socket.IO `presence:query` / `presence:update` : « En ligne » / « Vu récemment » ;
 * - Socket.IO `message:delivered` : coches « reçu » relayées aux membres du fil.
 * PostgreSQL embarqué + GoTrue simulé + vrai serveur Socket.IO.
 */

let h;
let rt;
let port;
const PASSWORD = 'MotDePasse!2026';
const comptes = {};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const inscrire = async (cle, accountType = 'FARMER') => {
  const email = `${cle}-ed@agrikonnect.test`;
  const r = await h.request('POST', '/auth/register', {
    body: { accountType, firstName: cle, lastName: 'Ed', email, password: PASSWORD, countryCode: 'CD', locale: 'fr' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await h.prisma.profile.update({ where: { id: r.body.data.user.id }, data: { emailVerifiedAt: new Date() } });
  const c = await h.request('POST', '/auth/login', { body: { identifier: email, password: PASSWORD } });
  comptes[cle] = { id: r.body.data.user.id, organizationId: r.body.data.organization.id, token: c.body.data.session.accessToken };
};
const as = (cle, method, p, opts = {}) => h.request(method, p, { token: comptes[cle].token, ...opts });
const fil = async (createur, nom, autres) => {
  const g = await as(createur, 'POST', '/messaging/groups', { body: { name: nom, participantOrgIds: autres.map((k) => comptes[k].organizationId) } });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  return g.body.data.id;
};

before(async () => {
  h = await startHarness();
  for (const cle of ['awa', 'ben', 'cleo']) await inscrire(cle);
  const { attachRealtime } = await import('../../src/realtime/index.js');
  const serveur = http.createServer();
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  port = serveur.address().port;
  rt = { serveur, io: attachRealtime(serveur, { intervalleFiletMs: 60_000 }) };
}, { timeout: 240_000 });

after(async () => {
  rt?.io?.close();
  await new Promise((r) => (rt?.serveur ? rt.serveur.close(() => r()) : r()));
  await h?.stop?.();
});

test('ED-1 — fiche des interlocuteurs : nom, métiers, sans e-mail ni téléphone ; refusée à un non-participant', async () => {
  const id = await fil('awa', 'ED1', ['ben']);
  const r = await as('awa', 'GET', `/messaging/conversations/${id}/peers`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.peers.length, 1);
  const pair = r.body.data.peers[0];
  assert.equal(pair.organizationId, comptes.ben.organizationId);
  assert.deepEqual(pair.roles, ['FARMER']);
  assert.equal(JSON.stringify(r.body).includes('@agrikonnect.test'), false, 'aucune adresse e-mail exposée');
  assert.equal((await as('cleo', 'GET', `/messaging/conversations/${id}/peers`)).status, 404);
});

test('ED-2 — historique des appels : terminés seulement, durée, sens ; refusé à un non-participant', async () => {
  const id = await fil('awa', 'ED2', ['ben']);
  const debut = new Date(Date.now() - 600_000);
  const creer = (status, { startedAt = null, endedAt = null } = {}) =>
    h.prisma.callSession.create({
      data: {
        id: randomUUID(), conversationId: id, kind: 'DIRECT', status, roomName: `ak-call-${randomUUID()}`,
        createdBy: comptes.awa.id, callerOrganizationId: comptes.awa.organizationId,
        ringExpiresAt: new Date(debut.getTime() + 45_000), startedAt, endedAt,
        participants: { create: [
          { id: randomUUID(), userId: comptes.awa.id, organizationId: comptes.awa.organizationId, isHost: true, status: 'LEFT' },
          { id: randomUUID(), userId: comptes.ben.id, organizationId: comptes.ben.organizationId, status: status === 'MISSED' ? 'MISSED' : 'LEFT' },
        ] },
      },
    });
  await creer('ENDED', { startedAt: debut, endedAt: new Date(debut.getTime() + 192_000) });
  await creer('MISSED');
  await creer('RINGING');
  const rAwa = await as('awa', 'GET', `/calls/history?conversationId=${id}`);
  assert.equal(rAwa.status, 200, JSON.stringify(rAwa.body));
  const statuts = rAwa.body.data.map((a) => a.status).sort();
  assert.deepEqual(statuts, ['ENDED', 'MISSED'], 'appel en cours exclu');
  const termine = rAwa.body.data.find((a) => a.status === 'ENDED');
  assert.equal(termine.durationSec, 192);
  assert.equal(termine.outgoing, true);
  const rBen = await as('ben', 'GET', `/calls/history?conversationId=${id}`);
  assert.equal(rBen.body.data.find((a) => a.status === 'MISSED').outgoing, false);
  assert.equal((await as('cleo', 'GET', `/calls/history?conversationId=${id}`)).status, 404);
});

test('ED-3 — présence : en ligne pendant la connexion, « vu » après ; mise à jour poussée ; refusée hors du fil', async (t) => {
  const id = await fil('awa', 'ED3', ['ben']);
  const awa = await connecterSocket(port, comptes.awa.token);
  const ben = await connecterSocket(port, comptes.ben.token);
  const cleo = await connecterSocket(port, comptes.cleo.token);
  try {
    const enLigne = await awa.emitAck('presence:query', { conversationId: id });
    assert.equal(enLigne.ok, true, JSON.stringify(enLigne));
    assert.deepEqual(enLigne.presence.map((p) => [p.organizationId, p.online]), [[comptes.ben.organizationId, true]]);
    assert.equal((await cleo.emitAck('presence:query', { conversationId: id })).ok, false, 'hors du fil : refusé');

    ben.fermer();
    await pause(300);
    const apres = await awa.emitAck('presence:query', { conversationId: id });
    t.diagnostic(`ED-3 : après déconnexion ${JSON.stringify(apres.presence)} ; mises à jour reçues ${awa.recus('presence:update').length}`);
    assert.equal(apres.presence[0].online, false);
    assert.ok(Date.parse(apres.presence[0].lastSeenAt) > Date.now() - 10_000, '« vu » horodaté');
    assert.ok(awa.recus('presence:update').some((p) => p.conversationId === id), 'mise à jour poussée au fil');
  } finally {
    awa.fermer();
    cleo.fermer();
  }
});

test('ED-4 — accusé de réception relayé aux membres du fil, jamais au-dehors ; identifiants filtrés', async () => {
  const id = await fil('awa', 'ED4', ['ben']);
  const awa = await connecterSocket(port, comptes.awa.token);
  const ben = await connecterSocket(port, comptes.ben.token);
  const cleo = await connecterSocket(port, comptes.cleo.token);
  try {
    const idMessage = randomUUID();
    ben.emit('message:delivered', { conversationId: id, messageIds: [idMessage, 'x', 42] });
    cleo.emit('message:delivered', { conversationId: id, messageIds: [randomUUID()] });
    await pause(300);
    const recus = awa.recus('message:delivered');
    assert.equal(recus.length, 1, 'seul le membre du fil est relayé');
    assert.deepEqual(recus[0].messageIds, [idMessage], 'identifiants invalides retirés');
    assert.equal(recus[0].userId, comptes.ben.id);
    assert.equal(cleo.recus('message:delivered').length, 0);
  } finally {
    awa.fermer();
    ben.fermer();
    cleo.fermer();
  }
});
