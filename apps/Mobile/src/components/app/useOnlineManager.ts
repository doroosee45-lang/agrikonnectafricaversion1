import { useSyncExternalStore } from 'react';
import { onlineManager } from '@tanstack/react-query';

/** État réseau suivi par React Query (branché sur NetInfo dans cacheHorsLigne.ts). */
export function useOnlineManager(): boolean {
  return useSyncExternalStore(
    (rappel) => onlineManager.subscribe(rappel),
    () => onlineManager.isOnline(),
    () => true,
  );
}
