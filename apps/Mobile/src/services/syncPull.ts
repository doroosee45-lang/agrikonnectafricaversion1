/**
 * Tirage différé des messages — logique PURE (sans import React Native),
 * utilisée par `OfflineSyncEngine` et exécutée telle quelle par les recettes
 * du backend contre la vraie API.
 *
 * OFF-1 : le moteur appelait `POST /chat/sync`, route inexistante (404) : aucun
 * message n'était jamais reçu en différé. La route du backend est
 * `POST /messaging/sync`.
 * OFF-6 : `hasMore` était ignoré (une page de 500 par déclenchement). On enchaîne
 * les pages, en enregistrant le curseur APRÈS l'application de chaque page :
 * une interruption reprend à la page suivante, et une page relivrée est
 * absorbée par la fusion idempotente de `deltaPlan.ts`.
 */
import type { LocalMessage } from '@/db/models';

export const ROUTE_TIRAGE_MESSAGES = '/messaging/sync';

/** Garde-fou : nombre maximal de pages par déclenchement (500 messages par page). */
export const PAGES_MAX_PAR_TIRAGE = 20;

export interface ReponseTirage {
  created: LocalMessage[];
  updated: LocalMessage[];
  deleted: string[];
  serverTimestamp: number;
  hasMore?: boolean;
}

export interface BilanTirage {
  pages: number;
  messages: number;
  complet: boolean;
}

export async function tirerToutesLesPages(options: {
  tirer: (lastPulledAt: number) => Promise<ReponseTirage>;
  appliquer: (page: ReponseTirage) => Promise<void>;
  lireCurseur: () => Promise<number>;
  ecrireCurseur: (curseur: number) => Promise<void>;
  pagesMax?: number;
}): Promise<BilanTirage> {
  const { tirer, appliquer, lireCurseur, ecrireCurseur, pagesMax = PAGES_MAX_PAR_TIRAGE } = options;
  let curseur = await lireCurseur();
  let messages = 0;
  for (let page = 1; page <= pagesMax; page += 1) {
    const reponse = await tirer(curseur);
    await appliquer(reponse);
    messages += (reponse.created?.length ?? 0) + (reponse.updated?.length ?? 0);
    if (reponse.serverTimestamp) {
      curseur = reponse.serverTimestamp;
      await ecrireCurseur(curseur);
    }
    if (!reponse.hasMore) return { pages: page, messages, complet: true };
  }
  return { pages: pagesMax, messages, complet: false };
}
