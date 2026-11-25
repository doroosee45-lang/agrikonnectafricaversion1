import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness } from './support/harness.mjs';

/**
 * TX-1 — réconciliation Supabase Auth ↔ PostgreSQL : pannes à chaque étape,
 * échec de la compensation, identification et récupération des orphelins.
 * TESTÉ (faux GoTrue, PostgreSQL embarqué) ; rien de VALIDÉ sur Supabase réel.
 */

let h;
let supabaseAdmin;
let outil;
const PASSWORD = 'MotDePasse!2026';

const inscrire = (email, accountType = 'BUYER') =>
  h.request('POST', '/auth/register', {
    body: { accountType, firstName: 'Rc', lastName: 'Test', email, password: PASSWORD, countryCode: 'CD', locale: 'fr' },
  });
const connexion = (email) => h.request('POST', '/auth/login', { body: { identifier: email, password: PASSWORD } });
const rapport = async () => outil.reconcilierComptes({ utilisateursAuth: await outil.listerTousLesUtilisateursAuth(supabaseAdmin, 2), prisma: h.prisma });
/** Panne dans la transaction PostgreSQL d'inscription (avant validation). */
const avecPanneTransaction = async (fn) => {
  const original = h.prisma.$transaction;
  h.prisma.$transaction = (cb, o) => original.call(h.prisma, async (tx) => { await cb(tx); throw new Error('panne base'); }, o);
  try { return await fn(); } finally { h.prisma.$transaction = original; }
};

before(async () => {
  h = await startHarness();
  ({ supabaseAdmin } = await import('../../src/config/supabase.js'));
  outil = await import('../../scripts/reconcilier-comptes.mjs');
}, { timeout: 240_000 });

after(async () => {
  await h?.stop?.();
});

test('RC-1 — panne après création Auth, pendant la transaction : compensation réussie, aucun orphelin', async () => {
  const email = 'rc1@agrikonnect.test';
  const r = await avecPanneTransaction(() => inscrire(email));
  const rap = await rapport();
  assert.equal(r.status, 500);
  assert.equal(rap.orphelinsAuth.some((u) => u.email === email), false);
  assert.equal((await inscrire(email)).status, 201, 'réinscription possible');
});

test('RC-2 — ÉCHEC DE LA COMPENSATION (Supabase renvoie une erreur) : journalisé, orphelin identifié, puis récupéré', async (t) => {
  const email = 'rc2@agrikonnect.test';
  const original = supabaseAdmin.auth.admin.deleteUser;
  // Comportement réel de supabase-js en erreur HTTP : PAS d'exception, un objet { error }.
  supabaseAdmin.auth.admin.deleteUser = async () => ({ data: null, error: { message: 'panne Supabase simulée', status: 500 } });
  let r;
  try {
    r = await avecPanneTransaction(() => inscrire(email));
  } finally {
    supabaseAdmin.auth.admin.deleteUser = original;
  }
  const avant = await rapport();
  const orphelin = avant.orphelinsAuth.find((u) => u.email === email);
  const journal = avant.compensationsEchouees.find((c) => c.id === orphelin?.id);
  const reinscription = await inscrire(email);
  const c = await connexion(email);
  const apres = await rapport();
  const profil = await h.prisma.profile.findUnique({ where: { id: orphelin?.id ?? '' }, include: { memberships: true } });
  const recupere = await h.prisma.auditLog.count({ where: { action: 'auth.profile.recovered', resourceId: orphelin?.id ?? '' } });
  t.diagnostic(`RC-2 : inscription ${r.status} ; orphelin Auth identifié=${Boolean(orphelin)} ; échec de compensation journalisé=${Boolean(journal)} ; réinscription ${reinscription.status} (${reinscription.body?.code}) ; connexion ${c.status} ; profil recréé=${Boolean(profil)} (audit ${recupere}) ; rôle restauré ${JSON.stringify(profil?.memberships?.map((m) => m.roles))} (demandé à l’inscription : BUYER) ; orphelin après=${apres.orphelinsAuth.some((u) => u.email === email)}`);
  assert.equal(r.status, 500);
  assert.ok(orphelin, 'orphelin Auth identifié par la réconciliation');
  assert.ok(journal, 'échec de compensation journalisé dans l’audit');
  assert.equal(reinscription.status, 409, 'l’adresse existe côté Supabase : réinscription refusée');
  assert.equal(c.status, 200, 'la connexion récupère le compte');
  assert.ok(profil, 'profil recréé à la connexion');
  assert.equal(recupere, 1, 'récupération auditée');
  assert.equal(apres.orphelinsAuth.some((u) => u.email === email), false, 'plus orphelin');
  // Limite documentée : le type de compte demandé n'est pas restauré (FARMER par défaut).
  assert.deepEqual(profil.memberships.map((m) => m.roles), [['FARMER']]);
});

test('RC-3 — arrêt du serveur entre la création Auth et la transaction (simulé : utilisateur Auth seul) : identifié par la réconciliation', async () => {
  const { data } = await supabaseAdmin.auth.admin.createUser({ email: 'rc3@agrikonnect.test', password: PASSWORD });
  const rap = await rapport();
  assert.ok(rap.orphelinsAuth.some((u) => u.id === data.user.id));
  assert.equal(rap.compensationsEchouees.some((c) => c.id === data.user.id), false, 'aucun journal : seul le rapport le révèle');
});

test('RC-4 — profil sans utilisateur Auth (ancien défaut TX-1, ou suppression dans la console) : identifié', async () => {
  const email = 'rc4@agrikonnect.test';
  const r = await inscrire(email);
  await supabaseAdmin.auth.admin.deleteUser(r.body.data.user.id);
  const rap = await rapport();
  assert.ok(rap.orphelinsApplicatifs.some((p) => p.email === email));
});
