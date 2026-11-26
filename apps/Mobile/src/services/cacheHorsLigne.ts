import NetInfo from '@react-native-community/netinfo';
import { dehydrate, hydrate, onlineManager, type QueryClient } from '@tanstack/react-query';

import { stockageLocal } from './stockageLocal';

/**
 * Consultation HORS LIGNE : le cache React Query (tableaux de bord, listes,
 * fiches) est enregistré sur l'appareil et restauré au démarrage. Sans réseau,
 * l'application affiche les dernières données connues au lieu d'un écran vide.
 *
 * - `onlineManager` suit le réseau réel (NetInfo) : hors ligne, les requêtes
 *   sont MISES EN PAUSE (données en cache conservées) au lieu d'échouer en
 *   « erreur réseau » qui masquait les données ;
 * - le cache est effacé à la déconnexion (un autre compte sur le même
 *   téléphone ne voit rien) ;
 * - données de plus de 7 jours ignorées.
 */

const CLE = 'ak.cache-requetes.v1';
const AGE_MAX_MS = 7 * 24 * 3600 * 1000;
/** Requêtes jamais conservées (temps réel, éphémères). */
const EXCLUES = new Set(['calls', 'presence', 'realtime']);

export function brancherReseau(): () => void {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((etat) => setOnline(Boolean(etat.isConnected) && etat.isInternetReachable !== false)),
  );
  return () => onlineManager.setEventListener(() => () => undefined);
}

export async function restaurerCache(client: QueryClient): Promise<void> {
  try {
    const brut = await stockageLocal().getItem(CLE);
    if (!brut) return;
    const { enregistreLe, etat } = JSON.parse(brut) as { enregistreLe: number; etat: unknown };
    if (!etat || Date.now() - enregistreLe > AGE_MAX_MS) return;
    hydrate(client, etat as Parameters<typeof hydrate>[1]);
  } catch (erreur) {
    console.warn('[cache] restauration impossible :', erreur instanceof Error ? erreur.message : erreur);
  }
}

/** Enregistre le cache à chaque changement (regroupé toutes les 2 s). Renvoie le désabonnement. */
export function persisterCache(client: QueryClient): () => void {
  let minuterie: ReturnType<typeof setTimeout> | null = null;
  const enregistrer = () => {
    minuterie = null;
    const etat = dehydrate(client, {
      shouldDehydrateQuery: (q) =>
        q.state.status === 'success' && !EXCLUES.has(String(q.queryKey[0])),
    });
    void stockageLocal()
      .setItem(CLE, JSON.stringify({ enregistreLe: Date.now(), etat }))
      .catch(() => undefined);
  };
  const desabonner = client.getQueryCache().subscribe((evenement) => {
    if (evenement.type !== 'updated' && evenement.type !== 'removed') return;
    if (!minuterie) minuterie = setTimeout(enregistrer, 2000);
  });
  return () => {
    desabonner();
    if (minuterie) clearTimeout(minuterie);
  };
}

/** Déconnexion : plus aucune donnée du compte sur l'appareil. */
export async function effacerCacheHorsLigne(client: QueryClient): Promise<void> {
  client.clear();
  await stockageLocal().removeItem(CLE).catch(() => undefined);
}
