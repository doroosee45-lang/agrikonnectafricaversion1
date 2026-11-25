import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness } from './support/harness.mjs';

/**
 * Transactions et intégrité — démonstrations SANS modification du code applicatif.
 * TESTÉ sur PostgreSQL embarqué et faux GoTrue ; rien de VALIDÉ sur Supabase réel.
 *
 *  TX-1 : inscription — une écriture APRÈS la transaction échoue : le `catch`
 *         supprime l'utilisateur Supabase, mais le profil validé reste.
 *  TX-2 : `ensureBusinessConversation` — lecture puis création, sans contrainte
 *         d'unicité : deux demandes simultanées créent-elles deux fils ?
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

test(
  'TX-1 — échec après la transaction d’inscription : aucune trace, et la même adresse peut se réinscrire',
  { todo: 'ANOMALIE TX-1 — profil orphelin validé ; utilisateur Supabase supprimé ; adresse bloquée' },
  async (t) => {
    const email = 'orphelin-tx@agrikonnect.test';
    const panne = () => Promise.reject(new Error('panne injectée après la transaction'));
    const origines = { updateMany: h.prisma.profile.updateMany, tokenCreate: h.prisma.token.create };
    h.prisma.profile.updateMany = panne;
    h.prisma.token.create = panne;
    let premier;
    try {
      premier = await inscrire(email, { consentReference: 'CONSENT-TX1-0001' });
    } finally {
      h.prisma.profile.updateMany = origines.updateMany;
      h.prisma.token.create = origines.tokenCreate;
    }
    const profils = await h.prisma.profile.count({ where: { email } });
    const second = await inscrire(email);
    t.diagnostic(`TX-1 : 1re inscription ${premier.status} (${premier.body?.code ?? ''}) ; profils en base après échec : ${profils} ; réinscription ${second.status} (${second.body?.code ?? ''} ${second.body?.message ?? ''})`);
    assert.notEqual(premier.status, 201, 'la panne doit atteindre le chemin d’erreur (sinon le test ne démontre rien)');
    assert.equal(profils, 0, `observé : ${profils} profil(s) orphelin(s) après l’échec`);
    assert.equal(second.status, 201, `observé : réinscription ${second.status}`);
  },
);

test(
  'TX-2 — trente ouvertures simultanées du même fil DIRECT : un seul fil',
  { todo: 'ANOMALIE TX-2 — lecture puis création sans contrainte d’unicité : fils en double' },
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
