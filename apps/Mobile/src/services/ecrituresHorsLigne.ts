import { onlineManager } from '@tanstack/react-query';

import { ulid } from '@/lib/ulid';
import { api } from '@/services/api/http';
import { RequestError } from '@/services/api/types';
import { queryClient } from '@/services/query';

import { classerReponse, delaiProchainEssai, pretes, resumeFile, type EcritureEnAttente } from './fileEcritures';
import { stockageLocal } from './stockageLocal';

/**
 * Écritures métier HORS LIGNE (exploitations, parcelles, récoltes…).
 *
 * `ecrireOuMettreEnFile` envoie tout de suite si le réseau est là ; sans réseau
 * (ou si la requête échoue faute de réseau), l'écriture est gardée sur
 * l'appareil avec sa clé d'idempotence et rejouée automatiquement au retour du
 * réseau (`rejouerEcritures`, appelé par le moteur de synchronisation).
 * La messagerie a sa propre file (OfflineSyncEngine) : inchangée.
 */

/** Message affiché quand une saisie part en file d'attente. */
export const ENREGISTRE_HORS_LIGNE =
  'Enregistré sur le téléphone (hors ligne). Envoi automatique dès le retour du réseau.';

const CLE = 'ak.ecritures-hors-ligne.v1';
const ecouteurs = new Set<(file: EcritureEnAttente[]) => void>();
let cache: EcritureEnAttente[] | null = null;
let rejeuEnCours = false;

async function lire(): Promise<EcritureEnAttente[]> {
  if (cache) return cache;
  try {
    const brut = await stockageLocal().getItem(CLE);
    cache = brut ? (JSON.parse(brut) as EcritureEnAttente[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function ecrire(file: EcritureEnAttente[]): Promise<void> {
  cache = file;
  await stockageLocal().setItem(CLE, JSON.stringify(file));
  ecouteurs.forEach((f) => f(file));
}

export const listerEcritures = () => lire();
export function abonnerEcritures(f: (file: EcritureEnAttente[]) => void): () => void {
  ecouteurs.add(f);
  void lire().then(f);
  return () => ecouteurs.delete(f);
}
export { resumeFile };

export async function supprimerEcriture(id: string): Promise<void> {
  await ecrire((await lire()).filter((e) => e.id !== id));
}

/** Vider la file (déconnexion : les écritures appartiennent au compte). */
export async function viderEcritures(): Promise<void> {
  await ecrire([]);
}

async function envoyer<T>(e: Pick<EcritureEnAttente, 'methode' | 'url' | 'corps' | 'cleIdempotence'>): Promise<T> {
  const options = { headers: { 'Idempotency-Key': e.cleIdempotence } };
  const r =
    e.methode === 'POST'
      ? await api.post<T>(e.url, e.corps, options)
      : e.methode === 'PATCH'
        ? await api.patch<T>(e.url, e.corps, options)
        : await api.put<T>(e.url, e.corps, options);
  return r.data;
}

const statutDe = (erreur: unknown) => (erreur instanceof RequestError ? erreur.status : 0);

export type ResultatEcriture<T> = { enFile: false; data: T } | { enFile: true; libelle: string };

/**
 * Écrit maintenant, ou met en file si le réseau manque. Une erreur métier
 * (validation, droits) remonte normalement au formulaire.
 */
export async function ecrireOuMettreEnFile<T>(demande: {
  methode: EcritureEnAttente['methode'];
  url: string;
  corps: unknown;
  libelle: string;
  invalider: string[][];
}): Promise<ResultatEcriture<T>> {
  const cleIdempotence = ulid();
  const mettreEnFile = async () => {
    const maintenant = Date.now();
    await ecrire([
      ...(await lire()),
      { id: ulid(), ...demande, cleIdempotence, creeLe: maintenant, tentatives: 0, prochainEssai: maintenant, erreur: null },
    ]);
    return { enFile: true as const, libelle: demande.libelle };
  };
  if (!onlineManager.isOnline()) return mettreEnFile();
  try {
    const data = await envoyer<T>({ ...demande, cleIdempotence });
    demande.invalider.forEach((queryKey) => void queryClient.invalidateQueries({ queryKey }));
    return { enFile: false, data };
  } catch (erreur) {
    // Réseau tombé pendant l'envoi : même clé → le serveur dédoublonne au rejeu.
    if (statutDe(erreur) === 0) return mettreEnFile();
    throw erreur;
  }
}

/** Rejoue les écritures en attente (FIFO). Appelé au retour du réseau et au premier plan. */
export async function rejouerEcritures(): Promise<void> {
  if (rejeuEnCours || !onlineManager.isOnline()) return;
  rejeuEnCours = true;
  try {
    for (const e of pretes(await lire(), Date.now())) {
      let issue: 'envoyee' | 'reessayer' | 'refusee';
      let message: string | null = null;
      try {
        await envoyer(e);
        issue = 'envoyee';
      } catch (erreur) {
        issue = classerReponse(statutDe(erreur));
        message = erreur instanceof Error ? erreur.message : String(erreur);
      }
      const file = await lire();
      if (issue === 'envoyee') {
        await ecrire(file.filter((x) => x.id !== e.id));
        e.invalider.forEach((queryKey) => void queryClient.invalidateQueries({ queryKey }));
        continue;
      }
      await ecrire(
        file.map((x) =>
          x.id === e.id
            ? {
                ...x,
                tentatives: x.tentatives + 1,
                prochainEssai: Date.now() + delaiProchainEssai(x.tentatives + 1),
                refusDefinitif: issue === 'refusee',
                erreur: message,
              }
            : x,
        ),
      );
      if (issue === 'reessayer') break; // réseau instable : on garde l'ordre, on reprendra plus tard
    }
  } finally {
    rejeuEnCours = false;
  }
}
