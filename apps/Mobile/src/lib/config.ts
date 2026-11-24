import { Platform } from 'react-native';

/**
 * Ordre de priorité : variable d'environnement EXPO_PUBLIC_* (build CI),
 * puis repli local. Les métadonnées sont fixées ici afin que l'application
 * fonctionne aussi dans une version d'Expo Go sans `expo-constants`.
 */
function pick(envValue: string | undefined, fallback: string): string {
  return envValue?.trim() || fallback;
}

export const API_BASE_URL = pick(
  process.env.EXPO_PUBLIC_API_BASE_URL,
  'http://localhost:4000/api/v1',
);

export const REALTIME_URL = pick(
  process.env.EXPO_PUBLIC_REALTIME_URL,
  API_BASE_URL.replace(/\/api\/v1\/?$/, ''),
);

export const IS_WEB = Platform.OS === 'web';
export const IS_IOS = Platform.OS === 'ios';
export const IS_ANDROID = Platform.OS === 'android';

export const APP = {
  name: 'AGRIKONNECT AFRICA',
  version: '1.0.0',
  scheme: 'agrikonnect',
  slug: 'agrikonnect-africa',
} as const;

/** Les médias arrivent en URL signées (300 s) ; les chemins relatifs sont rebasés ici. */
export function resolveMediaUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;
  const origin = API_BASE_URL.replace(/\/api\/v1\/?$/, '');
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** Délais réseau alignés sur le contrat backend (geoai 20 s, reste 15 s). */
export const TIMEOUTS = {
  request: 15_000,
  geospatial: 20_000,
  upload: 60_000,
} as const;
