import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness } from './support/harness.mjs';

/**
 * Stabilisation backend V1 — recette de bout en bout, base PostgreSQL réelle.
 *
 * Verrouille les correctifs du lot d'audit sur le chemin HTTP complet
 * (authentification réelle, tenant, permissions, contraintes SQL) :
 *   - H-07 rétabli sur /messaging et /calls (compte vérifié pour écrire) ;
 *   - PATCH /organizations/:id utilisable par le responsable (404 systématique avant) ;
 *   - GET /verifications/me ouvert aux acteurs non producteurs (403 avant) ;
 *   - dossier de vérification impossible au nom d'autrui ;
 *   - pièces jointes : clé de stockage étrangère refusée, `attachmentUrls` exposé ;
 *   - /media/upload-url : plus de 403 pour un acheteur ni de 422 pour `kind: IMAGE` ;
 *   - vue coopérative : agrégation limitée à l'exploitation INDIVIDUELLE du membre.
 */

let h;
const PASSWORD = 'MotDePasse!2026';
const comptes = {};

const inscrire = async (cle, accountType = 'FARMER', { verifie = true } = {}) => {
  const email = `${cle}-stab@agrikonnect.test`;
  const r = await h.request('POST', '/auth/register', {
    body: { accountType, firstName: cle, lastName: 'Stab', email, password: PASSWORD, countryCode: 'CD', locale: 'fr' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const c = await h.request('POST', '/auth/login', { body: { identifier: email, password: PASSWORD } });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const id = r.body.data.user.id;
  // État de vérification posé explicitement : la recette ne dépend pas du
  // comportement du stub GoTrue à l'inscription.
  await h.prisma.profile.update({ where: { id }, data: { emailVerifiedAt: verifie ? new Date() : null, phoneVerifiedAt: null } });
  comptes[cle] = { id, email, organizationId: r.body.data.organization.id, token: c.body.data.session.accessToken };
  return comptes[cle];
};

const as = (cle, method, path, opts = {}) =>
  h.request(method, path, { token: comptes[cle].token, ...opts });

before(async () => {
  h = await startHarness();
  await inscrire('awa');
  await inscrire('ben', 'BUYER');
  await inscrire('cleo');
  await inscrire('dan', 'FARMER', { verifie: false });
  await inscrire('corp', 'AGRICULTURAL_COMPANY');
}, { timeout: 240_000 });

after(async () => {
  await h?.stop?.();
});

test('H-07 — un compte non vérifié ne crée pas de groupe ; la synchronisation reste lisible', async () => {
  const groupe = await as('dan', 'POST', '/messaging/groups', {
    body: { name: 'Groupe test', participantOrgIds: [comptes.awa.organizationId] },
  });
  assert.equal(groupe.status, 403, JSON.stringify(groupe.body));
  assert.equal(groupe.body.details?.accountNotVerified, true);

  const appel = await as('dan', 'POST', '/calls', { body: { conversationId: 'conv_0000000000', inviteeUserIds: [comptes.awa.id] } });
  assert.equal(appel.status, 403, 'appel refusé avant tout traitement');

  const sync = await as('dan', 'POST', '/messaging/sync', { body: { lastPulledAt: 0 } });
  assert.equal(sync.status, 200, JSON.stringify(sync.body));
  assert.equal(sync.body.data.hasMore, false);
});

test('Organisation — le responsable modifie SON organisation, jamais celle d’un autre', async () => {
  const mienne = await as('awa', 'PATCH', `/organizations/${comptes.awa.organizationId}`, { body: { description: 'Exploitation familiale' } });
  assert.equal(mienne.status, 200, JSON.stringify(mienne.body));
  assert.equal(mienne.body.data.description, 'Exploitation familiale');

  const autre = await as('awa', 'PATCH', `/organizations/${comptes.cleo.organizationId}`, { body: { description: 'piratage' } });
  assert.equal(autre.status, 404);
  const intacte = await h.prisma.organization.findUnique({ where: { id: comptes.cleo.organizationId } });
  assert.notEqual(intacte.description, 'piratage');
});

test('Vérification — un acheteur lit son statut ; personne ne dépose au nom d’autrui', async () => {
  const statut = await as('ben', 'GET', '/verifications/me');
  assert.equal(statut.status, 200, JSON.stringify(statut.body));
  assert.ok(Array.isArray(statut.body.data.criteria));

  const usurpation = await as('awa', 'POST', '/verifications', {
    body: { subjectType: 'PROFILE', subjectId: comptes.cleo.id, level: 'PROFILE_VERIFIED' },
  });
  assert.equal(usurpation.status, 404, JSON.stringify(usurpation.body));

  // La vraie personne n'est pas bloquée par un dossier fantôme.
  const legitime = await as('cleo', 'POST', '/verifications', { body: { level: 'PROFILE_VERIFIED' } });
  assert.equal(legitime.status, 201, JSON.stringify(legitime.body));
  assert.equal(legitime.body.data.subjectId, comptes.cleo.id);
});

test('Médias — un acheteur peut demander une URL d’envoi avec `kind: IMAGE`', async () => {
  const r = await as('ben', 'POST', '/media/upload-url', {
    body: { filename: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 1024, kind: 'IMAGE' },
  });
  // Le banc n'a pas de stockage objet : l'URL signée elle-même ne peut pas être
  // obtenue ici (500 attendu du stub). Ce test prouve que la permission (403)
  // et la validation (422) ne bloquent plus.
  assert.notEqual(r.status, 403, JSON.stringify(r.body));
  assert.notEqual(r.status, 422, JSON.stringify(r.body));
  const media = await h.prisma.media.findFirst({ where: { organizationId: comptes.ben.organizationId } });
  assert.ok(media, 'média enregistré sous l’organisation active');
  assert.equal(media.kind, 'PHOTO');
});

test('Pièces jointes — clé étrangère refusée, clé de l’expéditeur acceptée avec `attachmentUrls`', async () => {
  const conv = await as('ben', 'POST', '/messaging/conversations', {
    body: { subjectType: 'DIRECT', subjectId: 'direct-ben-awa-stab', participantOrgIds: [comptes.awa.organizationId] },
  });
  assert.ok([200, 201].includes(conv.status), JSON.stringify(conv.body));
  const id = conv.body.data.id;

  const etrangere = await as('ben', 'POST', `/messaging/conversations/${id}/messages`, {
    body: { body: 'doc', attachments: [`${comptes.awa.organizationId}/documents/2026-11/0b6f1d2e-3c4a-4b5d-8e6f-7a8b9c0d1e2f.pdf`] },
  });
  assert.equal(etrangere.status, 422, JSON.stringify(etrangere.body));

  const propre = await as('ben', 'POST', `/messaging/conversations/${id}/messages`, {
    body: { body: 'photo', attachments: [`${comptes.ben.organizationId}/media/2026-11/1c7e2f3a-4d5b-4c6e-9f70-8b9cad0e1f30.jpg`] },
  });
  assert.equal(propre.status, 201, JSON.stringify(propre.body));
  assert.equal(propre.body.data.attachmentUrls.length, 1);

  const fil = await as('awa', 'GET', `/messaging/conversations/${id}/messages`);
  assert.equal(fil.status, 200);
  const recu = fil.body.data.messages.find((m) => m.body === 'photo');
  assert.ok(recu, 'le destinataire voit le message');
  assert.ok(Array.isArray(recu.attachmentUrls));
});

test('Coopérative — l’agrégation ne lit que l’exploitation individuelle du membre consentant', async () => {
  const point = { type: 'Point', coordinates: [15.3, -4.3] };

  // Parcelle de Cléo dans SON organisation individuelle : 2 ha.
  const fermeCleo = await as('cleo', 'POST', '/farms', { body: { name: 'Ferme Cléo', countryCode: 'CD' } });
  assert.equal(fermeCleo.status, 201, JSON.stringify(fermeCleo.body));
  const pCleo = await as('cleo', 'POST', '/plots', { body: { farmId: fermeCleo.body.data.farm.id, name: 'Parcelle C', areaHa: 2, geometry: point } });
  assert.equal(pCleo.status, 201, JSON.stringify(pCleo.body));

  // Parcelle d'une entreprise où Cléo est aussi membre : 50 ha, hors consentement.
  const fermeCorp = await as('corp', 'POST', '/farms', { body: { name: 'Domaine Corp', countryCode: 'CD' } });
  assert.equal(fermeCorp.status, 201, JSON.stringify(fermeCorp.body));
  const pCorp = await as('corp', 'POST', '/plots', { body: { farmId: fermeCorp.body.data.farm.id, name: 'Bloc 1', areaHa: 50, geometry: point } });
  assert.equal(pCorp.status, 201, JSON.stringify(pCorp.body));
  await h.prisma.membership.create({
    data: { userId: comptes.cleo.id, organizationId: comptes.corp.organizationId, roles: ['FARMER'], status: 'ACTIVE' },
  });

  const coop = await as('awa', 'POST', '/organizations', { body: { type: 'COOPERATIVE', name: 'Coop Stabilisation', countryCode: 'CD' } });
  assert.equal(coop.status, 201, JSON.stringify(coop.body));
  const enCoop = { headers: { 'X-Organization-Id': coop.body.data.id } };
  const coopId = coop.body.data.cooperative.id;

  const membre = await as('awa', 'POST', `/cooperatives/${coopId}/members`, {
    ...enCoop,
    body: { identifier: comptes.cleo.email, consentScopes: ['plots'] },
  });
  assert.equal(membre.status, 201, JSON.stringify(membre.body));
  const actif = await as('awa', 'PATCH', `/cooperatives/${coopId}/members/${membre.body.data.id}`, { ...enCoop, body: { status: 'ACTIVE' } });
  assert.equal(actif.status, 200, JSON.stringify(actif.body));

  const vue = await as('awa', 'GET', `/cooperatives/${coopId}/overview`, enCoop);
  assert.equal(vue.status, 200, JSON.stringify(vue.body));
  assert.equal(vue.body.data.plots.count, 1);
  assert.equal(vue.body.data.plots.totalAreaHa, 2, 'les 50 ha de l’entreprise ne sont jamais agrégés');
});
