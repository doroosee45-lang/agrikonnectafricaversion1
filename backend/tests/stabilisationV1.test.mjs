import './helpers/pinTestEnv.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { prisma } from '../src/config/prisma.js';
import { withFakePrisma } from './helpers/fakePrisma.mjs';
import * as messaging from '../src/modules/messaging/messaging.service.js';
import { contexteEnvoi, sendMessageSchema } from '../src/realtime/sendGuard.js';
import { estLectureEnPost } from '../src/routes/index.js';
import { sujetAutorise } from '../src/modules/verification/verification.service.js';
import { uploadUrlSchema } from '../src/modules/media/media.schema.js';
import { kindEnBase, bucketDuMedia } from '../src/modules/media/media.service.js';
import { can, PERMISSIONS } from '../src/shared/permissions.js';
import { env } from '../src/config/env.js';

/**
 * Stabilisation backend V1 — preuves des correctifs du lot d'audit.
 * Chaque test nomme le défaut qu'il verrouille ; voir docs/RAPPORT-STABILISATION-BACKEND-V1.md.
 */

const A = 'org_aaaaaaaaaa';
const B = 'org_bbbbbbbbbb';
const C = 'org_cccccccccc';
const D = 'org_dddddddddd';
const req = (organizationId, userId) => ({
  tenant: { organizationId, effectiveRoles: ['FARMER'] },
  user: { id: userId, roles: ['FARMER'] },
  headers: {},
  ip: '127.0.0.1',
});

// ─── R1 : envoi par WebSocket ─────────────────────────────────────────────

test('R1 — socket : un compte non vérifié ne peut pas envoyer', () => {
  const r = contexteEnvoi({ userId: 'u', verified: false, memberships: [{ organizationId: A, roles: ['FARMER'] }], participantOrgIds: [A, B] });
  assert.deepEqual(r, { ok: false, error: 'ACCOUNT_NOT_VERIFIED' });
});

test('R1 — socket : hors du fil, réponse NOT_FOUND (comme le REST)', () => {
  const r = contexteEnvoi({ userId: 'u', verified: true, memberships: [{ organizationId: C, roles: ['FARMER'] }], participantOrgIds: [A, B] });
  assert.equal(r.error, 'NOT_FOUND');
});

test('R1 — socket : l’organisation retenue est celle qui participe au fil, pas la première', () => {
  const r = contexteEnvoi({
    userId: 'u',
    verified: true,
    memberships: [
      { organizationId: C, roles: ['FARMER'] },
      { organizationId: B, roles: ['BUYER'] },
    ],
    participantOrgIds: [A, B],
  });
  assert.equal(r.ok, true);
  assert.equal(r.req.tenant.organizationId, B);
});

test('R1 — socket : sans `messages.write` dans l’organisation du fil, refus', () => {
  // INVESTOR n'a pas la messagerie ; FARMER dans une AUTRE organisation ne compte pas (H-03).
  const r = contexteEnvoi({
    userId: 'u',
    verified: true,
    memberships: [
      { organizationId: B, roles: ['INVESTOR'] },
      { organizationId: C, roles: ['FARMER'] },
    ],
    participantOrgIds: [A, B],
  });
  assert.deepEqual(r, { ok: false, error: 'PERMISSION_DENIED' });
});

test('R1 — socket : charge utile validée comme en REST', () => {
  assert.equal(sendMessageSchema.safeParse({ roomId: 'conv_0000000001', content: '   ' }).success, false);
  assert.equal(sendMessageSchema.safeParse({ roomId: 'conv_0000000001', content: 'x'.repeat(3001) }).success, false);
  assert.equal(sendMessageSchema.safeParse({ roomId: 'conv_0000000001', content: 'ok', attachments: 'chaine' }).success, false);
  assert.equal(sendMessageSchema.safeParse({ roomId: 'conv_0000000001', content: 'ok' }).success, true);
});

// ─── H-07 : garde « compte vérifié » ─────────────────────────────────────

test('H-07 — seule la synchronisation (lecture en POST) est exemptée', () => {
  assert.equal(estLectureEnPost('/api/v1/messaging', '/sync'), true);
  assert.equal(estLectureEnPost('/api/v1/messaging', '/sync/'), true);
  assert.equal(estLectureEnPost('/api/v1/messaging', '/groups'), false);
  assert.equal(estLectureEnPost('/api/v1/calls', '/sync'), false);
});

// ─── M1 : réémission idempotente d'un message ────────────────────────────

const ID_EXISTANT = '01JB0000000000000000000001';
const storeMessagerie = () => ({
  conversation: [
    { id: 'conv_ab_000001', subjectType: 'DIRECT', subjectId: 'd1', participantOrgIds: [A, B], status: 'OPEN', updatedAt: new Date() },
    { id: 'conv_cd_000001', subjectType: 'DIRECT', subjectId: 'd2', participantOrgIds: [C, D], status: 'OPEN', updatedAt: new Date() },
  ],
  message: [
    { id: ID_EXISTANT, conversationId: 'conv_ab_000001', senderId: 'user_a', senderOrgId: A, body: 'secret', attachments: [], readBy: ['user_a'], createdAt: new Date() },
  ],
  membership: [],
  notification: [],
  notificationPreference: [],
  auditLog: [],
});

test('M1 — un tiers ne récupère jamais un message existant via `localTempId`', async () => {
  const { restore } = await withFakePrisma(prisma, storeMessagerie());
  try {
    await assert.rejects(
      messaging.postMessage('conv_ab_000001', { body: 'x', attachments: [], localTempId: ID_EXISTANT }, req(C, 'user_c')),
      (e) => e.status === 404,
    );
  } finally {
    restore();
  }
});

test('M1 — identifiant déjà pris dans un autre fil : 409, pas 500', async () => {
  const { restore } = await withFakePrisma(prisma, storeMessagerie());
  try {
    await assert.rejects(
      messaging.postMessage('conv_cd_000001', { body: 'x', attachments: [], localTempId: ID_EXISTANT }, req(C, 'user_c')),
      (e) => e.status === 409,
    );
  } finally {
    restore();
  }
});

test('M1 — même expéditeur, même fil : la réémission renvoie le message d’origine', async () => {
  const { fake, restore } = await withFakePrisma(prisma, storeMessagerie());
  try {
    const rejoue = await messaging.postMessage('conv_ab_000001', { body: 'autre', attachments: [], localTempId: ID_EXISTANT }, req(A, 'user_a'));
    assert.equal(rejoue.id, ID_EXISTANT);
    assert.equal(rejoue.body, 'secret');
    assert.equal(fake._store.message.length, 1, 'aucun doublon créé');
  } finally {
    restore();
  }
});

test('M1 — `localTempId` mal formé : 422', async () => {
  const { restore } = await withFakePrisma(prisma, storeMessagerie());
  try {
    await assert.rejects(
      messaging.postMessage('conv_ab_000001', { body: 'x', attachments: [], localTempId: 'x;drop' }, req(A, 'user_a')),
      (e) => e.status === 422,
    );
  } finally {
    restore();
  }
});

// ─── Pièces jointes ──────────────────────────────────────────────────────

test('Pièces jointes — une clé de stockage d’une autre organisation est refusée', () => {
  assert.throws(
    () => messaging.assertAttachments([`${B}/documents/2026-11/id.pdf`], A),
    (e) => e.status === 422 && e.errors?.[0]?.code === 'foreign_storage_key',
  );
  assert.deepEqual(messaging.assertAttachments([`${A}/media/2026-11/p.jpg`, 'https://exemple.cd/a.png'], A).length, 2);
  assert.throws(() => messaging.assertAttachments('pas-une-liste', A), (e) => e.status === 422);
});

test('Pièces jointes — `attachmentUrls` aligné ; jamais de signature pour une clé étrangère', async () => {
  const [m] = await messaging.signerPiecesJointes(
    [{ id: 'm', attachments: ['https://exemple.cd/a.png', `${C}/media/2026-11/x.jpg`] }],
    [A, B],
  );
  assert.deepEqual(m.attachmentUrls, ['https://exemple.cd/a.png', null]);
});

// ─── M2 : synchronisation différée ───────────────────────────────────────

const messagesDatés = (horodatages) =>
  horodatages.map((t, i) => ({
    id: `01JB${String(i).padStart(22, '0')}`,
    conversationId: 'conv_ab_000001',
    senderId: 'user_b',
    senderOrgId: B,
    body: `m${i}`,
    attachments: [],
    readBy: [],
    createdAt: new Date(t),
  }));

test('M2 — au-delà d’une page, aucun message n’est perdu', async () => {
  const base = Date.parse('2026-11-01T00:00:00Z');
  const store = storeMessagerie();
  store.message = messagesDatés(Array.from({ length: messaging.DELTA_SYNC_PAGE + 5 }, (_, i) => base + i * 1000));
  const { restore } = await withFakePrisma(prisma, store);
  try {
    const p1 = await messaging.deltaSync({ lastPulledAt: 0 }, req(A, 'user_a'));
    assert.equal(p1.created.length, messaging.DELTA_SYNC_PAGE);
    assert.equal(p1.hasMore, true);
    assert.equal(p1.serverTimestamp, base + (messaging.DELTA_SYNC_PAGE - 1) * 1000, 'curseur = dernier message livré');
    const p2 = await messaging.deltaSync({ lastPulledAt: p1.serverTimestamp }, req(A, 'user_a'));
    assert.equal(p2.created.length, 5);
    assert.equal(p2.hasMore, false);
    const ids = new Set([...p1.created, ...p2.created].map((m) => m.id));
    assert.equal(ids.size, messaging.DELTA_SYNC_PAGE + 5, 'tous les messages, sans doublon');
  } finally {
    restore();
  }
});

test('M2 — la coupure ne sépare jamais deux messages de la même milliseconde', async () => {
  const base = Date.parse('2026-11-01T00:00:00Z');
  const n = messaging.DELTA_SYNC_PAGE;
  // Les messages n-2, n-1 et n partagent le même horodatage, à cheval sur la coupure.
  const horodatages = Array.from({ length: n + 1 }, (_, i) => base + Math.min(i, n - 2) * 1000);
  const store = storeMessagerie();
  store.message = messagesDatés(horodatages);
  const { restore } = await withFakePrisma(prisma, store);
  try {
    const p1 = await messaging.deltaSync({ lastPulledAt: 0 }, req(A, 'user_a'));
    assert.equal(p1.hasMore, true);
    assert.equal(p1.created.length, n - 2);
    const p2 = await messaging.deltaSync({ lastPulledAt: p1.serverTimestamp }, req(A, 'user_a'));
    assert.equal(p2.created.length, 3, 'le groupe de même milliseconde arrive entier');
  } finally {
    restore();
  }
});

// ─── Vérification, médias, matrice ───────────────────────────────────────

test('VER-01 — le sujet d’une demande est borné à soi ou à l’organisation active', () => {
  const r = { user: { id: 'moi' }, tenant: { organizationId: A } };
  assert.equal(sujetAutorise('PROFILE', undefined, r), 'moi');
  assert.equal(sujetAutorise('PROFILE', 'autrui', r), null);
  assert.equal(sujetAutorise('ORGANIZATION', undefined, r), A);
  assert.equal(sujetAutorise('COOPERATIVE', B, r), null);
  assert.equal(sujetAutorise('FARM', 'farm_1', r), 'farm_1', 'exploitation : contrôlée ensuite par le service');
});

test('Médias — `IMAGE` accepté comme `PHOTO` ; AUDIO/DOCUMENT stockés dans l’énumération existante', () => {
  const parse = (kind) => uploadUrlSchema.parse({ filename: 'f', mimeType: 'image/jpeg', sizeBytes: 10, kind }).kind;
  assert.equal(parse('IMAGE'), 'PHOTO');
  assert.equal(parse(undefined), 'PHOTO');
  assert.equal(kindEnBase('AUDIO'), 'PHOTO');
  assert.equal(kindEnBase('DOCUMENT'), 'PHOTO');
  assert.equal(kindEnBase('VIDEO'), 'VIDEO');
});

test('Médias — le bucket se déduit de la clé, au dépôt comme à la confirmation', () => {
  assert.equal(bucketDuMedia(`${A}/documents/2026-11/x.jpg`), env.SUPABASE_BUCKET_PRIVATE);
  assert.equal(bucketDuMedia(`${A}/media/2026-11/x.pdf`), env.SUPABASE_BUCKET_MEDIA);
});

test('RBAC — statut de vérification lisible par tous ; pièce jointe sans droit producteur', () => {
  for (const role of ['BUYER', 'SUPPLIER', 'TRANSPORTER', 'INVESTOR', 'FARMER']) {
    assert.equal(can([role], 'verifications.read'), true, role);
  }
  assert.equal(can(['BUYER'], 'media.upload'), false, 'le droit producteur n’est pas élargi');
  assert.equal(can(['BUYER'], 'messages.write'), true, 'alternative retenue sur /media/upload-url');
  assert.equal(can(['INVESTOR'], 'messages.write'), false);
  assert.equal(can(['BUYER'], 'verifications.review'), false);
});

test('RBAC — plus aucune clé de permission déclarée deux fois', () => {
  const source = readFileSync(new URL('../src/shared/permissions.js', import.meta.url), 'utf8');
  for (const cle of Object.keys(PERMISSIONS)) {
    const n = source.split(`'${cle}':`).length - 1;
    assert.equal(n, 1, `${cle} déclarée ${n} fois`);
  }
});
