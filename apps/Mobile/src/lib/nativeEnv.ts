import Constants, { ExecutionEnvironment } from 'expo-constants';
import { NativeModules, TurboModuleRegistry } from 'react-native';

/**
 * Détection de l'environnement natif, à utiliser AVANT tout `require` d'une
 * bibliothèque native optionnelle (Firebase, LiveKit, CallKeep…).
 *
 * Deux protections :
 * 1. Expo Go : détecté par `expo-constants`. L'ancienne lecture de
 *    `NativeModules.ExponentConstants` renvoie `undefined` avec la Nouvelle
 *    Architecture (défaut d'Expo 58) : Expo Go n'était plus reconnu et Firebase
 *    était chargé → « Native module NativeRNFBTurboApp is not registered ».
 * 2. Module natif réellement présent dans le binaire : couvre aussi un build
 *    de développement produit AVANT l'ajout de la bibliothèque (il faut alors
 *    le reconstruire). `TurboModuleRegistry.get` ne lève pas d'erreur.
 */
export function estExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

/** Au moins un des modules natifs nommés est enregistré dans ce binaire. */
export function moduleNatifPresent(...noms: string[]): boolean {
  return noms.some((nom) => {
    try {
      if (TurboModuleRegistry.get(nom)) return true;
    } catch {
      /* registre indisponible : on regarde l'ancien pont */
    }
    return Boolean((NativeModules as Record<string, unknown>)[nom]);
  });
}

/** Noms des modules natifs des bibliothèques optionnelles. */
export const MODULES_NATIFS = {
  firebase: ['NativeRNFBTurboApp', 'RNFBAppModule'],
  liveKit: ['LivekitReactNativeModule'],
  webRtc: ['LKRNWebRTCModule', 'WebRTCModule'],
  callKeep: ['RNCallKeep'],
  voipPush: ['RNVoipPushNotificationManager'],
} as const;
