import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { startHarness } from './support/harness.mjs';

/**
 * Stabilisation backend V1 — couche temps réel et messagerie, de bout en bout.
 *
 * Vrais WebSockets (protocole Socket.IO v4 parlé directement sur `ws`, sans
 * dépendance ajoutée) contre `attachRealtime`, base PostgreSQL réelle, jetons
 * délivrés par le faux GoTrue du banc. Verrouille :
 *   - R2 : une charge utile `null` ou un accusé qui n'est pas une fonction ne
 *     lève plus d'exception non capturée (arrêt du serveur en production) ;
 *   - R4 : un événement émis dès la connexion n'est plus perdu ;
 *   - R3 : compte suspendu ou adhésion retirée APRÈS la connexion → refus ;
 *   - D4 : organisation retirée d'un groupe → plus aucun message reçu ;
 *   - M3 : un groupe homonyme d'un autre administrateur n'est pas réutilisé ;
 *   - M4 : objet de conversation sans modèle → 422 et non 500 ;
 *   - I1 : idempotence facultative des créations V1 (exploitations, parcelles, productions).
 */

let h;
let rt;
let port;
const PASSWORD = 'MotDePasse!2026';
const comptes = {};
const exceptions = [];
const capturer = (erreur) => exceptions.push(erreur);

const inscrire = async (cle) => {
  const email = `${cle}-rt@agrikonnect.test`;
  const r = await h.request('POST', '/auth/register', {
    body: { accountType: 'FARMER', firstName: cle, lastName: 'Rt', email, password: PASSWORD, countryCode: 'CD', locale: 'fr' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const c = await h.request('POST', '/auth/login', { body: { identifier: email, password: PASSWORD } });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const id = r.body.data.user.id;
  await h.prisma.profile.update({ where: { id }, data: { emailVerifiedAt: new Date() } });
  comptes[cle] = { id, organizationId: r.body.data.organization.id, token: c.body.data.session.accessToken };
};

const as = (cle, method, path, opts = {}) => h.request(method, path, { token: comptes[cle].token, ...opts });

/**
 * Client Socket.IO minimal (Engine.IO v4, transport WebSocket).
 * Par défaut, résout à l'événement `ready` (rooms chargées) ; `immediat: true`
 * résout dès l'acceptation de la connexion, comme un client qui émet aussitôt.
 */
const connecter = (token, { immediat = false } = {}) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/realtime/?EIO=4&transport=websocket`);
    const attentes = new Map();
    const evenements = [];
    let prochainAck = 0;
    const client = {
      ferme: false,
      evenements,
      emit: (...args) => ws.send(`42${JSON.stringify(args)}`),
      emitAck: (...args) =>
        new Promise((res, rej) => {
          const id = ++prochainAck;
          const delai = setTimeout(() => rej(new Error(`pas d'accusé pour ${args[0]}`)), 5000);
          attentes.set(id, (valeur) => {
            clearTimeout(delai);
            res(valeur);
          });
          ws.send(`42${id}${JSON.stringify(args)}`);
        }),
      recus: (nom) => evenements.filter(([e]) => e === nom).map(([, p]) => p),
      fermer: () => ws.close(),
    };
    ws.on('message', (data) => {
      const t = data.toString();
      if (t === '2') return ws.send('3');
      if (t[0] === '0') return ws.send(`40${JSON.stringify({ token })}`);
      if (t.startsWith('40')) return immediat ? resolve(client) : undefined;
      if (t.startsWith('44')) return reject(new Error(t));
      if (t.startsWith('41')) {
        client.ferme = true;
        return undefined;
      }
      if (t.startsWith('43')) {
        const [, id, corps] = /^43(\d+)([\s\S]*)$/.exec(t);
        attentes.get(Number(id))?.(JSON.parse(corps)[0]);
        return undefined;
      }
      if (t.startsWith('42')) {
        const evenement = JSON.parse(t.slice(2));
        evenements.push(evenement);
        if (evenement[0] === 'ready' && !immediat) resolve(client);
      }
      return undefined;
    });
    ws.on('close', () => {
      client.ferme = true;
    });
    ws.on('error', reject);
  });

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  h = await startHarness();
  for (const cle of ['awa', 'ben', 'cleo', 'dina']) await inscrire(cle);

  const { attachRealtime } = await import('../../src/realtime/index.js');
  const serveur = http.createServer();
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  port = serveur.address().port;
  rt = { serveur, io: attachRealtime(serveur) };

  process.on('uncaughtException', capturer);
  process.on('unhandledRejection', capturer);
}, { timeout: 240_000 });

after(async () => {
  process.off('uncaughtException', capturer);
  process.off('unhandledRejection', capturer);
  rt?.io?.close();
  await new Promise((r) => (rt?.serveur ? rt.serveur.close(() => r()) : r()));
  await h?.stop?.();
});

test('R2 — charges utiles malformées : aucune exception non capturée, le serveur répond toujours', async () => {
  const awa = await connecter(comptes.awa.token);

  awa.emit('typing', null);
  awa.emit('typing', 'texte');
  awa.emit('conversation:leave', null);
  awa.emit('conversation:join', null);
  awa.emit('conversation:join', [1, 2]);
  awa.emit('ping:app', 'pas-une-fonction');
  awa.emit('send_message', null, 'pas-une-fonction');
  const refus = await awa.emitAck('send_message', null);
  assert.deepEqual(refus, { ok: false, error: 'INVALID_PAYLOAD' });
  const joinVide = await awa.emitAck('conversation:join', null);
  assert.deepEqual(joinVide, { ok: false, error: 'MISSING_ID' });

  await pause(300);
  assert.deepEqual(exceptions.map((e) => e?.message ?? String(e)), [], 'aucune exception non capturée');

  const pong = await awa.emitAck('ping:app');
  assert.ok(pong?.at, 'le serveur répond encore après les charges malformées');
  awa.fermer();
});

test('R3 — compte suspendu après la connexion : envoi refusé et socket coupé', async () => {
  const g = await as('awa', 'POST', '/messaging/groups', {
    body: { name: 'Suspension', participantOrgIds: [comptes.ben.organizationId] },
  });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  const roomId = g.body.data.id;

  const ben = await connecter(comptes.ben.token);
  const ok = await ben.emitAck('send_message', { roomId, content: 'Avant suspension' });
  assert.equal(ok.ok, true, JSON.stringify(ok));

  await h.prisma.profile.update({ where: { id: comptes.ben.id }, data: { status: 'SUSPENDED' } });
  try {
    const refus = await ben.emitAck('send_message', { roomId, content: 'Après suspension' });
    assert.deepEqual(refus, { ok: false, error: 'UNAUTHORIZED' });
    await pause(200);
    assert.equal(ben.ferme, true, 'socket coupé');
    const persistes = await h.prisma.message.count({ where: { conversationId: roomId, body: 'Après suspension' } });
    assert.equal(persistes, 0, 'aucun message persisté');
  } finally {
    await h.prisma.profile.update({ where: { id: comptes.ben.id }, data: { status: 'ACTIVE' } });
  }
});

test('R3 + D4 — organisation retirée du groupe : plus de messages reçus, ni de réadhésion à la room', async () => {
  const g = await as('awa', 'POST', '/messaging/groups', {
    body: { name: 'Retrait', participantOrgIds: [comptes.cleo.organizationId] },
  });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  const roomId = g.body.data.id;

  const cleo = await connecter(comptes.cleo.token);
  const rejoint = await cleo.emitAck('conversation:join', { conversationId: roomId });
  assert.deepEqual(rejoint, { ok: true });

  const avant = await as('awa', 'POST', `/messaging/conversations/${roomId}/messages`, { body: { body: 'Visible' } });
  assert.equal(avant.status, 201, JSON.stringify(avant.body));
  await pause(200);
  assert.ok(cleo.recus('message:new').some((p) => p.conversationId === roomId), 'reçu avant retrait');

  const retrait = await as('awa', 'DELETE', `/messaging/conversations/${roomId}/members/${comptes.cleo.organizationId}`);
  assert.equal(retrait.status, 200, JSON.stringify(retrait.body));
  await pause(200);
  assert.ok(cleo.recus('conversation:removed').some((p) => p.conversationId === roomId), 'retrait notifié');

  const nombreAvant = cleo.recus('message:new').length;
  const apres = await as('awa', 'POST', `/messaging/conversations/${roomId}/messages`, { body: { body: 'Confidentiel' } });
  assert.equal(apres.status, 201);
  await pause(300);
  assert.equal(cleo.recus('message:new').length, nombreAvant, 'aucun message reçu après retrait');

  const reessai = await cleo.emitAck('conversation:join', { conversationId: roomId });
  assert.deepEqual(reessai, { ok: false, error: 'FORBIDDEN' });
  const envoi = await cleo.emitAck('send_message', { roomId, content: 'Intrusion' });
  assert.deepEqual(envoi, { ok: false, error: 'NOT_FOUND' });
  cleo.fermer();
});

test('R4 — événement émis dès la connexion : traité, avec accusé (file hors ligne mobile)', async () => {
  const g = await as('awa', 'POST', '/messaging/groups', {
    body: { name: 'Reconnexion', participantOrgIds: [comptes.dina.organizationId] },
  });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  const dina = await connecter(comptes.dina.token, { immediat: true });
  const ack = await dina.emitAck('send_message', { roomId: g.body.data.id, content: 'Envoyé dès la reconnexion' });
  assert.equal(ack.ok, true, JSON.stringify(ack));
  dina.fermer();
});

test('M3 — groupe homonyme : jamais réutilisé pour un autre administrateur ou d’autres membres', async () => {
  const a = await as('awa', 'POST', '/messaging/groups', {
    body: { name: 'Famille', participantOrgIds: [comptes.ben.organizationId, comptes.dina.organizationId] },
  });
  assert.equal(a.status, 201);

  const b = await as('ben', 'POST', '/messaging/groups', {
    body: { name: 'Famille', participantOrgIds: [comptes.awa.organizationId] },
  });
  assert.equal(b.status, 201);
  assert.notEqual(b.body.data.id, a.body.data.id, 'nouveau groupe, et non celui d’Awa qui contient Dina');
  assert.deepEqual(new Set(b.body.data.participantOrgIds), new Set([comptes.ben.organizationId, comptes.awa.organizationId]));
  assert.equal(b.body.data.participantOrgIds[0], comptes.ben.organizationId, 'Ben administre son groupe');

  const rejeu = await as('awa', 'POST', '/messaging/groups', {
    body: { name: 'Famille', participantOrgIds: [comptes.dina.organizationId, comptes.ben.organizationId] },
  });
  assert.equal(rejeu.body.data.id, a.body.data.id, 'double envoi identique : même groupe');
});

test('M4 — conversation sur un objet sans modèle : 422 (VALIDATION_ERROR) et non 500', async () => {
  for (const subjectType of ['FARM', 'ORGANIZATION', 'COOPERATIVE']) {
    const r = await as('awa', 'POST', '/messaging/conversations', {
      body: { subjectType, subjectId: comptes.awa.organizationId, participantOrgIds: [comptes.ben.organizationId] },
    });
    assert.equal(r.status, 422, `${subjectType} : ${JSON.stringify(r.body)}`);
  }
});

test('I1 — création renvoyée après coupure (même Idempotency-Key) : rejouée, aucun doublon ; sans clé, inchangé', async () => {
  const cle = 'mobile-01KXYZABCDEFGHJKMNPQRSTVW';
  const corps = { name: 'Ferme Idempotente', countryCode: 'CD' };
  const premier = await as('dina', 'POST', '/farms', { body: corps, headers: { 'idempotency-key': cle } });
  assert.equal(premier.status, 201, JSON.stringify(premier.body));
  const rejeu = await as('dina', 'POST', '/farms', { body: corps, headers: { 'idempotency-key': cle } });
  assert.equal(rejeu.status, 201);
  assert.equal(rejeu.body.data.farm.id, premier.body.data.farm.id, 'même exploitation renvoyée');
  const nombre = await h.prisma.farm.count({ where: { organizationId: comptes.dina.organizationId, name: corps.name } });
  assert.equal(nombre, 1, 'aucun doublon en base');

  // Une clé ne rejoue jamais la réponse d'un autre utilisateur (M-01).
  const autre = await as('awa', 'POST', '/farms', { body: corps, headers: { 'idempotency-key': cle } });
  assert.equal(autre.status, 201);
  assert.notEqual(autre.body.data.farm.id, premier.body.data.farm.id);

  // Web : sans en-tête, deux créations distinctes, aucun 400.
  const w1 = await as('dina', 'POST', '/farms', { body: { name: 'Ferme Web', countryCode: 'CD' } });
  const w2 = await as('dina', 'POST', '/farms', { body: { name: 'Ferme Web', countryCode: 'CD' } });
  assert.equal(w1.status, 201);
  assert.equal(w2.status, 201);
  assert.notEqual(w1.body.data.farm.id, w2.body.data.farm.id);
});
