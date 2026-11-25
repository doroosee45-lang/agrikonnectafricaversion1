import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startHarness } from './support/harness.mjs';
import { connecterSocket } from './support/socketClient.mjs';

/**
 * Révocation des droits sur les sockets existants — W11, W12, W13.
 * TESTÉ : PostgreSQL embarqué, faux GoTrue, vrais WebSockets ; rien de VALIDÉ.
 *
 * Quatre situations distinctes (voir src/realtime/bus.js) :
 *   RV-1 déconnexion d'UNE session (REST /auth/logout) → seuls ses sockets coupés ;
 *   RV-2 compte inactif (suspension, suppression, déconnexion forcée) → tous coupés ;
 *   RV-3 droits réduits (rôle retiré) → sortie des rooms, socket CONSERVÉ ;
 *   RV-4 filet périodique (modification hors API) → délai ≤ intervalle ;
 *   RV-5 multi-instances : seconde instance dans un AUTRE processus, sans
 *        adaptateur partagé → révocation par son filet, délai mesuré.
 * L'expiration du jeton n'entraîne volontairement aucune coupure (décision
 * d'architecture : pas avant adaptation des clients).
 */

const FILET_MS = 400;
const ici = path.dirname(fileURLToPath(import.meta.url));
let h;
let rt;
let port;
let admin;
let svc;
const PASSWORD = 'MotDePasse!2026';
const comptes = {};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const inscrire = async (cle) => {
  const email = `${cle}-rv@agrikonnect.test`;
  const r = await h.request('POST', '/auth/register', {
    body: { accountType: 'FARMER', firstName: cle, lastName: 'Rv', email, password: PASSWORD, countryCode: 'CD', locale: 'fr' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.data.user.id;
  await h.prisma.profile.update({ where: { id }, data: { emailVerifiedAt: new Date() } });
  comptes[cle] = { id, email, organizationId: r.body.data.organization.id, token: await jeton(email) };
};
const jeton = async (email) => (await h.request('POST', '/auth/login', { body: { identifier: email, password: PASSWORD } })).body.data.session.accessToken;
const as = (cle, method, p, opts = {}) => h.request(method, p, { token: comptes[cle].token, ...opts });
const groupe = async (nom, autres) => {
  const g = await as('awa', 'POST', '/messaging/groups', { body: { name: nom, participantOrgIds: autres.map((k) => comptes[k].organizationId) } });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  return g.body.data.id;
};
const reqAdmin = () => ({ user: { id: comptes.awa.id, roles: ['SUPER_ADMIN'] }, headers: {}, ip: '127.0.0.1' });
const recu = (client, roomId, corps) => client.recus('message:new').some((p) => p.conversationId === roomId && JSON.stringify(p).includes(corps));
const attendre = async (condition, maxMs) => {
  const debut = Date.now();
  while (!condition()) {
    if (Date.now() - debut > maxMs) return null;
    await pause(20);
  }
  return Date.now() - debut;
};

before(async () => {
  h = await startHarness();
  for (const cle of ['awa', 'ben', 'cleo', 'dan', 'eli', 'fay', 'gus']) await inscrire(cle);
  const { attachRealtime } = await import('../../src/realtime/index.js');
  admin = await import('../../src/modules/admin/admin.service.js');
  svc = await import('../../src/realtime/bus.js');
  const serveur = http.createServer();
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  port = serveur.address().port;
  rt = { serveur, io: attachRealtime(serveur, { intervalleFiletMs: FILET_MS }) };
}, { timeout: 240_000 });

after(async () => {
  rt?.io?.close();
  await new Promise((r) => (rt?.serveur ? rt.serveur.close(() => r()) : r()));
  await h?.stop?.();
});

test('RV-1 (W13) — déconnexion d’une session : ses sockets sont coupés, l’autre appareil reste connecté', async (t) => {
  const roomId = await groupe('RV1', ['ben']);
  const jeton2 = await jeton(comptes.ben.email);
  const appareil1 = await connecterSocket(port, comptes.ben.token);
  const appareil2 = await connecterSocket(port, jeton2);
  const deco = await as('ben', 'POST', '/auth/logout');
  const delai = await attendre(() => appareil1.ferme, 2000);
  const motif = appareil1.recus('session:revoked')[0]?.reason;
  const envoi = await appareil2.emitAck('send_message', { roomId, content: 'toujours connecté' });
  t.diagnostic(`RV-1 : logout ${deco.status} ; appareil 1 coupé en ${delai} ms (motif ${motif}) ; appareil 2 connecté=${!appareil2.ferme}, envoi ${envoi.ok}`);
  assert.equal(deco.status, 200);
  assert.ok(delai !== null, 'socket de la session déconnectée coupé');
  assert.equal(motif, 'LOGOUT');
  assert.equal(appareil2.ferme, false);
  assert.equal(envoi.ok, true);
  appareil2.fermer();
  comptes.ben.token = jeton2;
});

test('RV-2 (W12) — suspension : coupure immédiate de tous les sockets, plus aucun contenu, reconnexion refusée', async (t) => {
  const roomId = await groupe('RV2', ['cleo']);
  const s1 = await connecterSocket(port, comptes.cleo.token);
  const s2 = await connecterSocket(port, comptes.cleo.token);
  const debut = Date.now();
  await admin.updateUserStatus(comptes.cleo.id, { status: 'SUSPENDED', reason: 'recette RV-2' }, reqAdmin());
  const delaiReponse = Date.now() - debut;
  const coupe = await attendre(() => s1.ferme && s2.ferme, 1000);
  await as('awa', 'POST', `/messaging/conversations/${roomId}/messages`, { body: { body: 'secret RV2' } });
  await pause(200);
  let reconnexion = 'acceptée';
  await connecterSocket(port, comptes.cleo.token).then((c) => c.fermer(), (e) => { reconnexion = `refusée (${e.message})`; });
  t.diagnostic(`RV-2 : service ${delaiReponse} ms ; 2 sockets coupés ${coupe === null ? 'NON' : `en ${coupe} ms après la réponse`} ; motif ${s1.recus('session:revoked')[0]?.reason} ; reconnexion ${reconnexion}`);
  assert.ok(coupe !== null && coupe < 200, 'coupure immédiate (pas le filet)');
  assert.equal(s1.recus('session:revoked')[0]?.reason, 'ACCOUNT_INACTIVE');
  assert.equal(recu(s1, roomId, 'secret RV2') || recu(s2, roomId, 'secret RV2'), false);
  assert.match(reconnexion, /^refusée/);
  await h.prisma.profile.update({ where: { id: comptes.cleo.id }, data: { status: 'ACTIVE' } });
});

test('RV-2 bis — déconnexion forcée et suppression de compte (REST DELETE /me) : coupure immédiate', async (t) => {
  const a = await connecterSocket(port, comptes.dan.token);
  await admin.forceLogout(comptes.dan.id, { reason: 'recette RV-2 bis' }, reqAdmin());
  const coupeForce = await attendre(() => a.ferme, 1000);

  const b = await connecterSocket(port, comptes.eli.token);
  const suppression = await as('eli', 'DELETE', '/me');
  const coupeSuppr = await attendre(() => b.ferme, 1000);
  t.diagnostic(`RV-2 bis : déconnexion forcée → coupé en ${coupeForce} ms (${a.recus('session:revoked')[0]?.reason}) ; DELETE /me ${suppression.status} → coupé en ${coupeSuppr} ms (${b.recus('session:revoked')[0]?.reason})`);
  assert.ok(coupeForce !== null && coupeForce < 200);
  assert.equal(a.recus('session:revoked')[0]?.reason, 'SESSIONS_REVOKED');
  assert.equal(suppression.status, 204, JSON.stringify(suppression.body));
  assert.ok(coupeSuppr !== null && coupeSuppr < 200);
});

test('RV-3 (W11) — rôle retiré : plus de contenu du fil, socket CONSERVÉ (pas de coupure)', async (t) => {
  const roomId = await groupe('RV3', ['fay']);
  const s = await connecterSocket(port, comptes.fay.token);
  await as('awa', 'POST', `/messaging/conversations/${roomId}/messages`, { body: { body: 'avant RV3' } });
  await pause(150);
  const avant = recu(s, roomId, 'avant RV3');
  await admin.revokeRole(comptes.fay.id, 'FARMER', reqAdmin());
  await as('awa', 'POST', `/messaging/conversations/${roomId}/messages`, { body: { body: 'après RV3' } });
  await pause(150);
  const apres = recu(s, roomId, 'après RV3');
  const ping = await s.emitAck('ping:app');
  t.diagnostic(`RV-3 : reçu avant=${avant} ; reçu après retrait=${apres} ; socket connecté=${!s.ferme} ; ping ${Boolean(ping?.at)}`);
  assert.equal(avant, true);
  assert.equal(apres, false);
  assert.equal(s.ferme, false, 'pas de coupure pour des droits réduits');
  assert.ok(ping?.at);
  s.fermer();
});

test(`RV-4 (W11/W12 hors API) — modification directe en base : appliquée par le filet en ≤ ${FILET_MS} ms (+ marge)`, async (t) => {
  const roomId = await groupe('RV4', ['gus']);
  const s = await connecterSocket(port, comptes.gus.token);
  await h.prisma.membership.updateMany({ where: { userId: comptes.gus.id }, data: { status: 'REMOVED' } });
  const debut = Date.now();
  let delaiRooms = null;
  while (Date.now() - debut < FILET_MS * 3) {
    if (!s.ferme && !(await rt.io.in(`conversation:${roomId}`).fetchSockets()).some((x) => x.data?.userId === comptes.gus.id)) {
      delaiRooms = Date.now() - debut;
      break;
    }
    await pause(25);
  }
  await as('awa', 'POST', `/messaging/conversations/${roomId}/messages`, { body: { body: 'après RV4' } });
  await pause(150);
  await h.prisma.profile.update({ where: { id: comptes.gus.id }, data: { status: 'SUSPENDED' } });
  const coupe = await attendre(() => s.ferme, FILET_MS * 3);
  t.diagnostic(`RV-4 : adhésion retirée en base → rooms quittées en ${delaiRooms} ms (socket conservé) ; contenu reçu après=${recu(s, roomId, 'après RV4')} ; suspension en base → coupé en ${coupe} ms ; filet ${JSON.stringify(svc.realtimeStats().filet)}`);
  assert.ok(delaiRooms !== null && delaiRooms <= FILET_MS + 300, `délai ${delaiRooms} ms`);
  assert.equal(recu(s, roomId, 'après RV4'), false);
  assert.ok(coupe !== null && coupe <= FILET_MS + 300, `délai ${coupe} ms`);
  await h.prisma.profile.update({ where: { id: comptes.gus.id }, data: { status: 'ACTIVE' } });
  await h.prisma.membership.updateMany({ where: { userId: comptes.gus.id }, data: { status: 'ACTIVE' } });
});

test('RV-5 — multi-instances (deux processus, sans adaptateur) : immédiat sur l’instance qui traite, filet sur l’autre', async (t) => {
  const FILET_2 = 700;
  const enfant = spawn(process.execPath, [path.join(ici, 'support', 'instanceRealtime.mjs')], {
    env: { ...process.env, INSTANCE_FILET_MS: String(FILET_2) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  try {
    const port2 = await new Promise((resolve, reject) => {
      const delai = setTimeout(() => reject(new Error('seconde instance non démarrée')), 60_000);
      let tampon = '';
      enfant.stdout.on('data', (d) => {
        tampon += d.toString();
        const m = /PORT=(\d+)/.exec(tampon);
        if (m) { clearTimeout(delai); resolve(Number(m[1])); }
      });
      enfant.on('exit', (code) => reject(new Error(`seconde instance arrêtée (${code})`)));
    });
    const surInstance1 = await connecterSocket(port, comptes.ben.token);
    const surInstance2 = await connecterSocket(port2, comptes.ben.token);
    const debut = Date.now();
    await admin.updateUserStatus(comptes.ben.id, { status: 'SUSPENDED', reason: 'recette RV-5' }, reqAdmin());
    const d1 = await attendre(() => surInstance1.ferme, 1000);
    const d2 = await attendre(() => surInstance2.ferme, FILET_2 * 4);
    const total2 = Date.now() - debut;
    t.diagnostic(`RV-5 : instance 1 (traite la requête) coupée en ${d1} ms ; instance 2 (autre processus) coupée ${d2 === null ? 'JAMAIS' : `en ${total2} ms`} — filet ${FILET_2} ms`);
    assert.ok(d1 !== null && d1 < 200, 'immédiat sur l’instance qui traite');
    assert.ok(d2 !== null, 'l’autre instance coupe par son filet');
    assert.ok(total2 <= FILET_2 + 500, `délai ${total2} ms > intervalle + marge`);
  } finally {
    enfant.kill('SIGTERM');
    await h.prisma.profile.update({ where: { id: comptes.ben.id }, data: { status: 'ACTIVE' } });
  }
});
