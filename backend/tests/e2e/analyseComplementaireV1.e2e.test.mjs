import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { startHarness } from './support/harness.mjs';
import { connecterSocket } from './support/socketClient.mjs';

/**
 * Analyse complémentaire V1 — démonstrations SANS modification du code applicatif.
 *
 * TESTÉ (et non VALIDÉ) : PostgreSQL EMBARQUÉ (version du banc, pas celle de
 * Supabase), faux GoTrue, vrais WebSockets. Rien n'est exécuté sur Supabase réel.
 *
 *  C*  contrat Mobile ↔ API : requêtes EXACTES d'OfflineSyncEngine.ts ;
 *  L*  base locale Mobile : SQL EXTRAIT À L'EXÉCUTION de apps/Mobile/src/db
 *      (aucune copie : si le Mobile change, le test lit la nouvelle version),
 *      exécuté dans node:sqlite ;
 *  P*  sémantique PostgreSQL sur laquelle repose la proposition d'idempotence ;
 *  W13 session révoquée et socket existant.
 *
 * Convention : test normal = conforme ; `todo` = anomalie confirmée (le test
 * affirme le comportement attendu, son échec montre l'observé).
 */

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PASSWORD = 'MotDePasse!2026';
const comptes = {};
let h;
let rt;
let port;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const inscrire = async (cle) => {
  const email = `${cle}-analyse@agrikonnect.test`;
  const r = await h.request('POST', '/auth/register', {
    body: { accountType: 'FARMER', firstName: cle, lastName: 'Analyse', email, password: PASSWORD, countryCode: 'CD', locale: 'fr' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const c = await h.request('POST', '/auth/login', { body: { identifier: email, password: PASSWORD } });
  const id = r.body.data.user.id;
  await h.prisma.profile.update({ where: { id }, data: { emailVerifiedAt: new Date() } });
  comptes[cle] = { id, email, organizationId: r.body.data.organization.id, token: c.body.data.session.accessToken };
};
const as = (cle, method, p, opts = {}) => h.request(method, p, { token: comptes[cle].token, ...opts });
const groupe = async (cle, nom, autres) => {
  const g = await as(cle, 'POST', '/messaging/groups', { body: { name: nom, participantOrgIds: autres.map((k) => comptes[k].organizationId) } });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  return g.body.data.id;
};

before(async () => {
  h = await startHarness();
  for (const cle of ['awa', 'ben', 'eve']) await inscrire(cle);
  const { attachRealtime } = await import('../../src/realtime/index.js');
  const serveur = http.createServer();
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  port = serveur.address().port;
  rt = { serveur, io: attachRealtime(serveur) };
}, { timeout: 240_000 });

after(async () => {
  rt?.io?.close();
  await new Promise((r) => (rt?.serveur ? rt.serveur.close(() => r()) : r()));
  await h?.stop?.();
});

// ═══ C — contrat Mobile ↔ API (requêtes exactes d'OfflineSyncEngine.ts) ═══

test(
  'C1 (OFF-1) — le tirage du Mobile (`POST /chat/sync`) atteint une route existante',
  { todo: 'ANOMALIE OFF-1 — /chat/sync n’existe pas ; le backend expose /messaging/sync' },
  async () => {
    const r = await as('awa', 'POST', '/chat/sync', { body: { lastPulledAt: 0, roomIds: [] } });
    assert.equal(r.status, 200, `observé ${r.status} ${JSON.stringify(r.body)}`);
  },
);

test('C2 — `POST /messaging/sync` avec le corps du Mobile : champs attendus par applyServerDelta présents', async () => {
  const roomId = await groupe('awa', 'C2', ['ben']);
  const r = await as('ben', 'POST', '/messaging/sync', { body: { lastPulledAt: 0, roomIds: [roomId] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const m = r.body.data.created[0];
  for (const champ of ['id', 'server_id', 'local_temp_id', 'room_id', 'sender_id', 'sender_org_id', 'type', 'content', 'attachments', 'read_by', 'created_at', 'updated_at']) {
    assert.ok(champ in m, `champ ${champ} absent`);
  }
  assert.equal(typeof r.body.data.serverTimestamp, 'number');
  assert.equal(typeof r.body.data.hasMore, 'boolean');
});

test('C3 — envoi socket avec un UUID v4 (format du Mobile) renvoyé deux fois : un seul message, id = localTempId', async () => {
  const roomId = await groupe('awa', 'C3', ['ben']);
  const localTempId = randomUUID();
  const s = await connecterSocket(port, comptes.awa.token);
  const a = await s.emitAck('send_message', { localTempId, roomId, content: 'c3', type: 'TEXT', attachments: [] });
  const b = await s.emitAck('send_message', { localTempId, roomId, content: 'c3', type: 'TEXT', attachments: [] });
  s.fermer();
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(b.serverId, a.serverId);
  assert.equal(a.serverId, localTempId);
  assert.equal(await h.prisma.message.count({ where: { conversationId: roomId, body: 'c3' } }), 1);
});

test(
  'C4 (OFF-4a) — repli REST du Mobile renvoyé deux fois (réponse perdue) : un seul message',
  { todo: 'ANOMALIE OFF-4a — `localTempId` retiré par la validation Zod : doublon serveur, id ≠ localTempId' },
  async (t) => {
    const roomId = await groupe('awa', 'C4', ['ben']);
    const localTempId = randomUUID();
    const corps = { localTempId, body: 'c4', attachments: [] };
    const a = await as('awa', 'POST', `/messaging/conversations/${roomId}/messages`, { body: corps });
    const b = await as('awa', 'POST', `/messaging/conversations/${roomId}/messages`, { body: corps });
    const n = await h.prisma.message.count({ where: { conversationId: roomId, body: 'c4' } });
    t.diagnostic(`C4 : statuts ${a.status}/${b.status} ; ids ${a.body.data.id} / ${b.body.data.id} ; localTempId ${localTempId} ; messages en base ${n}`);
    assert.equal(n, 1, `observé : ${n} messages, id renvoyé ${a.body.data.id} ≠ localTempId`);
  },
);

test('C5 (WEB-1) — forme réelle du fil `GET /messaging/conversations/:id/messages` : `data.messages`, pas `data.items`', async () => {
  const roomId = await groupe('awa', 'C5', ['ben']);
  const r = await as('ben', 'GET', `/messaging/conversations/${roomId}/messages`);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.data.messages), 'data.messages est la liste');
  assert.equal(r.body.data.items, undefined, 'data.items absent : apps/web/src/pages/app/Messages.tsx:208 lit `.items` et obtient donc une liste vide');
});

// ═══ L — base locale Mobile : SQL extrait de apps/Mobile/src/db, exécuté dans node:sqlite ═══

const sqlMobile = (() => {
  const schema = fs.readFileSync(path.join(racine, 'apps/Mobile/src/db/schema.ts'), 'utf8');
  const db = fs.readFileSync(path.join(racine, 'apps/Mobile/src/db/database.ts'), 'utf8');
  const extraire = (source, motif, nom) => {
    const m = motif.exec(source);
    assert.ok(m, `instruction SQL introuvable dans le Mobile : ${nom}`);
    return m[1];
  };
  return {
    creerTable: extraire(schema, /`(CREATE TABLE IF NOT EXISTS messages \([\s\S]*?\);)`/, 'CREATE TABLE messages'),
    insererOptimiste: extraire(db, /`(INSERT INTO messages \(id, server_id[^`]*?VALUES \(\?, NULL,[^`]*?\))`/, 'enqueueOptimisticMessage'),
    marquerEnvoye: extraire(db, /"(UPDATE messages SET server_id = \?, sync_status = 'SENT'[^"]*)"/, 'markMessageSent'),
    appliquerDelta: extraire(db, /`(INSERT INTO messages \([^`]*ON CONFLICT\(local_temp_id\)[^`]*)`/, 'applyServerDelta'),
  };
})();

/** Rejoue les appels de database.ts dans l'ordre et avec les paramètres de son code. */
const baseLocale = () => {
  const d = new DatabaseSync(':memory:');
  d.exec(sqlMobile.creerTable);
  const now = Date.now();
  return {
    d,
    // enqueueOptimisticMessage : [msg.id, msg.local_temp_id, room, sender, senderOrg, type, content, localMediaUri, attachments, read_by, sync_status, now, now]
    optimiste: (uuid, room, content) =>
      d.prepare(sqlMobile.insererOptimiste).run(uuid, uuid, room, 'u', null, 'TEXT', content, null, '[]', '[]', 'PENDING', now, now),
    // markMessageSent : [serverId, serverTimestamp, localTempId]
    envoye: (uuid, serverId) => d.prepare(sqlMobile.marquerEnvoye).run(serverId, now, uuid),
    // applyServerDelta : clé = local_temp_id || server_id || id
    delta: (m) => {
      const cle = m.local_temp_id || m.server_id || m.id;
      d.prepare(sqlMobile.appliquerDelta).run(m.id, m.server_id ?? m.id, cle, m.room_id, m.sender_id, m.sender_org_id, m.type ?? 'TEXT', m.content, m.remote_media_url ?? null, JSON.stringify(m.attachments ?? []), JSON.stringify(m.read_by ?? []), m.created_at, m.updated_at, m.deleted_at ?? null);
    },
    compte: () => d.prepare('SELECT count(*) n FROM messages').get().n,
  };
};

const tirerDelta = async (cle, roomId) => (await as(cle, 'POST', '/messaging/sync', { body: { lastPulledAt: 0, roomIds: [roomId] } })).body.data.created;

test('L1 — envoi par socket puis tirage : la ligne locale est fusionnée (ON CONFLICT(local_temp_id)), 1 seule ligne', async () => {
  const roomId = await groupe('awa', 'L1', ['ben']);
  const uuid = randomUUID();
  const s = await connecterSocket(port, comptes.awa.token);
  const ack = await s.emitAck('send_message', { localTempId: uuid, roomId, content: 'l1', attachments: [] });
  s.fermer();
  const loc = baseLocale();
  loc.optimiste(uuid, roomId, 'l1');
  loc.envoye(uuid, ack.serverId);
  for (const m of (await tirerDelta('awa', roomId)).filter((x) => x.content === 'l1')) loc.delta(m);
  assert.equal(loc.compte(), 1);
});

test('L2 — même page relivrée deux fois (interruption, recouvrement) : aucune ligne en double', async () => {
  const roomId = await groupe('awa', 'L2', ['ben']);
  for (let i = 0; i < 5; i += 1) await as('awa', 'POST', `/messaging/conversations/${roomId}/messages`, { body: { body: `l2-${i}` } });
  const page = await tirerDelta('ben', roomId);
  const loc = baseLocale();
  page.forEach(loc.delta);
  page.forEach(loc.delta);
  assert.equal(loc.compte(), page.length);
});

test(
  'L3 (OFF-4b) — envoi par repli REST puis tirage : intégration du delta sans erreur, 1 seule ligne',
  { todo: 'ANOMALIE OFF-4b — UNIQUE(server_id) violée : applyServerDelta échoue après un envoi REST' },
  async () => {
    const roomId = await groupe('awa', 'L3', ['ben']);
    const uuid = randomUUID();
    const r = await as('awa', 'POST', `/messaging/conversations/${roomId}/messages`, { body: { localTempId: uuid, body: 'l3' } });
    const loc = baseLocale();
    loc.optimiste(uuid, roomId, 'l3');
    loc.envoye(uuid, r.body.data.id);
    let erreur = null;
    try {
      for (const m of (await tirerDelta('awa', roomId)).filter((x) => x.content === 'l3')) loc.delta(m);
    } catch (e) {
      erreur = e.message;
    }
    assert.equal(erreur, null, `observé : ${erreur}`);
    assert.equal(loc.compte(), 1);
  },
);

// ═══ P — sémantique PostgreSQL sous-jacente à la proposition d'idempotence ═══

const scope = 'analyse.farms.create';
const nouvelleCle = () => `analyse:${randomUUID()}`;
const ferme = (tx, nom) =>
  tx.farm.create({ data: { id: randomUUID(), organizationId: comptes.eve.organizationId, name: nom, slug: `${nom}-${randomUUID()}`, countryCode: 'CD' } });
const cle = (tx, key, extra = {}) =>
  tx.idempotencyKey.create({ data: { key, scope, userId: comptes.eve.id, expiresAt: new Date(Date.now() + 3600_000), ...extra } });

test('P0 — niveau d’isolation du banc', async (t) => {
  const [{ transaction_isolation: niveau }] = await h.prisma.$queryRaw`SHOW transaction_isolation`;
  const [{ server_version: version }] = await h.prisma.$queryRaw`SHOW server_version`;
  t.diagnostic(`P0 : isolation ${niveau} ; PostgreSQL ${version} (banc embarqué, pas Supabase)`);
  assert.equal(niveau, 'read committed');
});

test('P1 — deux transactions, même clé : la seconde ATTEND la première, puis échoue en conflit d’unicité (P2002)', async (t) => {
  const key = nouvelleCle();
  let liberer;
  const verrou = new Promise((r) => { liberer = r; });
  const a = h.prisma.$transaction(async (tx) => { await cle(tx, key); await ferme(tx, 'p1-a'); await verrou; }, { timeout: 20_000 });
  await pause(200);
  const debut = Date.now();
  let etatB = 'en attente';
  const b = h.prisma
    .$transaction(async (tx) => { await cle(tx, key); await ferme(tx, 'p1-b'); }, { timeout: 20_000, maxWait: 20_000 })
    .then(() => { etatB = 'validée'; }, (e) => { etatB = e.code ?? e.message; });
  await pause(700);
  const pendantAttente = etatB;
  liberer();
  await a;
  await b;
  t.diagnostic(`P1 : B pendant que A est ouverte = « ${pendantAttente} » ; B après validation de A = ${etatB} ; attente ≈ ${Date.now() - debut} ms`);
  assert.equal(pendantAttente, 'en attente');
  assert.equal(etatB, 'P2002');
  assert.equal(await h.prisma.farm.count({ where: { name: { startsWith: 'p1-' } } }), 1, 'une seule écriture métier');
});

test('P2 — échec après l’écriture métier, avant validation : tout est annulé ; la reprise crée 1 ressource', async () => {
  const key = nouvelleCle();
  await assert.rejects(
    h.prisma.$transaction(async (tx) => { await cle(tx, key); await ferme(tx, 'p2'); throw new Error('échec injecté après écriture'); }),
  );
  assert.equal(await h.prisma.idempotencyKey.count({ where: { key } }), 0);
  assert.equal(await h.prisma.farm.count({ where: { name: 'p2' } }), 0);
  await h.prisma.$transaction(async (tx) => { await cle(tx, key); await ferme(tx, 'p2'); });
  assert.equal(await h.prisma.farm.count({ where: { name: 'p2' } }), 1);
});

test('P3 — connexion de la transaction tuée côté serveur (pg_terminate_backend) : ni clé ni ressource', async (t) => {
  const key = nouvelleCle();
  let liberer;
  const verrou = new Promise((r) => { liberer = r; });
  let pid;
  const a = h.prisma
    .$transaction(async (tx) => {
      await cle(tx, key);
      await ferme(tx, 'p3');
      [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      await verrou;
      await tx.$queryRaw`SELECT 1`;
    }, { timeout: 20_000 })
    .then(() => 'validée', (e) => `annulée (${e.code ?? e.message.slice(0, 60)})`);
  await pause(300);
  await h.prisma.$queryRaw`SELECT pg_terminate_backend(${pid}::int)`;
  liberer();
  const issue = await a;
  t.diagnostic(`P3 : transaction ${issue}`);
  assert.notEqual(issue, 'validée');
  assert.equal(await h.prisma.idempotencyKey.count({ where: { key } }), 0);
  assert.equal(await h.prisma.farm.count({ where: { name: 'p3' } }), 0);
});

test('P4 — clé expirée reprise par deux transactions concurrentes (×10) : toujours 1 clé et 1 ressource', async (t) => {
  const bilans = [];
  for (let manche = 0; manche < 10; manche += 1) {
    const key = nouvelleCle();
    const nom = `p4-${manche}`;
    await h.prisma.idempotencyKey.create({ data: { key, scope, userId: comptes.eve.id, expiresAt: new Date(Date.now() - 1000) } });
    const reprendre = () =>
      h.prisma
        .$transaction(async (tx) => {
          await tx.idempotencyKey.deleteMany({ where: { key, scope, expiresAt: { lt: new Date() } } });
          await cle(tx, key);
          await ferme(tx, nom);
          await pause(50);
        }, { timeout: 20_000, maxWait: 20_000 })
        .then(() => 'ok', (e) => e.code ?? 'erreur');
    const issues = await Promise.all([reprendre(), reprendre()]);
    const cles = await h.prisma.idempotencyKey.count({ where: { key } });
    const fermes = await h.prisma.farm.count({ where: { name: nom } });
    bilans.push(`${issues.join('/')}→${cles}c/${fermes}f`);
    assert.equal(cles, 1, bilans.join(' '));
    assert.equal(fermes, 1, bilans.join(' '));
  }
  t.diagnostic(`P4 : ${bilans.join(' ')}`);
});

test('P5 — une violation d’unicité DANS la transaction l’annule entièrement (25P02) : le conflit se traite hors transaction', async (t) => {
  const key = nouvelleCle();
  await h.prisma.idempotencyKey.create({ data: { key, scope, userId: comptes.eve.id, expiresAt: new Date(Date.now() + 3600_000) } });
  let message = null;
  await h.prisma
    .$transaction(async (tx) => {
      await cle(tx, key).catch(() => {});
      await tx.$queryRaw`SELECT 1`;
    })
    .catch((e) => { message = e.message; });
  t.diagnostic(`P5 : ${String(message).split('\n').find((l) => /abort|25P02|transaction/i.test(l)) ?? message}`);
  assert.match(String(message), /current transaction is aborted|25P02/i);
});

// ═══ W13 — session révoquée, socket existant ═══

test(
  'W13 — session révoquée (déconnexion) : le socket déjà ouvert ne peut plus envoyer (coupé, ou envoi refusé)',
  async (t) => {
    const roomId = await groupe('awa', 'W13', ['ben']);
    const s = await connecterSocket(port, comptes.ben.token);
    const avant = await s.emitAck('send_message', { roomId, content: 'avant déconnexion' });
    const deco = await as('ben', 'POST', '/auth/logout');
    const rest = await as('ben', 'GET', '/me');
    // Correctif W13 : la session déconnectée est COUPÉE (bus.revoquerSessionJeton).
    // Sinon, un envoi doit au minimum être refusé.
    for (let i = 0; i < 25 && !s.ferme; i += 1) await pause(20);
    const apres = s.ferme ? { coupe: true } : await s.emitAck('send_message', { roomId, content: 'après déconnexion' }).catch((e) => ({ erreur: e.message }));
    s.fermer();
    const persistes = await h.prisma.message.count({ where: { conversationId: roomId, body: 'après déconnexion' } });
    t.diagnostic(`W13 : socket avant=${avant.ok} ; logout ${deco.status} ; REST après ${rest.status} ; socket après=${JSON.stringify(apres)} ; motif ${s.recus('session:revoked')[0]?.reason}`);
    assert.equal(rest.status, 401, 'le REST refuse le jeton révoqué');
    assert.ok(apres.coupe === true || apres.ok === false, `le socket devrait être coupé ou refuser : ${JSON.stringify(apres)}`);
    assert.equal(persistes, 0, 'aucun message persisté après la déconnexion');
  },
);
