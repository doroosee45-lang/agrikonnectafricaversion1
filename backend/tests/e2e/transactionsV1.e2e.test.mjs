import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness } from './support/harness.mjs';

/**
 * Transactions et intégrité. TESTÉ sur PostgreSQL embarqué et faux GoTrue ;
 * rien de VALIDÉ sur Supabase réel.
 *
 *  TX-1 : inscription = saga Supabase Auth → transaction PostgreSQL → étapes
 *         non bloquantes. TX-1a : panne dans la transaction (compensation) ;
 *         TX-1b : exception après validation (aucune compensation).
 *  TX-2 : `ensureBusinessConversation` — 30 ouvertures simultanées d'un fil : 1 fil.
 *  TX-3 : `createGroup` — 30 créations simultanées du même groupe : 1 groupe.
 *
 * Convention : test normal = conforme ; `todo` = anomalie confirmée.
 */

let h;
const PASSWORD = 'MotDePasse!2026';
const comptes = {};

const inscrire = (email, extra = {}) =>
  h.request('POST', '/auth/register', {
    body: { accountType: 'FARMER', firstName: 'Tx', lastName: 'Test', email, password: PASSWORD, countryCode: 'CD', locale: 'fr', ...extra },
  });

before(async () => {
  h = await startHarness();
  for (const cle of ['awa', 'ben']) {
    const email = `${cle}-tx@agrikonnect.test`;
    const r = await inscrire(email);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const c = await h.request('POST', '/auth/login', { body: { identifier: email, password: PASSWORD } });
    await h.prisma.profile.update({ where: { id: r.body.data.user.id }, data: { emailVerifiedAt: new Date() } });
    comptes[cle] = { organizationId: r.body.data.organization.id, token: c.body.data.session.accessToken };
  }
}, { timeout: 240_000 });

after(async () => {
  await h?.stop?.();
});

const connexion = (email) => h.request('POST', '/auth/login', { body: { identifier: email, password: PASSWORD } });

test('TX-1a — panne DANS la transaction d’inscription : rien n’est validé, Supabase compensé, réinscription possible', async (t) => {
  const email = 'tx1a@agrikonnect.test';
  const original = h.prisma.$transaction;
  // La transaction exécute réellement ses écritures (profil, organisation,
  // adhésion, jeton de consentement), puis échoue avant validation.
  h.prisma.$transaction = (fn, options) =>
    original.call(h.prisma, async (tx) => { await fn(tx); throw new Error('panne injectée avant validation'); }, options);
  let premier;
  try {
    premier = await inscrire(email, { consentReference: 'CONSENT-TX1A-0001' });
  } finally {
    h.prisma.$transaction = original;
  }
  const profils = await h.prisma.profile.count({ where: { email } });
  const jetons = await h.prisma.token.count({ where: { identifier: 'CONSENT-TX1A-0001' } });
  const connexionApres = await connexion(email);
  const second = await inscrire(email);
  t.diagnostic(`TX-1a : inscription ${premier.status} ; profils ${profils} ; jetons ${jetons} ; connexion après échec ${connexionApres.status} ; réinscription ${second.status}`);
  assert.equal(premier.status, 500);
  assert.equal(profils, 0, 'aucun profil validé');
  assert.equal(jetons, 0, 'aucun jeton de consentement validé');
  assert.notEqual(connexionApres.status, 200, 'utilisateur Supabase supprimé par compensation');
  assert.equal(second.status, 201, JSON.stringify(second.body));
});

test('TX-1b — exception APRÈS validation (envoi d’e-mail) : inscription réussie, compte présent dans les deux systèmes', async (t) => {
  const email = 'tx1b@agrikonnect.test';
  const { supabase } = await import('../../src/config/supabase.js');
  const original = supabase.auth.resend;
  supabase.auth.resend = () => { throw new Error('panne réseau injectée après validation'); };
  let reponse;
  try {
    reponse = await inscrire(email, { consentReference: 'CONSENT-TX1B-0001' });
  } finally {
    supabase.auth.resend = original;
  }
  const profils = await h.prisma.profile.count({ where: { email } });
  const jetons = await h.prisma.token.count({ where: { identifier: 'CONSENT-TX1B-0001' } });
  const connexionApres = await connexion(email);
  t.diagnostic(`TX-1b : inscription ${reponse.status} ; profils ${profils} ; jetons ${jetons} ; connexion ${connexionApres.status}`);
  assert.equal(reponse.status, 201, JSON.stringify(reponse.body));
  assert.equal(profils, 1);
  assert.equal(jetons, 1);
  assert.equal(connexionApres.status, 200, 'utilisateur Supabase conservé : comptes cohérents');
});

test(
  'TX-2 — trente ouvertures simultanées du même fil DIRECT : un seul fil',
  async (t) => {
    const corps = { subjectType: 'DIRECT', subjectId: `DM-${Date.now()}-0000000`, participantOrgIds: [comptes.ben.organizationId] };
    const reponses = await Promise.all(
      Array.from({ length: 30 }, () => h.request('POST', '/messaging/conversations', { token: comptes.awa.token, body: corps })),
    );
    const fils = await h.prisma.conversation.count({ where: { subjectType: 'DIRECT', subjectId: corps.subjectId } });
    t.diagnostic(`TX-2 : statuts ${reponses.map((r) => r.status).join(',')} ; fils créés ${fils}`);
    assert.ok(reponses.every((r) => [200, 201].includes(r.status)), reponses.map((r) => `${r.status}:${JSON.stringify(r.body).slice(0, 80)}`).join(' | '));
    assert.equal(fils, 1, `observé : ${fils} fils`);
  },
);

test('TX-3 — trente créations simultanées du même groupe (même nom, mêmes membres) : un seul groupe', async (t) => {
  const corps = { name: `Groupe concurrent ${Date.now()}`, participantOrgIds: [comptes.ben.organizationId] };
  const reponses = await Promise.all(
    Array.from({ length: 30 }, () => h.request('POST', '/messaging/groups', { token: comptes.awa.token, body: corps })),
  );
  const groupes = await h.prisma.conversation.count({ where: { subjectType: 'GROUP', subjectId: `GRP:${corps.name}` } });
  const ids = new Set(reponses.map((r) => r.body?.data?.id));
  t.diagnostic(`TX-3 : statuts ${[...new Set(reponses.map((r) => r.status))].join(',')} ; groupes créés ${groupes} ; identifiants renvoyés distincts ${ids.size}`);
  assert.ok(reponses.every((r) => r.status === 201), reponses.map((r) => r.status).join(','));
  assert.equal(groupes, 1, `observé : ${groupes} groupes`);
  assert.equal(ids.size, 1, 'toutes les réponses désignent le même groupe');
});

test('TX-2/TX-3 — sujets différents : pas de sérialisation abusive (fils distincts créés en parallèle)', async () => {
  const sujets = Array.from({ length: 5 }, (_, i) => `DM-${Date.now()}-${i}-parallele`);
  await Promise.all(sujets.map((subjectId) => h.request('POST', '/messaging/conversations', {
    token: comptes.awa.token,
    body: { subjectType: 'DIRECT', subjectId, participantOrgIds: [comptes.ben.organizationId] },
  })));
  for (const subjectId of sujets) assert.equal(await h.prisma.conversation.count({ where: { subjectId } }), 1);
});
