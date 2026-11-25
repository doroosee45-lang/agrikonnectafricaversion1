import { Platform } from 'react-native';

import { chargerMessagingPush, contenuPremierPlan, type MessagePush } from './pushNotifications';

declare const require: (id: string) => any;

/**
 * Réception des push en ARRIÈRE-PLAN ou application FERMÉE.
 *
 * Doit être enregistré au tout début du bundle, avant React : importé en
 * premier par `index.js`.
 *
 * - Message avec `notification` (cas de `sendPushNotification`) : le système
 *   l'affiche lui-même ; rien à faire ici.
 * - Message de DONNÉES seules portant un titre ou un corps : affiché en
 *   notification locale (expo-notifications).
 *
 * Firebase n'accepte qu'UN gestionnaire : le dernier enregistré gagne. Quand
 * les appels natifs sont actifs, `features/calls/background.ts` (importé APRÈS
 * dans index.js) le remplace par le sien, qui gère la sonnerie.
 */
export function enregistrerPushArrierePlan(): void {
  const firebase = chargerMessagingPush();
  if (!firebase) return;
  firebase.setBackgroundMessageHandler(firebase.getMessaging(), async (message: MessagePush) => {
    if (message.notification) return;
    const contenu = contenuPremierPlan(message);
    if (!contenu) return;
    try {
      const notifications = require('expo-notifications');
      await notifications.scheduleNotificationAsync({
        content: { title: contenu.titre, body: contenu.corps, data: message.data ?? {} },
        trigger: null,
      });
    } catch {
      /* module indisponible : message ignoré */
    }
  });
}

// Effet de bord voulu : importé en premier par index.js (Android et iOS).
if (Platform.OS === 'android' || Platform.OS === 'ios') enregistrerPushArrierePlan();
