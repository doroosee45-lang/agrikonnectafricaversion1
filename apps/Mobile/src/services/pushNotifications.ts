import { Alert, PermissionsAndroid, Platform } from 'react-native';

import { identifiantInstallation } from '@/features/calls/pushDevices';
import { useI18nStore } from '@/i18n';
import { APP } from '@/lib/config';
import { MODULES_NATIFS, estExpoGo, moduleNatifPresent } from '@/lib/nativeEnv';
import { api } from '@/services/api/http';

import { cheminPourNotification, contenuPremierPlan, type DonneesPush, type MessagePush } from './pushRoutage';

export { cheminPourNotification, contenuPremierPlan, type DonneesPush, type MessagePush };

/**
 * Notifications push Firebase Cloud Messaging (Android et iOS).
 *
 * Cycle de vie (piloté par `usePushNotifications`, après connexion) :
 * 1. permission : Android 13+ `POST_NOTIFICATIONS`, iOS `requestPermission` ;
 * 2. jeton FCM (`getToken`) → `POST /notifications/register-token`, et à
 *    chaque renouvellement (`onTokenRefresh`) ;
 * 3. réception :
 *    - premier plan : `onMessage` → bannière locale (expo-notifications),
 *      repli sur une alerte ;
 *    - arrière-plan / application fermée : le système affiche la notification
 *      tout seul ; `setBackgroundMessageHandler` est enregistré au point
 *      d'entrée (`index.js` → `pushBackground.ts`) pour les messages de données ;
 *    - clic : `onNotificationOpenedApp` (arrière-plan), `getInitialNotification`
 *      (application fermée) et clic sur une bannière locale → écran ciblé.
 * 4. déconnexion : jeton retiré côté serveur et supprimé côté Firebase.
 *
 * Activé par le drapeau de build `EXPO_PUBLIC_PUSH=true` (ou les appels
 * natifs). Dans Expo Go, sur le web ou sans le drapeau, tout est sans effet.
 *
 * Les modules natifs sont chargés PARESSEUSEMENT avec un `require` statique
 * (résolu par Metro) dans un try/catch : un `import` en tête ferait planter
 * Expo Go, qui ne contient pas Firebase.
 */

declare const require: (id: string) => any;

export const PUSH_DEMANDE =
  process.env.EXPO_PUBLIC_PUSH === 'true' || process.env.EXPO_PUBLIC_NATIVE_CALLS === 'true';

/**
 * Push utilisable : drapeau de build, iOS/Android, pas Expo Go, et Firebase
 * réellement compilé dans ce binaire (sinon : reconstruire le build natif).
 */
export function pushPossible(): boolean {
  if (!PUSH_DEMANDE) return false;
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
  if (estExpoGo()) return false;
  return moduleNatifPresent(...MODULES_NATIFS.firebase);
}

let moduleMessaging: any | null | undefined;
let moduleNotifications: any | null | undefined;

/** API modulaire de @react-native-firebase/messaging, ou `null`. */
export function chargerMessagingPush(): any | null {
  if (!pushPossible()) return null;
  if (moduleMessaging === undefined) {
    try {
      moduleMessaging = require('@react-native-firebase/messaging');
    } catch {
      moduleMessaging = null;
    }
  }
  return moduleMessaging;
}

function chargerNotifications(): any | null {
  if (!pushPossible()) return null;
  if (moduleNotifications === undefined) {
    try {
      const notifications = require('expo-notifications');
      // Les bannières locales s'affichent même application ouverte.
      notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
      if (Platform.OS === 'android') {
        void notifications.setNotificationChannelAsync('default', {
          name: 'AgriKonnect',
          importance: notifications.AndroidImportance.HIGH,
        });
      }
      moduleNotifications = notifications;
    } catch {
      moduleNotifications = null;
    }
  }
  return moduleNotifications;
}

/* ───────────── permission et jeton ───────────── */

export async function demanderPermissionPush(): Promise<boolean> {
  const firebase = chargerMessagingPush();
  if (!firebase) return false;
  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    const resultat = await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as never);
    if (resultat !== PermissionsAndroid.RESULTS.GRANTED) return false;
  }
  const statut = await firebase.requestPermission(firebase.getMessaging());
  return statut === firebase.AuthorizationStatus.AUTHORIZED || statut === firebase.AuthorizationStatus.PROVISIONAL;
}

export async function enregistrerJetonPush(token: string): Promise<void> {
  await api.post('/notifications/register-token', {
    token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    installationId: await identifiantInstallation(),
    appVersion: APP.version,
    locale: useI18nStore.getState().locale,
  });
}

/* ───────────── affichage et navigation ───────────── */

async function afficherAuPremierPlan(message: MessagePush): Promise<void> {
  const contenu = contenuPremierPlan(message);
  if (!contenu) return;
  const notifications = chargerNotifications();
  if (notifications) {
    try {
      await notifications.scheduleNotificationAsync({
        content: { title: contenu.titre, body: contenu.corps, data: message.data ?? {} },
        trigger: null,
      });
      return;
    } catch {
      /* repli ci-dessous */
    }
  }
  Alert.alert(contenu.titre, contenu.corps);
}

/* ───────────── démarrage ───────────── */

let notificationInitialeTraitee = false;

/**
 * Démarre les notifications pour l'utilisateur connecté. Renvoie la fonction
 * qui retire tous les écouteurs. Ne lève jamais : un échec (hors ligne,
 * permission refusée) laisse l'application intacte et sera réessayé au
 * prochain démarrage ou à la prochaine connexion.
 */
export async function demarrerPush(naviguer: (chemin: string) => void): Promise<() => void> {
  const firebase = chargerMessagingPush();
  if (!firebase) return () => undefined;
  const nettoyages: Array<() => void> = [];
  const ouvrir = (donnees?: DonneesPush | null) => {
    const chemin = cheminPourNotification(donnees);
    if (chemin) naviguer(chemin);
  };

  try {
    const messaging = firebase.getMessaging();
    if (!(await demanderPermissionPush())) return () => undefined;

    const jeton: string | null = await firebase.getToken(messaging).catch(() => null);
    if (jeton) await enregistrerJetonPush(jeton).catch(() => undefined);

    nettoyages.push(
      firebase.onTokenRefresh(messaging, (nouveau: string) => {
        void enregistrerJetonPush(nouveau).catch(() => undefined);
      }),
      firebase.onMessage(messaging, (message: MessagePush) => {
        void afficherAuPremierPlan(message);
      }),
      firebase.onNotificationOpenedApp(messaging, (message: MessagePush) => ouvrir(message.data)),
    );

    const notifications = chargerNotifications();
    if (notifications) {
      const abonnement = notifications.addNotificationResponseReceivedListener((reponse: any) =>
        ouvrir(reponse?.notification?.request?.content?.data as DonneesPush),
      );
      nettoyages.push(() => abonnement.remove());
    }

    // Application lancée par un clic sur une notification (état « fermé ») : une seule fois.
    if (!notificationInitialeTraitee) {
      notificationInitialeTraitee = true;
      const initiale: MessagePush | null = await firebase.getInitialNotification(messaging).catch(() => null);
      if (initiale) ouvrir(initiale.data);
    }
  } catch {
    /* jamais bloquant */
  }
  return () => nettoyages.forEach((retirer) => retirer());
}

/* ───────────── déconnexion et test ───────────── */

interface AppareilServeur {
  id: string;
  installationId: string;
}

/** Retire le jeton de CETTE installation (à appeler AVANT la déconnexion, session encore valide). */
export async function retirerJetonPush(): Promise<void> {
  const firebase = chargerMessagingPush();
  if (!firebase) return;
  try {
    const installationId = await identifiantInstallation();
    const { data } = await api.get<AppareilServeur[]>('/me/push-devices');
    await Promise.all(
      (data ?? [])
        .filter((appareil) => appareil.installationId === installationId)
        .map((appareil) => api.delete(`/me/push-devices/${encodeURIComponent(appareil.id)}`).catch(() => undefined)),
    );
    await firebase.deleteToken(firebase.getMessaging()).catch(() => undefined);
  } catch {
    /* hors ligne : le serveur révoquera le jeton au premier refus de FCM */
  }
}

export interface BilanTestPush {
  targetUserId: string;
  appareilsActifs: number;
  sent: number;
  failed: number;
  revoked: number;
  skipped: number;
  disabled?: boolean;
}

/** Demande au serveur une notification de test vers l'utilisateur connecté. */
export async function envoyerNotificationTest(): Promise<BilanTestPush> {
  const { data } = await api.post<BilanTestPush>('/notifications/send-test', {});
  return data;
}
