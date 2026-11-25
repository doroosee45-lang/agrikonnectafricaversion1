import { useEffect } from 'react';
import { useRouter } from 'expo-router';

import { demarrerPush } from '@/services/pushNotifications';
import { useAuthStore } from '@/store/auth';

/**
 * Notifications push FCM pour l'utilisateur CONNECTÉ : permission, jeton
 * envoyé au serveur (et à chaque renouvellement), bannière au premier plan,
 * ouverture de l'écran ciblé au clic. Monté une fois à la racine
 * (`app/_layout.tsx`). Sans effet hors build natif avec `EXPO_PUBLIC_PUSH=true`.
 */
export function usePushNotifications(): void {
  const status = useAuthStore((state) => state.status);
  const router = useRouter();

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
  }, [status, router]);
}
