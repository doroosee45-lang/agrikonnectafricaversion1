/**
 * Notifications push FCM : compte de service chargé depuis un FICHIER JSON,
 * `POST /notifications/register-token`, `POST /notifications/send-test`,
 * `sendPushNotification`.
 *
 * PostgreSQL embarqué + GoTrue simulé + transport FCM SIMULÉ (aucun appel vers
 * Google). Le compte de service est GÉNÉRÉ pendant le test (aucun secret réel).
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-fcm-'));
const fichierCompte = path.join(dossier, 'compte-de-service.json');
const compte = {
  type: 'service_account',
  project_id: 'projet-fcm-test',
  private_key_id: 'cle-test',
  private_key: rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  client_email: 'firebase-adminsdk-test@projet-fcm-test.iam.gserviceaccount.com',
};
fs.writeFileSync(fichierCompte, JSON.stringify(compte));

for (const cle of ['FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY', 'APNS_TEAM_ID', 'APNS_KEY_ID', 'APNS_PRIVATE_KEY', 'APNS_BUNDLE_ID']) {
  process.env[cle] = '';
}
Object.assign(process.env, { PUSH_ENABLED: 'true', FIREBASE_SERVICE_ACCOUNT_PATH: fichierCompte });

const { startHarness } = await import('./support/harness.mjs');

const PASSWORD = 'Agrikonnect!2026';
let h;
const comptes = {};
const envois = { fcm: [], assertions: [] };
const jeton = (prefixe = 'fcm') => `${prefixe}${crypto.randomBytes(40).toString('hex')}`;

const inscrire = async (cle) => {
  const email = `${cle}-fcm@agrikonnect.test`;
  const r = await h.request('POST', '/auth/register', {
    body: { accountType: 'FARMER', firstName: cle, lastName: 'Fcm', email, password: PASSWORD, countryCode: 'CD', locale: 'fr' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const c = await h.request('POST', '/auth/login', { body: { identifier: email, password: PASSWORD } });
  comptes[cle] = { id: r.body.data.user.id, token: c.body.data.session.accessToken };
};
const appel = (cle, methode, chemin, body) => h.request(methode, chemin, { token: comptes[cle].token, body });

before(async () => {
  h = await startHarness();
  const { definirTransportPushPourTests } = await import('../../src/integrations/push.js');
  definirTransportPushPourTests({
    oauth: async (assertion) => {
      envois.assertions.push(assertion);
      return { status: 200, body: { access_token: 'jeton-acces-factice', expires_in: 3600 } };
    },
    fcm: async ({ projectId, message }) => {
      envois.fcm.push({ projectId, message });
      return message.message.token.startsWith('desinstalle')
        ? { status: 404, body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } }
        : { status: 200, body: { name: `projects/${projectId}/messages/1` } };
    },
    apns: async () => ({ status: 200, body: {} }),
  });
  await inscrire('awa');
  await inscrire('bob');
}, { timeout: 240_000 });

after(async () => {
  await h?.stop?.();
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('FCM-1 — identifiants lus depuis le fichier du compte de service (une seule lecture)', async () => {
  const { identifiantsFcm } = await import('../../src/config/firebase.js');
  const { fcmConfigure } = await import('../../src/integrations/push.js');
  const id = identifiantsFcm();
  assert.equal(id.source, 'fichier');
  assert.equal(id.projectId, 'projet-fcm-test');
  assert.equal(id.clientEmail, compte.client_email);
  assert.equal(fcmConfigure(), true);
  assert.equal(identifiantsFcm(), id, 'mémoïsé : même objet, pas de relecture');
});

test('FCM-2 — fichier invalide : erreur générique, AUCUN extrait du contenu', async () => {
  const { lireCompteDeService } = await import('../../src/config/firebase.js');
  const corrompu = path.join(dossier, 'corrompu.json');
  fs.writeFileSync(corrompu, `{"private_key": "SECRET-NE-PAS-AFFICHER", oups`);
  assert.throws(() => lireCompteDeService(corrompu), (e) => /JSON invalide/.test(e.message) && !e.message.includes('SECRET'));
  fs.writeFileSync(corrompu, JSON.stringify({ type: 'service_account', project_id: 'p' }));
  assert.throws(() => lireCompteDeService(corrompu), /incomplet/);
  assert.throws(() => lireCompteDeService(path.join(dossier, 'absent.json')), /introuvable/);
});

test('FCM-3 — register-token : validation (plateforme, jeton, clés)', async () => {
  assert.equal((await appel('awa', 'POST', '/notifications/register-token', { token: jeton() })).status, 422, 'plateforme requise');
  assert.equal((await appel('awa', 'POST', '/notifications/register-token', { token: 'court', platform: 'android' })).status, 422);
  assert.equal((await appel('awa', 'POST', '/notifications/register-token', { token: jeton(), platform: 'android', userId: comptes.bob.id })).status, 422, 'aucun champ inconnu (jamais un userId fourni par l’appareil)');
  assert.equal((await h.request('POST', '/notifications/register-token', { body: { token: jeton(), platform: 'android' } })).status, 401);
});

test('FCM-4 — register-token puis send-test : notification reçue par FCM, signée avec la clé du fichier', async () => {
  const jetonAwa = jeton();
  const r = await appel('awa', 'POST', '/notifications/register-token', { token: jetonAwa, platform: 'android', installationId: 'ak-installation-awa-1', appVersion: '1.0.0', locale: 'fr' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.platform, 'ANDROID');
  assert.equal(r.body.data.tokenSuffix, jetonAwa.slice(-6));
  assert.equal(JSON.stringify(r.body).includes(jetonAwa), false, 'jeton jamais renvoyé en clair');
  // même jeton réenregistré (onTokenRefresh, redémarrage) : pas de doublon
  assert.equal((await appel('awa', 'POST', '/notifications/register-token', { token: jetonAwa, platform: 'android', installationId: 'ak-installation-awa-1' })).status, 201);
  assert.equal(await h.prisma.pushDevice.count({ where: { userId: comptes.awa.id, revokedAt: null } }), 1);

  envois.fcm.length = 0;
  const t = await appel('awa', 'POST', '/notifications/send-test', { title: 'Bonjour', body: 'Test FCM', data: { ecran: 'parametres', n: 3 } });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.equal(t.body.data.sent, 1);
  assert.equal(t.body.data.appareilsActifs, 1);
  assert.equal(envois.fcm.length, 1);
  const { projectId, message } = envois.fcm[0];
  assert.equal(projectId, 'projet-fcm-test');
  assert.equal(message.message.token, jetonAwa);
  assert.deepEqual(message.message.notification, { title: 'Bonjour', body: 'Test FCM' });
  assert.equal(message.message.data.type, 'PUSH_TEST');
  assert.equal(message.message.data.ecran, 'parametres');
  assert.equal(message.message.data.n, '3', 'FCM : valeurs en chaînes');

  // L'assertion OAuth est signée avec la clé privée DU FICHIER.
  const [entete, charge, signature] = envois.assertions.at(-1).split('.');
  assert.equal(JSON.parse(Buffer.from(charge, 'base64url')).iss, compte.client_email);
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(`${entete}.${charge}`), rsa.publicKey, Buffer.from(signature, 'base64url')), true);
});

test('FCM-5 — iOS : jeton FCM accepté (Firebase relaie vers APNs)', async () => {
  const r = await appel('bob', 'POST', '/notifications/register-token', { token: jeton(), platform: 'ios' });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.platform, 'IOS');
  assert.equal(r.body.data.provider, 'FCM');
  assert.match(r.body.data.installationId, /^fcm-[0-9a-f]{32}$/, 'identifiant dérivé si absent');
});

test('FCM-6 — send-test vers un AUTRE utilisateur : refusé à un non-administrateur, rien n’est envoyé', async () => {
  envois.fcm.length = 0;
  const r = await appel('awa', 'POST', '/notifications/send-test', { userId: comptes.bob.id });
  assert.equal(r.status, 403);
  assert.equal(envois.fcm.length, 0);
  assert.equal((await appel('awa', 'POST', '/notifications/send-test', { data: { google_x: 'a' } })).status, 422, 'clé réservée FCM');
});

test('FCM-7 — sendPushNotification : jeton désinstallé (UNREGISTERED) révoqué, les autres appareils servis', async () => {
  const { sendPushNotification } = await import('../../src/modules/push/sendPushNotification.js');
  await appel('awa', 'POST', '/notifications/register-token', { token: jeton('desinstalle'), platform: 'android', installationId: 'ak-installation-awa-2' });
  envois.fcm.length = 0;
  const bilan = await sendPushNotification(comptes.awa.id, 'Nouveau message', 'Bob : Salut', { type: 'MESSAGE_NEW', conversationId: 'conv-1' });
  assert.deepEqual({ sent: bilan.sent, revoked: bilan.revoked }, { sent: 1, revoked: 1 });
  assert.equal(envois.fcm.length, 2);
  assert.ok(envois.fcm.every(({ message }) => message.message.data.type === 'MESSAGE_NEW' && message.message.android.ttl === '86400s'));
  assert.equal(await h.prisma.pushDevice.count({ where: { userId: comptes.awa.id, revokedAt: null } }), 1);
});

test('FCM-8 — désactivé : PUSH_ENABLED=false ou aucune source d’identifiants → FCM inactif', async () => {
  const { fcmConfigure } = await import('../../src/integrations/push.js');
  assert.equal(fcmConfigure({ PUSH_ENABLED: 'false', FIREBASE_SERVICE_ACCOUNT_PATH: fichierCompte }), false);
  assert.equal(fcmConfigure({ PUSH_ENABLED: 'true' }), false);
  assert.equal(fcmConfigure({ PUSH_ENABLED: 'true', FIREBASE_SERVICE_ACCOUNT_PATH: path.join(dossier, 'absent.json') }), false, 'fichier absent : désactivé, pas de plantage');
  assert.equal(fcmConfigure({ PUSH_ENABLED: 'true', FIREBASE_SERVICE_ACCOUNT_PATH: fichierCompte }), true);
});
