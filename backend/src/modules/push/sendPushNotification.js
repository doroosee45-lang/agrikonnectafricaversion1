/**
 * Point d'entrée UNIQUE pour envoyer une notification push à un utilisateur,
 * sur tous ses appareils actifs (Android et iOS via FCM ; iOS via APNs si
 * configuré).
 *
 *   import { sendPushNotification } from '../push/sendPushNotification.js';
 *   await sendPushNotification(userId, 'Nouveau message', 'Awa : Bonjour', {
 *     type: 'MESSAGE_NEW', conversationId,
 *   });
 *
 * - Jamais bloquant : les erreurs du fournisseur sont journalisées (jeton
 *   masqué) et comptées dans le bilan, jamais levées. Les jetons refusés
 *   définitivement (désinstallation…) sont révoqués en base.
 * - `data` : valeurs converties en chaînes (exigence FCM). `data.type` sert à
 *   l'application pour choisir l'écran à ouvrir au clic.
 * - Désactivé tant que PUSH_ENABLED≠true ou sans identifiants : bilan
 *   `{ disabled: true }`, aucune erreur.
 *
 * Pour une notification qui doit AUSSI apparaître dans la boîte de réception
 * de l'application (historique, préférences par canal), passer plutôt par
 * `shared/events.js` (canal PUSH), qui appelle le même transport.
 */
import { envoyerAuxAppareils } from '../../integrations/push.js';

/** Durée de conservation par FCM si l'appareil est hors ligne (24 h). */
export const TTL_NOTIFICATION_SECONDES = 24 * 3600;

/**
 * @param {string} userId
 * @param {string} title
 * @param {string} body
 * @param {Record<string, unknown>} [data]
 * @returns {Promise<{ sent: number, failed: number, revoked: number, skipped: number, disabled?: boolean }>}
 */
export const sendPushNotification = async (userId, title, body, data = {}) =>
  envoyerAuxAppareils(userId, {
    genre: 'NOTIFICATION',
    type: typeof data?.type === 'string' ? data.type : 'GENERIC',
    titre: title,
    corps: body,
    donnees: data ?? {},
    ttlSecondes: TTL_NOTIFICATION_SECONDES,
    collapseId: typeof data?.collapseId === 'string' ? data.collapseId : null,
  });
