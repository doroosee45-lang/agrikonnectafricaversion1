import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startHarness } from './support/harness.mjs';
import { connecterSocket } from './support/socketClient.mjs';

/**
 * Revue contradictoire backend V1 — lots R2 (sécurité) et R3 (intégrité, synchronisation).
 *
 * Banc : PostgreSQL EMBARQUÉ jetable (et non Supabase réel), faux GoTrue, vrais
 * WebSockets contre `attachRealtime`. Aucun code métier n'est modifié par ce fichier.
 *
 * Convention :
 *  - test normal  → scénario conforme, comportement attendu vérifié ;
 *  - test `todo`  → ANOMALIE non corrigée (arbitrage requis). Le test affirme le
 *    comportement ATTENDU ; son échec, visible dans le journal, montre le
 *    comportement OBSERVÉ. `todo` ne fait pas échouer la suite mais n'est jamais
 *    compté comme réussi.
 *
 * Identifiants : W* WebSocket, A* pièces jointes, I* idempotence, S* synchronisation.
 * Voir docs/PREUVES_SECURITE_WEBSOCKET.md et docs/PREUVES_IDEMPOTENCE_SYNC.md.
 */

let h;
let port;
let rt;
let supabaseAdmin;
let env;
const PASSWORD = 'MotDePasse!2026';
const comptes = {};
const point = { type: 'Point', coordinates: [15.3, -4.3] };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const inscrire = async (cle, accountType = 'FARMER') => {
  const email = `${cle}-revue@agrikonnect.test`;
  const r = await h.request('POST', '/auth/register', {
    body: { accountType, firstName: cle, lastName: 'Revue', email, password: PASSWORD, countryCode: 'CD', locale: 'fr' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const c = await h.request('POST', '/auth/login', { body: { identifier: email, password: PASSWORD } });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const id = r.body.data.user.id;
  await h.prisma.profile.update({ where: { id }, data: { emailVerifiedAt: new Date() } });
  comptes[cle] = { id, organizationId: r.body.data.organization.id, token: c.body.data.session.accessToken };
};

const as = (cle, method, path, opts = {}) => h.request(method, path, { token: comptes[cle].token, ...opts });

/** Requête avec en-têtes de réponse (pour `Idempotent-Replayed`). */
const brut = async (cle, method, path, { body, headers = {} } = {}) => {
  const r = await h.request(method, path, { token: comptes[cle].token, body, headers, raw: true });
  const texte = r.buffer.toString('utf8');
  return { status: r.status, rejoue: r.headers.get('idempotent-replayed') === 'true', body: texte ? JSON.parse(texte) : null };
};

const groupe = async (cle, nom, autres, headers = {}) => {
  const g = await as(cle, 'POST', '/messaging/groups', {
    body: { name: nom, participantOrgIds: autres.map((k) => comptes[k].organizationId) },
    headers,
  });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  return g.body.data.id;
};

const socket = (cle) => connecterSocket(port, comptes[cle].token);

before(async () => {
  h = await startHarness();
  for (const cle of ['awa', 'ben', 'cleo', 'dan', 'dina']) await inscrire(cle);
  await inscrire('ivan', 'INVESTOR');

  const { attachRealtime } = await import('../../src/realtime/index.js');
  ({ supabaseAdmin } = await import('../../src/config/supabase.js'));
  ({ env } = await import('../../src/config/env.js'));
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

// ═══ R2 — WebSocket ══════════════════════════════════════════════════════
// W1-W4 (payload null, accusé non fonctionnel, exception synchrone, rejet
// asynchrone) et W5 (compte suspendu) : tests R2 et R3 de
// realtimeStabilisation.e2e.test.mjs, journalisés dans docs/preuves/logs.

test('W6 — adhésion révoquée après la connexion : envoi et adhésion à la room refusés', async () => {
  const roomId = await groupe('awa', 'W6', ['ben']);
  const ben = await socket('ben');
  assert.equal((await ben.emitAck('send_message', { roomId, content: 'avant' })).ok, true);

  await h.prisma.membership.updateMany({ where: { userId: comptes.ben.id }, data: { status: 'REMOVED' } });
  try {
    assert.deepEqual(await ben.emitAck('send_message', { roomId, content: 'après révocation' }), { ok: false, error: 'NOT_FOUND' });
    assert.deepEqual(await ben.emitAck('conversation:join', { conversationId: roomId }), { ok: false, error: 'FORBIDDEN' });
    assert.equal(await h.prisma.message.count({ where: { conversationId: roomId, body: 'après révocation' } }), 0);
  } finally {
    await h.prisma.membership.updateMany({ where: { userId: comptes.ben.id }, data: { status: 'ACTIVE' } });
    ben.fermer();
  }
});

test('W7 — conversation d’un autre tenant : invisible en socket comme en REST', async () => {
  const roomId = await groupe('awa', 'W7', ['cleo']);
  const dan = await socket('dan');
  assert.deepEqual(await dan.emitAck('send_message', { roomId, content: 'intrusion' }), { ok: false, error: 'NOT_FOUND' });
  assert.deepEqual(await dan.emitAck('conversation:join', { conversationId: roomId }), { ok: false, error: 'FORBIDDEN' });
  dan.emit('typing', { conversationId: roomId });
  const lecture = await as('dan', 'GET', `/messaging/conversations/${roomId}/messages`);
  assert.equal(lecture.status, 404);
  assert.equal(await h.prisma.message.count({ where: { conversationId: roomId, senderId: comptes.dan.id } }), 0);
  dan.fermer();
});

test('W8 + W9 — organisation active : choisie parmi les participantes, jamais une organisation étrangère', async () => {
  const coop = await as('awa', 'POST', '/organizations', { body: { type: 'COOPERATIVE', name: 'Coop W8', countryCode: 'CD' } });
  assert.equal(coop.status, 201, JSON.stringify(coop.body));
  const coopId = coop.body.data.id;
  const roomId = await groupe('awa', 'W8', ['ben'], { 'X-Organization-Id': coopId });

  const awa = await socket('awa');
  const sansChoix = await awa.emitAck('send_message', { roomId, content: 'sans choix' });
  assert.equal(sansChoix.ok, true, JSON.stringify(sansChoix));
  const m = await h.prisma.message.findUnique({ where: { id: sansChoix.serverId } });
  assert.equal(m.senderOrgId, coopId, 'seule organisation participante retenue');

  assert.deepEqual(
    await awa.emitAck('send_message', { roomId, content: 'org individuelle non participante', organizationId: comptes.awa.organizationId }),
    { ok: false, error: 'NOT_FOUND' },
  );
  assert.equal((await awa.emitAck('send_message', { roomId, content: 'coop explicite', organizationId: coopId })).ok, true);
  // W9 — organisation d'un tiers
  assert.deepEqual(
    await awa.emitAck('send_message', { roomId, content: 'usurpation', organizationId: comptes.ben.organizationId }),
    { ok: false, error: 'NOT_FOUND' },
  );
  assert.equal(await h.prisma.message.count({ where: { conversationId: roomId, body: 'usurpation' } }), 0);
  awa.fermer();
});

test('W10 — rôle sans `messages.write` (INVESTOR) : refus socket et REST', async () => {
  const roomId = await groupe('awa', 'W10', ['ivan']);
  const ivan = await socket('ivan');
  assert.deepEqual(await ivan.emitAck('send_message', { roomId, content: 'x' }), { ok: false, error: 'PERMISSION_DENIED' });
  const rest = await as('ivan', 'POST', `/messaging/conversations/${roomId}/messages`, { body: { body: 'x' } });
  assert.equal(rest.status, 403);
  ivan.fermer();
});

/** Le socket de `cle` reçoit-il le contenu d'un message posté après `action` ? */
const recoitApres = async (cle, nom, action, annuler) => {
  const roomId = await groupe('awa', nom, [cle]);
  const client = await socket(cle);
  await action();
  try {
    const corps = `contenu confidentiel ${nom}`;
    assert.equal((await as('awa', 'POST', `/messaging/conversations/${roomId}/messages`, { body: { body: corps } })).status, 201);
    await pause(400);
    return client.recus('message:new').filter((p) => p.conversationId === roomId && JSON.stringify(p).includes(corps)).length;
  } finally {
    await annuler();
    client.fermer();
  }
};

test(
  'W11 — adhésion révoquée après la connexion : plus aucun contenu reçu en temps réel',
  { todo: 'W11 HORS API — modification directe en base : appliquée par le filet en ≤ REALTIME_RECHECK_MS (60 s par défaut) ; ce test n’attend que 400 ms. Révocation par l’API immédiate : voir revocationSocketsV1 RV-3 et RV-4' },
  async () => {
    const recus = await recoitApres(
      'cleo',
      'W11',
      () => h.prisma.membership.updateMany({ where: { userId: comptes.cleo.id }, data: { status: 'REMOVED' } }),
      () => h.prisma.membership.updateMany({ where: { userId: comptes.cleo.id }, data: { status: 'ACTIVE' } }),
    );
    assert.equal(recus, 0, `observé : ${recus} message(s) reçu(s) avec leur contenu après révocation`);
  },
);

test(
  'W12 — compte suspendu après la connexion : plus aucun contenu reçu en temps réel',
  { todo: 'W12 HORS API — modification directe en base : appliquée par le filet en ≤ REALTIME_RECHECK_MS (60 s par défaut) ; ce test n’attend que 400 ms. Suspension par l’API immédiate : voir revocationSocketsV1 RV-2 et RV-4' },
  async () => {
    const recus = await recoitApres(
      'dan',
      'W12',
      () => h.prisma.profile.update({ where: { id: comptes.dan.id }, data: { status: 'SUSPENDED' } }),
      () => h.prisma.profile.update({ where: { id: comptes.dan.id }, data: { status: 'ACTIVE' } }),
    );
    assert.equal(recus, 0, `observé : ${recus} message(s) reçu(s) avec leur contenu après suspension`);
  },
);

// ═══ R2 — Pièces jointes ═════════════════════════════════════════════════

test('A1 — clé d’une autre organisation : refusée en REST et en socket', async () => {
  const roomId = await groupe('awa', 'A1', ['ben']);
  const cle = `${comptes.ben.organizationId}/documents/2026-11/secret.pdf`;
  const rest = await as('awa', 'POST', `/messaging/conversations/${roomId}/messages`, { body: { body: 'x', attachments: [cle] } });
  assert.equal(rest.status, 422);
  assert.equal(rest.body.errors?.[0]?.code, 'foreign_storage_key');
  const awa = await socket('awa');
  const ack = await awa.emitAck('send_message', { roomId, content: 'x', attachments: [cle] });
  assert.equal(ack.ok, false);
  assert.equal(ack.error, 'VALIDATION_ERROR');
  awa.fermer();
});

test('A2 — clés malformées : toutes refusées (422)', async () => {
  const roomId = await groupe('awa', 'A2', ['ben']);
  const org = comptes.awa.organizationId;
  for (const piece of ['a b', '<script>', '', `${org}/media/${'x'.repeat(500)}`, 123, `${org}/media/é.jpg`]) {
    const r = await as('awa', 'POST', `/messaging/conversations/${roomId}/messages`, { body: { body: 'x', attachments: [piece] } });
    assert.equal(r.status, 422, `${JSON.stringify(piece).slice(0, 40)} → ${r.status}`);
  }
});

test(
  'A3 — traversée de chemin (`<org>/../<autre>/…`) refusée',
  { todo: 'ANOMALIE A3 — clé contenant « .. » acceptée et transmise à la signature (voir PREUVES_SECURITE_WEBSOCKET.md)' },
  async () => {
    const roomId = await groupe('awa', 'A3', ['ben']);
    const org = comptes.awa.organizationId;
    const signees = [];
    Object.defineProperty(supabaseAdmin, 'storage', {
      configurable: true,
      value: { from: () => ({ createSignedUrls: async (paths) => { signees.push(...paths); return { data: [], error: null }; } }) },
    });
    try {
      for (const piece of [`${org}/../${comptes.ben.organizationId}/documents/2026-11/secret.pdf`, `${org}/media/../../${comptes.ben.organizationId}/documents/x.pdf`]) {
        const r = await as('awa', 'POST', `/messaging/conversations/${roomId}/messages`, { body: { body: 'x', attachments: [piece] } });
        assert.equal(r.status, 422, `observé ${r.status} pour ${piece} ; clés transmises à la signature : ${JSON.stringify(signees)}`);
      }
    } finally {
      delete supabaseAdmin.storage;
    }
  },
);

test('A4 — participant retiré : plus aucun accès au fil ni à ses pièces jointes', async () => {
  const roomId = await groupe('awa', 'A4', ['cleo']);
  const post = await as('awa', 'POST', `/messaging/conversations/${roomId}/messages`, {
    body: { body: 'pièce', attachments: [`${comptes.awa.organizationId}/media/2026-11/p.jpg`] },
  });
  assert.equal(post.status, 201);
  assert.equal((await as('cleo', 'GET', `/messaging/conversations/${roomId}/messages`)).status, 200);

  const retrait = await as('awa', 'DELETE', `/messaging/conversations/${roomId}/members/${comptes.cleo.organizationId}`);
  assert.equal(retrait.status, 200);
  assert.equal((await as('cleo', 'GET', `/messaging/conversations/${roomId}/messages`)).status, 404);
  const sync = await as('cleo', 'POST', '/messaging/sync', { body: { lastPulledAt: 0, roomIds: [roomId] } });
  assert.equal(sync.status, 200);
  assert.equal(sync.body.data.created.length, 0, 'la synchronisation ne livre plus rien de ce fil');
});

test('A5 — URL signées : TTL de configuration, nouvelle signature à chaque lecture', async () => {
  const roomId = await groupe('awa', 'A5', ['ben']);
  const cle = `${comptes.awa.organizationId}/media/2026-11/photo.jpg`;
  const appels = [];
  let n = 0;
  Object.defineProperty(supabaseAdmin, 'storage', {
    configurable: true,
    value: {
      from: (bucket) => ({
        createSignedUrls: async (paths, ttl) => {
          appels.push({ bucket, paths, ttl });
          n += 1;
          return { data: paths.map((p) => ({ path: p, signedUrl: `https://stub.storage/${p}?token=${n}` })), error: null };
        },
      }),
    },
  });
  try {
    assert.equal((await as('awa', 'POST', `/messaging/conversations/${roomId}/messages`, { body: { body: 'p', attachments: [cle] } })).status, 201);
    const l1 = await as('ben', 'GET', `/messaging/conversations/${roomId}/messages`);
    const l2 = await as('ben', 'GET', `/messaging/conversations/${roomId}/messages`);
    const url = (l) => l.body.data.messages.find((m) => m.attachments.includes(cle)).attachmentUrls[0];
    assert.ok(url(l1) && url(l2));
    assert.notEqual(url(l1), url(l2), 'URL renouvelée à chaque lecture');
    assert.ok(appels.every((a) => a.ttl === env.SIGNED_URL_TTL_SECONDS), `TTL ${env.SIGNED_URL_TTL_SECONDS} s`);
    assert.ok(appels.every((a) => a.bucket === env.SUPABASE_BUCKET_MEDIA));
    const sync = await as('ben', 'POST', '/messaging/sync', { body: { lastPulledAt: 0, roomIds: [roomId] } });
    const s = sync.body.data.created.find((m) => m.attachments.includes(cle));
    assert.equal(s.remote_media_url, cle, 'identité stable = clé');
    assert.match(s.attachment_urls[0], /^https:\/\/stub\.storage\//);
  } finally {
    delete supabaseAdmin.storage;
  }
});

// ═══ R3 — Idempotence ════════════════════════════════════════════════════

const nbFermes = (nom) => h.prisma.farm.count({ where: { organizationId: comptes.dina.organizationId, name: nom } });
const cleStockee = (cle) => `${comptes.dina.id}:${cle}`;

test('I1 — requêtes simultanées avec la même clé : une seule création', async (t) => {
  const cle = 'simul-01KXYZABCDEFGHJKMNPQRSTV';
  const reponses = await Promise.all(
    Array.from({ length: 6 }, () => brut('dina', 'POST', '/farms', { body: { name: 'I1 Simultanée', countryCode: 'CD' }, headers: { 'idempotency-key': cle } })),
  );
  t.diagnostic(`I1 : statuts ${reponses.map((r) => `${r.status}${r.rejoue ? '(rejoué)' : ''}`).join(', ')} ; exploitations ${await nbFermes('I1 Simultanée')}`);
  assert.equal(await nbFermes('I1 Simultanée'), 1, `statuts : ${reponses.map((r) => r.status).join(',')}`);
  assert.ok(reponses.every((r) => [201, 409].includes(r.status)), reponses.map((r) => r.status).join(','));
  assert.ok(reponses.some((r) => r.status === 201 && !r.rejoue), 'une exécution réelle');
});

test('I2 — rejeu après succès : même réponse, en-tête `Idempotent-Replayed`', async () => {
  const cle = 'succes-01KXYZABCDEFGHJKMNPQRS';
  const a = await brut('dina', 'POST', '/farms', { body: { name: 'I2', countryCode: 'CD' }, headers: { 'idempotency-key': cle } });
  const b = await brut('dina', 'POST', '/farms', { body: { name: 'I2', countryCode: 'CD' }, headers: { 'idempotency-key': cle } });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(b.rejoue, true);
  assert.deepEqual(b.body, a.body);
  assert.equal(await nbFermes('I2'), 1);
});

test('I3 — rejeu après erreur métier : l’erreur est rejouée, aucune écriture', async () => {
  const fermeAwa = await as('awa', 'POST', '/farms', { body: { name: 'Ferme Awa I3', countryCode: 'CD' } });
  const cle = 'erreur-01KXYZABCDEFGHJKMNPQRS';
  const corps = { farmId: fermeAwa.body.data.farm.id, name: 'Parcelle volée', areaHa: 1, geometry: point };
  const a = await brut('dina', 'POST', '/plots', { body: corps, headers: { 'idempotency-key': cle } });
  const b = await brut('dina', 'POST', '/plots', { body: corps, headers: { 'idempotency-key': cle } });
  assert.equal(a.status, 404, JSON.stringify(a.body));
  assert.equal(b.status, 404);
  assert.equal(b.rejoue, true);
  assert.equal(await h.prisma.plot.count({ where: { name: 'Parcelle volée' } }), 0);
});

test('I4a — arrêt après réservation de la clé, avant la réponse : aucun doublon (409)', async () => {
  const cle = 'crash-01KXYZABCDEFGHJKMNPQRSTV';
  await h.prisma.idempotencyKey.create({
    data: { key: cleStockee(cle), scope: 'farms.create', userId: comptes.dina.id, responseStatus: null, responseBody: null, expiresAt: new Date(Date.now() + 3600_000) },
  });
  const r = await brut('dina', 'POST', '/farms', { body: { name: 'I4a', countryCode: 'CD' }, headers: { 'idempotency-key': cle } });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(await nbFermes('I4a'), 0);
});

test(
  'I4b — clé orpheline (arrêt du serveur) expirée : requête de nouveau traitable',
  { todo: 'ANOMALIE I4b — `expiresAt` jamais lu : 409 « en cours » indéfiniment après un arrêt du serveur' },
  async () => {
    const cle = 'orphe-01KXYZABCDEFGHJKMNPQRSTV';
    await h.prisma.idempotencyKey.create({
      data: { key: cleStockee(cle), scope: 'farms.create', userId: comptes.dina.id, responseStatus: null, responseBody: null, expiresAt: new Date(Date.now() - 3600_000) },
    });
    const r = await brut('dina', 'POST', '/farms', { body: { name: 'I4b', countryCode: 'CD' }, headers: { 'idempotency-key': cle } });
    assert.equal(r.status, 201, `observé ${r.status} ${JSON.stringify(r.body)}`);
  },
);

test(
  'I4c — échec d’écriture de la réponse APRÈS la création métier : le renvoi ne duplique pas',
  { todo: 'ANOMALIE I4c — la clé est supprimée après l’échec de persistance ; le renvoi crée un doublon' },
  async () => {
    const cle = 'persi-01KXYZABCDEFGHJKMNPQRSTV';
    const original = h.prisma.idempotencyKey.update;
    h.prisma.idempotencyKey.update = async () => { throw new Error('panne simulée de persistance'); };
    let premier;
    try {
      premier = await brut('dina', 'POST', '/farms', { body: { name: 'I4c', countryCode: 'CD' }, headers: { 'idempotency-key': cle } });
    } finally {
      h.prisma.idempotencyKey.update = original;
    }
    const apresPanne = await nbFermes('I4c');
    const renvoi = await brut('dina', 'POST', '/farms', { body: { name: 'I4c', countryCode: 'CD' }, headers: { 'idempotency-key': cle } });
    const final = await nbFermes('I4c');
    assert.equal(final, 1, `1er appel ${premier.status} (fermes : ${apresPanne}) ; renvoi ${renvoi.status} ; fermes finales : ${final}`);
  },
);

test('I5 — même clé, deux utilisateurs : jamais de rejeu croisé', async () => {
  const cle = 'partage-01KXYZABCDEFGHJKMNPQR';
  const d = await brut('dina', 'POST', '/farms', { body: { name: 'I5', countryCode: 'CD' }, headers: { 'idempotency-key': cle } });
  const a = await brut('awa', 'POST', '/farms', { body: { name: 'I5', countryCode: 'CD' }, headers: { 'idempotency-key': cle } });
  assert.equal(a.status, 201);
  assert.equal(a.rejoue, false);
  assert.notEqual(a.body.data.farm.id, d.body.data.farm.id);
});

test('I6 — même clé, deux opérations différentes : portées indépendantes', async () => {
  const cle = 'deuxop-01KXYZABCDEFGHJKMNPQRS';
  const f = await brut('dina', 'POST', '/farms', { body: { name: 'I6', countryCode: 'CD' }, headers: { 'idempotency-key': cle } });
  assert.equal(f.status, 201);
  const p = await brut('dina', 'POST', '/plots', {
    body: { farmId: f.body.data.farm.id, name: 'Parcelle I6', areaHa: 1, geometry: point },
    headers: { 'idempotency-key': cle },
  });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  assert.equal(p.rejoue, false, 'la création de parcelle n’est pas le rejeu de l’exploitation');
});

test(
  'I6b — même clé, même opération, corps différent : refus explicite',
  { todo: 'ANOMALIE I6b — aucune empreinte du corps : le second corps est ignoré et la réponse du premier rejouée' },
  async () => {
    const cle = 'corps-01KXYZABCDEFGHJKMNPQRST';
    await brut('dina', 'POST', '/farms', { body: { name: 'I6b-A', countryCode: 'CD' }, headers: { 'idempotency-key': cle } });
    const b = await brut('dina', 'POST', '/farms', { body: { name: 'I6b-B', countryCode: 'CD' }, headers: { 'idempotency-key': cle } });
    assert.equal(b.status, 422, `observé ${b.status}, rejoué=${b.rejoue}, exploitation renvoyée « ${b.body?.data?.farm?.name} »`);
  },
);

test(
  'I7 — clé expirée après succès : traitée comme une nouvelle requête',
  { todo: 'ANOMALIE I7 — `expiresAt` jamais lu ni purgé : rejeu perpétuel, table sans limite de croissance' },
  async () => {
    const cle = 'expire-01KXYZABCDEFGHJKMNPQRS';
    await brut('dina', 'POST', '/farms', { body: { name: 'I7', countryCode: 'CD' }, headers: { 'idempotency-key': cle } });
    await h.prisma.idempotencyKey.updateMany({ where: { key: cleStockee(cle) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await brut('dina', 'POST', '/farms', { body: { name: 'I7', countryCode: 'CD' }, headers: { 'idempotency-key': cle } });
    assert.equal(r.rejoue, false, `observé : rejoué=${r.rejoue}, statut ${r.status}`);
  },
);

// ═══ R3 — Synchronisation ════════════════════════════════════════════════

const tirer = (cle, roomId, lastPulledAt) =>
  as(cle, 'POST', '/messaging/sync', { body: { lastPulledAt, roomIds: [roomId] } });

/** Pagine jusqu'à `hasMore: false` ; renvoie les ids reçus (dans l'ordre) et le dernier curseur. */
const toutTirer = async (cle, roomId, depuis = 0) => {
  const recus = [];
  const pages = [];
  let curseur = depuis;
  for (let i = 0; i < 50; i += 1) {
    const r = await tirer(cle, roomId, curseur);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    pages.push(r.body.data.created.length);
    recus.push(...r.body.data.created.map((m) => m.id));
    curseur = r.body.data.serverTimestamp;
    if (!r.body.data.hasMore) return { recus, curseur, pages };
  }
  throw new Error('pagination sans fin');
};

const idMessage = (i) => `01SYNC${String(i).padStart(20, '0')}`;

let filSync;
let curseurSync;

test('S1 + S3 + S5 — long hors ligne, > 500 messages, 650 à la même milliseconde : tout reçu une fois', async (t) => {
  filSync = await groupe('awa', 'S-sync', ['ben']);
  const base = Date.now() - 10 * 24 * 3600_000;
  const donnees = [];
  let i = 0;
  for (let k = 0; k < 400; k += 1) donnees.push(new Date(base + k));
  const meme = base + 1000;
  for (let k = 0; k < 650; k += 1) donnees.push(new Date(meme));
  for (let k = 0; k < 250; k += 1) donnees.push(new Date(base + 2000 + k));
  await h.prisma.message.createMany({
    data: donnees.map((createdAt) => ({
      id: idMessage(i++),
      conversationId: filSync,
      senderId: comptes.awa.id,
      senderOrgId: comptes.awa.organizationId,
      body: `s${i}`,
      attachments: [],
      readBy: [],
      createdAt,
    })),
  });

  const attendus = (await h.prisma.message.findMany({ where: { conversationId: filSync }, select: { id: true } })).map((m) => m.id);
  const { recus, curseur, pages } = await toutTirer('ben', filSync);
  curseurSync = curseur;
  t.diagnostic(`S1 : ${recus.length} reçus / ${attendus.length} attendus ; pages ${pages.join(', ')} ; ids distincts ${new Set(recus).size}`);
  assert.equal(new Set(recus).size, recus.length, `aucun doublon (pages : ${pages.join(', ')})`);
  assert.deepEqual(new Set(recus), new Set(attendus), `${recus.length} reçus sur ${attendus.length}`);
  assert.ok(pages.length >= 3, `pagination effective : ${pages.join(', ')}`);
});

test('S6 — interruption entre deux pages : la même page est relivrée à l’identique', async () => {
  const p1 = await tirer('ben', filSync, 0);
  const curseur = p1.body.data.serverTimestamp;
  const p2a = await tirer('ben', filSync, curseur);
  const p2b = await tirer('ben', filSync, curseur); // réponse « perdue » puis redemandée
  assert.deepEqual(p2a.body.data.created.map((m) => m.id), p2b.body.data.created.map((m) => m.id));
  assert.equal(p2a.body.data.serverTimestamp, p2b.body.data.serverTimestamp);
});

test(
  'S2 — transaction concurrente non validée pendant la lecture : message livré au tirage suivant',
  { todo: 'ANOMALIE S2 — curseur `Date.now()` : un message validé après la lecture mais horodaté avant est perdu définitivement' },
  async () => {
    let liberer;
    const verrou = new Promise((r) => { liberer = r; });
    const tardif = idMessage(999_999);
    const transaction = h.prisma.$transaction(
      async (tx) => {
        await tx.message.create({
          data: { id: tardif, conversationId: filSync, senderId: comptes.awa.id, senderOrgId: comptes.awa.organizationId, body: 'tardif', attachments: [], readBy: [] },
        });
        await verrou;
      },
      { timeout: 30_000 },
    );
    await pause(300); // INSERT fait, non validé
    const pendant = await tirer('ben', filSync, curseurSync);
    liberer();
    await transaction;
    const apres = await tirer('ben', filSync, pendant.body.data.serverTimestamp);
    const vu = [...pendant.body.data.created, ...apres.body.data.created].some((m) => m.id === tardif);
    const m = await h.prisma.message.findUnique({ where: { id: tardif } });
    assert.ok(
      vu,
      `perdu : créé à ${m.createdAt.getTime()}, curseur rendu pendant la transaction ${pendant.body.data.serverTimestamp}`,
    );
  },
);

/**
 * S-modèle — stratégie de curseur proposée, vérifiée sur un MODÈLE (pas sur le
 * code de production, qui n'est pas modifié sans décision d'architecture).
 *
 * Proposition : curseur rendu = min(dernier message livré, maintenant − L),
 * requête `createdAt > curseur − L` (recouvrement), déduplication par `id`
 * côté client (déjà en place : upsert sur `server_id`). Avec L ≥ durée maximale
 * d'une transaction d'écriture, aucun message n'est perdu et aucun n'est
 * appliqué deux fois.
 */
test('S-modèle — curseur à recouvrement L : 0 perte, 0 doublon appliqué, sur 2 000 scénarios aléatoires', () => {
  const L = 50;
  let graine = 7;
  const alea = () => {
    graine = (graine * 1103515245 + 12345) % 2 ** 31;
    return graine / 2 ** 31;
  };
  const simuler = (strategie) => {
    // messages : horodatés à t, visibles (validés) à t + d, d < L
    const messages = Array.from({ length: 200 }, (_, i) => {
      const t = Math.floor(alea() * 2000);
      return { id: i, t, visible: t + Math.floor(alea() * (L - 1)) };
    });
    const appliques = new Map();
    let curseur = 0;
    let doublons = 0;
    for (let maintenant = 0; maintenant <= 2100 + L; maintenant += 1 + Math.floor(alea() * 40)) {
      const visibles = messages.filter((m) => m.visible <= maintenant);
      const page = strategie === 'actuelle'
        ? visibles.filter((m) => m.t > curseur)
        : visibles.filter((m) => m.t > curseur - L);
      for (const m of page) {
        if (appliques.has(m.id)) doublons += 1; // relivré, absorbé par l'upsert client
        appliques.set(m.id, m);
      }
      curseur = strategie === 'actuelle' ? maintenant : Math.min(maintenant - L, Math.max(curseur, ...page.map((m) => m.t)));
    }
    return { perdus: messages.length - appliques.size, appliquesUneFois: appliques.size, doublons };
  };
  let pertesActuelle = 0;
  let pertesProposee = 0;
  for (let s = 0; s < 2000; s += 1) {
    pertesActuelle += simuler('actuelle').perdus;
    pertesProposee += simuler('proposee').perdus;
  }
  assert.equal(pertesProposee, 0, 'stratégie proposée : aucune perte');
  assert.ok(pertesActuelle > 0, `stratégie actuelle : ${pertesActuelle} pertes sur le modèle (reproduit S2)`);
});
