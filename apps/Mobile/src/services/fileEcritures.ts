/**
 * File des ÉCRITURES hors ligne — logique PURE (testée sous Node).
 *
 * Une création faite sans réseau (exploitation, parcelle, récolte…) est
 * gardée sur l'appareil avec sa clé d'idempotence, puis rejouée dans l'ordre
 * dès le retour du réseau. Le serveur reconnaît la clé (Idempotency-Key) :
 * un rejeu après une réponse perdue ne crée jamais de doublon.
 */

export interface EcritureEnAttente {
  id: string;
  methode: 'POST' | 'PATCH' | 'PUT';
  url: string;
  corps: unknown;
  cleIdempotence: string;
  /** Libellé affiché (« Parcelle Champ Nord »). */
  libelle: string;
  /** Clés React Query à rafraîchir après l'envoi. */
  invalider: string[][];
  creeLe: number;
  tentatives: number;
  prochainEssai: number;
  /** Refus DÉFINITIF du serveur (validation) : ne sera plus rejouée. */
  refusDefinitif?: boolean;
  erreur?: string | null;
}

export type IssueEnvoi = 'envoyee' | 'reessayer' | 'refusee';

/** Statut HTTP → issue. 0 = réseau. 409 « en cours » et 5xx/429 : on réessaie. */
export function classerReponse(statut: number): IssueEnvoi {
  if (statut >= 200 && statut < 300) return 'envoyee';
  if (statut === 0 || statut === 408 || statut === 409 || statut === 425 || statut === 429 || statut >= 500) return 'reessayer';
  return 'refusee';
}

/** Attente avant le prochain essai : 5 s, 10 s, 20 s… plafonnée à 10 min. */
export const delaiProchainEssai = (tentatives: number) => Math.min(10 * 60_000, 5_000 * 2 ** Math.max(0, tentatives - 1));

/** Écritures prêtes, dans l'ordre de création (FIFO), hors refus définitifs. */
export function pretes(file: readonly EcritureEnAttente[], maintenant: number): EcritureEnAttente[] {
  return file
    .filter((e) => !e.refusDefinitif && e.prochainEssai <= maintenant)
    .sort((a, b) => a.creeLe - b.creeLe);
}

/** Résumé pour l'interface. */
export function resumeFile(file: readonly EcritureEnAttente[]) {
  const refusees = file.filter((e) => e.refusDefinitif);
  return { enAttente: file.length - refusees.length, refusees: refusees.length, total: file.length };
}
