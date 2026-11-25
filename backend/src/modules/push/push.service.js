/**
 * Registre des appareils push de l'utilisateur connecté (`/me/push-devices`).
 *
 *  - un jeton est unique par fournisseur : réenregistré par un autre compte
 *    (téléphone cédé, changement de compte), il CHANGE de propriétaire au lieu
 *    d'être partagé — l'ancien titulaire ne reçoit plus rien ;
 *  - rotation : un nouveau jeton pour la même installation et le même
 *    fournisseur révoque l'ancien (les fournisseurs font tourner les jetons) ;
 *  - plafond d'appareils actifs par compte (les plus anciens sont révoqués) ;
 *  - le jeton n'est JAMAIS renvoyé en clair (seulement ses 6 derniers caractères).
 */
import crypto from 'node:crypto';

import { prisma } from '../../config/prisma.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import { resolveId } from '../../shared/ids.js';
import { audit } from '../../shared/audit.js';
import { sendPushNotification } from './sendPushNotification.js';

export const APPAREILS_ACTIFS_MAX = 10;

const vue = (appareil) => ({
  id: appareil.id,
  provider: appareil.provider,
  platform: appareil.provider === 'FCM' ? 'ANDROID' : 'IOS',
  tokenSuffix: String(appareil.token).slice(-6),
  installationId: appareil.installationId,
  appVersion: appareil.appVersion,
  lastSeenAt: appareil.lastSeenAt,
  createdAt: appareil.createdAt,
});

export const lister = async (req) => {
  const appareils = await prisma.pushDevice.findMany({
    where: { userId: req.user.id, revokedAt: null },
    orderBy: { lastSeenAt: 'desc' },
  });
  return appareils.map(vue);
};

export const enregistrer = async ({ provider, token, installationId, appVersion, locale }, req) => {
  const maintenant = new Date();
  const appareil = await prisma.$transaction(async (tx) => {
    // Rotation : même installation + même fournisseur, autre jeton → l'ancien est révoqué.
    await tx.pushDevice.updateMany({
      where: { provider, installationId, token: { not: token }, revokedAt: null },
      data: { revokedAt: maintenant, revokedReason: 'rotated' },
    });

    const resultat = await tx.pushDevice.upsert({
      where: { provider_token: { provider, token } },
      create: {
        id: resolveId(), userId: req.user.id, provider, token, installationId,
        appVersion: appVersion ?? null, locale: locale ?? null, lastSeenAt: maintenant,
      },
      update: {
        userId: req.user.id, installationId, appVersion: appVersion ?? null, locale: locale ?? null,
        lastSeenAt: maintenant, revokedAt: null, revokedReason: null,
      },
    });

    // Plafond : au-delà, les appareils les moins récemment vus sont révoqués.
    const actifs = await tx.pushDevice.findMany({
      where: { userId: req.user.id, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true },
    });
    const enTrop = actifs.slice(APPAREILS_ACTIFS_MAX).map((a) => a.id);
    if (enTrop.length > 0) {
      await tx.pushDevice.updateMany({
        where: { id: { in: enTrop } },
        data: { revokedAt: maintenant, revokedReason: 'device_limit' },
      });
    }
    return resultat;
  });

  await audit({
    actorId: req.user.id,
    action: 'push.device.register',
    resource: 'push_devices',
    resourceId: appareil.id,
    req,
    newValue: { provider, installationId, tokenSuffix: String(token).slice(-6) },
  });
  return vue(appareil);
};

export const retirer = async (id, req) => {
  const { count } = await prisma.pushDevice.updateMany({
    where: { id, userId: req.user.id, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'user_removed' },
  });
  if (count === 0) throw ApiError.notFound('Appareil introuvable');
  await audit({ actorId: req.user.id, action: 'push.device.remove', resource: 'push_devices', resourceId: id, req });
  return { removed: true };
};

/* ───────── /notifications/register-token et /notifications/send-test ───────── */

/**
 * Identifiant d'installation dérivé du jeton, pour un client qui n'en fournit
 * pas. Sans identifiant stable, la rotation d'un jeton ne révoque pas
 * l'ancien : il le sera au premier refus de FCM ou par le plafond d'appareils.
 */
export const installationDepuisJeton = (token) =>
  `fcm-${crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 32)}`;

/**
 * Enregistre le jeton FCM de l'appareil (Android ou iOS) pour l'utilisateur
 * connecté. Le jeton FCM vaut pour les deux plateformes (sur iOS, Firebase
 * relaie vers APNs avec la clé APNs déposée dans la console Firebase).
 */
export const enregistrerJetonFcm = ({ token, platform, installationId, appVersion, locale }, req) =>
  enregistrer(
    { provider: 'FCM', token, installationId: installationId ?? installationDepuisJeton(token), appVersion, locale },
    req,
  ).then((appareil) => ({ ...appareil, platform: platform.toUpperCase() }));

const ROLES_ENVOI_TIERS = ['ADMIN', 'SUPER_ADMIN'];

/**
 * Notification de test. Cible : l'utilisateur connecté, ou `userId` — réservé
 * aux administrateurs (sinon n'importe quel compte pourrait solliciter les
 * appareils d'un autre).
 */
export const envoyerTest = async ({ title, body, data, userId }, req) => {
  const cible = userId ?? req.user.id;
  if (cible !== req.user.id) {
    const roles = req.tenant?.effectiveRoles ?? req.user?.roles ?? [];
    if (!roles.some((r) => ROLES_ENVOI_TIERS.includes(r))) {
      throw ApiError.forbidden('Seul un administrateur peut envoyer une notification de test à un autre utilisateur');
    }
    const existe = await prisma.profile.findUnique({ where: { id: cible }, select: { id: true } });
    if (!existe) throw ApiError.notFound('Utilisateur introuvable');
  }
  const appareilsActifs = await prisma.pushDevice.count({ where: { userId: cible, revokedAt: null } });
  const bilan = await sendPushNotification(
    cible,
    title ?? 'AgriKonnect — notification de test',
    body ?? 'Si tu lis ceci, les notifications push fonctionnent sur cet appareil.',
    { type: 'PUSH_TEST', ...(data ?? {}) },
  );
  await audit({
    actorId: req.user.id,
    action: 'push.test.send',
    resource: 'push_devices',
    resourceId: cible,
    req,
    newValue: { appareilsActifs, ...bilan },
  });
  return { targetUserId: cible, appareilsActifs, ...bilan };
};
