import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';

import { AppErrorBoundary } from '@/components/ui/AppErrorBoundary';
import { useI18nStore } from '@/i18n';
import { getUserInitialRoute } from '@/lib/redirects';
import { COLORS, DARK } from '@/theme/colors';
import { useAppFonts } from '@/theme/typography';
import { queryClient } from '@/services/query';
import { realtime } from '@/services/realtime';
import { offlineSyncEngine } from '@/services/OfflineSyncEngine';
import { brancherReseau, persisterCache, restaurerCache } from '@/services/cacheHorsLigne';
import { useAuthStore } from '@/store/auth';
import { useLocaleSync } from '@/hooks/useLocaleSync';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { CallOverlay } from '@/features/calls/CallOverlay';
import { RolePersistentNav } from '@/components/app/RolePersistentNav';

// L'écran de démarrage reste affiché jusqu'à ce que les polices soient prêtes :
// sans cela le premier rendu s'affiche en police système puis saute.
void SplashScreen.preventAutoHideAsync();

/**
 * Racine de l'application.
 *
 * Ordre de montage imposé :
 * 1. `GestureHandlerRootView` (gestes Reanimated) ;
 * 2. `SafeAreaProvider` (insets) ;
 * 3. `QueryClientProvider` (état serveur) ;
 * 4. hydratation i18n + session, puis masquage du splash.
 *
 * La protection de route vit ici : tant que la session n'est pas résolue, on
 * n'empile aucun écran métier (évite un flash d'écran « connexion »).
 */
export default function RootLayout() {
  const fontsLoaded = useAppFonts();
  const hydrateLocale = useI18nStore((state) => state.hydrate);
  const localeHydrated = useI18nStore((state) => state.hydrated);
  const initAuth = useAuthStore((state) => state.init);
  const status = useAuthStore((state) => state.status);
  // I18N — langue d'interface reportée sur le profil (notifications, e-mails).
  useLocaleSync();

  useEffect(() => {
    void hydrateLocale();
    void initAuth();
  }, [hydrateLocale, initAuth]);

  // Hors ligne : réseau réel (NetInfo) pour React Query, cache restauré puis
  // enregistré sur l'appareil (tableaux de bord et listes consultables sans réseau).
  useEffect(() => {
    const debrancher = brancherReseau();
    let arreter: (() => void) | undefined;
    void restaurerCache(queryClient).finally(() => {
      arreter = persisterCache(queryClient);
    });
    return () => {
      debrancher();
      arreter?.();
    };
  }, []);

  // Le temps réel n'a de sens qu'avec une session (le serveur refuse l'anonyme).
  useEffect(() => {
    if (status === 'authenticated') realtime.connect();
    else realtime.disconnect();
  }, [status]);

  // Synchronisation hors ligne : le moteur n'était JAMAIS démarré (aucun appel à
  // start()) → pas d'écoute du réseau, pas de renvoi automatique au retour de
  // la connexion. Démarré avec la session, arrêté à la déconnexion.
  useEffect(() => {
    if (status === 'authenticated') offlineSyncEngine.start();
    else if (status === 'anonymous') offlineSyncEngine.stop();
  }, [status]);

  // La langue est relue avant le premier écran : pas de bascule visible fr → en.
  const ready = fontsLoaded && localeHydrated && status !== 'booting';

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) {
    return <View style={styles.boot} />;
  }

  return (
    <AppErrorBoundary>
      <GestureHandlerRootView style={styles.root}>
      {/* Clavier : insets réels en mode edge-to-edge (Android 15+/Expo 58), où la fenêtre n'est plus redimensionnée. */}
      <KeyboardProvider>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          <SessionGate />
          <PushNotificationsGate />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: COLORS.naturalWhite },
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen name="auth" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="farmer" options={{ animation: 'slide_from_right' }} />
          </Stack>
          <RolePersistentNav />
          <CallOverlay />
        </QueryClientProvider>
      </SafeAreaProvider>
      </KeyboardProvider>
      </GestureHandlerRootView>
    </AppErrorBoundary>
  );
}

/**
 * Redirection de session.
 *
 * Les espaces métier (producteur, agent, admin, investissement…) exigent une
 * session : on renvoie vers la connexion en conservant la cible demandée dans
 * `next`. Une session déjà ouverte sur `/auth` rejoint sa destination par rôle.
 */
function SessionGate() {
  const segments = useSegments();
  const router = useRouter();
  const status = useAuthStore((state) => state.status);

  useEffect(() => {
    if (status === 'booting') return;

    const root = segments[0];
    const protectedRoots = [
      'farmer',
      'agent',
      'admin',
      'reviewer',
      'organization',
      'developers',
      'investment',
      'international',
      'ai',
      'messages',
      'notifications',
      'settings',
      'professional',
      'requests',
      'ventes',
    ];
    const inProtectedGroup = typeof root === 'string' && protectedRoots.includes(root);

    if (inProtectedGroup && status === 'anonymous') {
      router.replace({ pathname: '/auth/login', params: { next: `/${segments.join('/')}` } });
    }
    if (root === 'auth' && status === 'authenticated') {
      const current = useAuthStore.getState();
      if (current.user) {
        const destination = getUserInitialRoute({
          user: current.user,
          permissions: current.permissions,
          completeness: current.completeness?.criteria ?? null,
        }).route;
        router.replace(destination as never);
      }
    }
  }, [segments, status, router]);

  return null;
}

/** Notifications push FCM : monté dans l'arbre du routeur (navigation au clic). */
function PushNotificationsGate() {
  usePushNotifications();
  return null;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  boot: { flex: 1, backgroundColor: DARK.bg },
});
