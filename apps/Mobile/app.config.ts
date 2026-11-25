import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Configuration Expo = app.json + options natives activées par drapeaux de BUILD.
 *
 * - `EXPO_PUBLIC_PUSH=true` : notifications push Firebase Cloud Messaging
 *   (plugins Firebase, expo-notifications, permission POST_NOTIFICATIONS,
 *   mode d'arrière-plan `remote-notification`).
 * - `EXPO_PUBLIC_NATIVE_CALLS=true` : APPELS AUDIO natifs (WebRTC/LiveKit,
 *   CallKit/ConnectionService) ; inclut aussi les push (sonnerie).
 *
 * Sans drapeau, la configuration est exactement celle d'app.json (Expo Go reste
 * utilisable). Avec un drapeau, il faut un build de développement
 * (`npx expo run:android` ou EAS), pas Expo Go.
 *
 * Aucun secret ici. Les fichiers Firebase (google-services.json,
 * GoogleService-Info.plist) sont ignorés par Git : fournis localement (chemins
 * dans .env) ou par EAS (variables de type fichier).
 */

// Évalué par Node (Expo CLI) : `require` existe ; le projet n'embarque pas les types Node.
declare const require: (id: string) => { existsSync: (chemin: string) => boolean };

/**
 * Premier chemin défini parmi les variables, sinon le fichier par défaut s'il
 * existe à la racine du projet (répertoire courant d'Expo CLI).
 */
const fichierFirebase = (variables: string[], parDefaut: string): string | undefined => {
  for (const nom of variables) {
    if (process.env[nom]) return process.env[nom];
  }
  return require('fs').existsSync(`./${parDefaut}`) ? `./${parDefaut}` : undefined;
};

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  const appels = process.env.EXPO_PUBLIC_NATIVE_CALLS === 'true';
  const push = appels || process.env.EXPO_PUBLIC_PUSH === 'true';
  if (!push) return base;

  const micro = 'AgriKonnect utilise le micro uniquement pendant les appels audio que vous passez ou acceptez.';
  const permissionsPush = ['android.permission.POST_NOTIFICATIONS', 'android.permission.WAKE_LOCK'];
  const permissionsAppels = [
    'android.permission.RECORD_AUDIO',
    'android.permission.MODIFY_AUDIO_SETTINGS',
    'android.permission.BLUETOOTH_CONNECT',
    'android.permission.USE_FULL_SCREEN_INTENT',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_MICROPHONE',
    'android.permission.FOREGROUND_SERVICE_PHONE_CALL',
    'android.permission.MANAGE_OWN_CALLS',
    'android.permission.READ_PHONE_STATE',
    'android.permission.CALL_PHONE',
  ];

  return {
    ...base,
    ios: {
      ...base.ios,
      // GOOGLE_SERVICE_INFO_PLIST (.env local) ; GOOGLE_SERVICES_PLIST (nom historique / EAS).
      googleServicesFile: fichierFirebase(['GOOGLE_SERVICE_INFO_PLIST', 'GOOGLE_SERVICES_PLIST'], 'GoogleService-Info.plist'),
      entitlements: {
        ...(base.ios?.entitlements ?? {}),
        'aps-environment': process.env.APNS_ENVIRONMENT === 'production' ? 'production' : 'development',
      },
      infoPlist: {
        ...(base.ios?.infoPlist ?? {}),
        ...(appels ? { NSMicrophoneUsageDescription: micro } : {}),
        UIBackgroundModes: appels ? ['audio', 'voip', 'remote-notification'] : ['remote-notification'],
      },
    },
    android: {
      ...base.android,
      googleServicesFile: fichierFirebase(['GOOGLE_SERVICES_JSON'], 'google-services.json'),
      permissions: Array.from(
        new Set([...(base.android?.permissions ?? []), ...permissionsPush, ...(appels ? permissionsAppels : [])]),
      ),
    },
    plugins: [
      ...(base.plugins ?? []),
      'expo-dev-client',
      '@react-native-firebase/app',
      '@react-native-firebase/messaging',
      // React Native Firebase exige des frameworks statiques sur iOS.
      // HTTP en clair autorisé UNIQUEMENT si l'API configurée est en http://
      // (build de test vers un serveur local) ; jamais pour une API https.
      [
        'expo-build-properties',
        {
          ios: { useFrameworks: 'static' },
          android: { usesCleartextTraffic: (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').startsWith('http://') },
        },
      ],
      ['expo-notifications', { color: '#174D35', icon: './assets/android-icon-monochrome.png' }],
      ...(appels
        ? [
            '@livekit/react-native-expo-plugin',
            ['@config-plugins/react-native-webrtc', { microphonePermission: micro }],
            '@config-plugins/react-native-callkeep',
          ]
        : []),
    ] as ExpoConfig['plugins'],
  };
};
