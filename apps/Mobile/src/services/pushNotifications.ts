import { Alert, AppState, PermissionsAndroid, Platform } from 'react-native';

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

/* ───────────── diagnostic (visible dans Paramètres) ───────────── */

/**
 * Étape atteinte par l'enregistrement push. Chaque échec était silencieux
 * (try/catch vides) : impossible de savoir, sur un APK, pourquoi aucun jeton
 * n'arrivait au serveur. L'étape et sa raison sont désormais journalisées et
 * affichées dans Paramètres → Notifications.
 */
export type EtapePush =
  | 'inactif' // drapeau de build absent
  | 'non-natif' // web / Expo Go
  | 'en-cours'
  | 'permission-refusee'
  | 'firebase-absent'
  | 'jeton-absent'
  | 'envoi-echoue'
  | 'enregistre';

export interface DiagnosticPush {
  etape: EtapePush;
  detail: string | null;
  a: number;
}

let diagnostic: DiagnosticPush = { etape: 'inactif', detail: null, a: Date.now() };
const ecouteursDiagnostic = new Set<(d: DiagnosticPush) => void>();

function noter(etape: EtapePush, detail: string | null = null) {
  diagnostic = { etape, detail, a: Date.now() };
  if (etape !== 'enregistre' && etape !== 'en-cours') console.warn('[push]', etape, detail ?? '');
  ecouteursDiagnostic.forEach((f) => f(diagnostic));
}

export const lireDiagnosticPush = () => diagnostic;
export function abonnerDiagnosticPush(f: (d: DiagnosticPush) => void): () => void {
  ecouteursDiagnostic.add(f);
  return () => ecouteursDiagnostic.delete(f);
}

const messageErreur = (e: unknown) => {
  const statut = (e as { status?: number })?.status;
  const texte = e instanceof Error ? e.message : String(e);
  return statut ? `HTTP ${statut} — ${texte}` : texte;
};

/* ───────────── modules natifs ───────────── */

/** Build natif (Android/iOS, pas Expo Go) avec le drapeau push. */
const pushNatifDemande = () =>
  PUSH_DEMANDE && (Platform.OS === 'ios' || Platform.OS === 'android') && !estExpoGo();

let moduleMessaging: any | null | undefined;
let erreurChargement: string | null = null;
let moduleNotifications: any | null | undefined;

/**
 * API modulaire de @react-native-firebase/messaging, ou `null`. La présence du
 * module natif n'est plus un PRÉALABLE (un faux négatif désactivait tout le
 * push en silence) : on tente le chargement, et l'échec est expliqué.
 */
export function chargerMessagingPush(): any | null {
  if (!pushNatifDemande()) return null;
  if (moduleMessaging) return moduleMessaging;
  try {
    moduleMessaging = require('@react-native-firebase/messaging');
    erreurChargement = null;
  } catch (e) {
    moduleMessaging = undefined; // nouvel essai possible plus tard
    erreurChargement = `${messageErreur(e)} (module natif ${moduleNatifPresent(...MODULES_NATIFS.firebase) ? 'présent' : 'absent'})`;
    return null;
  }
  return moduleMessaging;
}

/** Push utilisable sur cet appareil (Firebase chargé dans un build natif). */
export function pushPossible(): boolean {
  return Boolean(chargerMessagingPush());
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

/**
 * Autorisation d'afficher des notifications.
 * 1. Android 13+ : `POST_NOTIFICATIONS` demandée EN PREMIER, sans dépendre de
 *    Firebase (avant, un échec Firebase empêchait l'invite de s'afficher) ;
 * 2. Firebase `requestPermission()` (iOS : invite système ; Android : statut).
 */
export async function demanderPermissionPush(): Promise<boolean> {
  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    const resultat = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    if (resultat !== PermissionsAndroid.RESULTS.GRANTED) {
      noter('permission-refusee', resultat === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
        ? 'refusée définitivement : à réactiver dans les réglages Android de l’application'
        : `réponse : ${resultat}`);
      return false;
    }
  }
  const firebase = chargerMessagingPush();
  if (!firebase) {
    noter('firebase-absent', erreurChargement ?? 'module Firebase introuvable dans ce build');
    return false;
  }
  const statut = await firebase.requestPermission(firebase.getMessaging());
  const ok = statut === firebase.AuthorizationStatus.AUTHORIZED || statut === firebase.AuthorizationStatus.PROVISIONAL;
  if (!ok) noter('permission-refusee', `statut Firebase : ${statut}`);
  return ok;
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
let jetonEnregistre: string | null = null;

/**
 * Permission → jeton FCM → `POST /notifications/register-token`. Réutilisable
 * (« Réessayer » dans Paramètres, retour au premier plan). Ne lève jamais.
 */
export async function enregistrerAppareilPush(): Promise<DiagnosticPush> {
  if (!PUSH_DEMANDE) {
    noter('inactif', 'EXPO_PUBLIC_PUSH absent de ce build');
    return diagnostic;
  }
  if (!pushNatifDemande()) {
    noter('non-natif', Platform.OS === 'web' ? 'version web' : 'Expo Go : un build de développement ou un APK est nécessaire');
    return diagnostic;
  }
  noter('en-cours');
  try {
    if (!(await demanderPermissionPush())) return diagnostic;
    const firebase = chargerMessagingPush();
    if (!firebase) {
      noter('firebase-absent', erreurChargement);
      return diagnostic;
    }
    let jeton: string | null = null;
    try {
      jeton = await firebase.getToken(firebase.getMessaging());
    } catch (e) {
      noter('jeton-absent', messageErreur(e));
      return diagnostic;
    }
    if (!jeton) {
      noter('jeton-absent', 'Firebase n’a renvoyé aucun jeton (services Google Play ?)');
      return diagnostic;
    }
    try {
      await enregistrerJetonPush(jeton);
    } catch (e) {
      noter('envoi-echoue', messageErreur(e));
      return diagnostic;
    }
    jetonEnregistre = jeton;
    noter('enregistre', `jeton …${jeton.slice(-6)}`);
  } catch (e) {
    noter('envoi-echoue', messageErreur(e));
  }
  return diagnostic;
}

/**
 * Démarre les notifications pour l'utilisateur connecté. Renvoie la fonction
 * qui retire tous les écouteurs. Ne lève jamais : un échec (hors ligne,
 * permission refusée) laisse l'application intacte et sera réessayé au
 * prochain démarrage ou à la prochaine connexion.
 */
export async function demarrerPush(naviguer: (chemin: string) => void): Promise<() => void> {
  const nettoyages: Array<() => void> = [];
  const ouvrir = (donnees?: DonneesPush | null) => {
    const chemin = cheminPourNotification(donnees);
    if (chemin) naviguer(chemin);
  };

  // 1. Permission (invite système) puis enregistrement du jeton — en premier.
  await enregistrerAppareilPush();

  // Échec (serveur injoignable, permission accordée plus tard dans les
  // réglages…) : nouvel essai à chaque retour au premier plan.
  const reprise = AppState.addEventListener('change', (etat) => {
    if (etat === 'active' && diagnostic.etape !== 'enregistre' && diagnostic.etape !== 'en-cours') {
      void enregistrerAppareilPush();
    }
  });
  nettoyages.push(() => reprise.remove());

  const firebase = chargerMessagingPush();
  if (!firebase) return () => nettoyages.forEach((retirer) => retirer());

  try {
    const messaging = firebase.getMessaging();
    nettoyages.push(
      firebase.onTokenRefresh(messaging, (nouveau: string) => {
        if (nouveau === jetonEnregistre) return;
        void enregistrerJetonPush(nouveau).then(
          () => {
            jetonEnregistre = nouveau;
            noter('enregistre', `jeton renouvelé …${nouveau.slice(-6)}`);
          },
          (e) => noter('envoi-echoue', messageErreur(e)),
        );
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
  } catch (e) {
    console.warn('[push] écouteurs non installés :', messageErreur(e));
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
