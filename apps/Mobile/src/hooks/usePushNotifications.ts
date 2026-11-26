import { useEffect } from 'react';
import { router } from 'expo-router';

import { demarrerPush } from '@/services/pushNotifications';
import { useAuthStore } from '@/store/auth';

/**
 * Notifications push FCM pour l'utilisateur CONNECTÉ.
 *
 * Se déclenche à CHAQUE passage à « authentifié » : ouverture avec une session
 * existante, ou connexion alors que l'application était déjà ouverte. Ordre :
 * invite système POST_NOTIFICATIONS (Android 13+) → `requestPermission()`
 * Firebase → jeton → `POST /notifications/register-token` ; puis écouteurs
 * (premier plan, clic). Nouvel essai au retour au premier plan en cas d'échec.
 * L'état réel est affiché dans Paramètres → Notifications.
 *
 * Dépend UNIQUEMENT du statut de session (le `router` d'expo-router est un
 * singleton) : l'effet ne se relance pas à chaque rendu.
 */
export function usePushNotifications(): void {
  const status = useAuthStore((state) => state.status);

  useEffect(() => {
    if (status !== 'authenticated') return undefined;
    let annule = false;
    let nettoyer: (() => void) | undefined;
    void demarrerPush((chemin) => router.push(chemin as never)).then((retirer) => {
      if (annule) retirer();
      else nettoyer = retirer;
    });
    return () => {
      annule = true;
      nettoyer?.();
    };
  }, [status]);
}
