/**
 * Fil de l'écran de discussion — logique PURE (testée sous Node).
 *
 * Produit la liste pour une `FlatList` INVERSÉE : l'élément 0 est en BAS de
 * l'écran (le plus récent). Un séparateur de jour est donc placé APRÈS le plus
 * ancien élément du jour dans le tableau, pour s'afficher AU-DESSUS du jour.
 * Les appels terminés (historique serveur) sont intercalés à leur date.
 */

export type EtatLivraison = 'PENDING' | 'FAILED' | 'SENT' | 'DELIVERED' | 'READ';

/** Champs utiles d'un message local (sous-ensemble de LocalMessage). */
export interface MessageFil {
  local_temp_id: string;
  server_id: string | null;
  sender_id: string;
  content: string;
  attachments: string[];
  local_media_uri: string | null;
  read_by: string[];
  sync_status: 'PENDING' | 'UPLOADING' | 'SENT' | 'FAILED';
  type?: string | null;
  created_at: number;
}

export interface AppelFil {
  id: string;
  status: string; // ENDED | MISSED | DECLINED | CANCELLED
  outgoing: boolean;
  createdAt: string;
  durationSec: number;
}

export type ElementFil =
  | { kind: 'jour'; key: string; libelle: string }
  | { kind: 'message'; key: string; message: MessageFil; mien: boolean; etat: EtatLivraison; suiteDuPrecedent: boolean; heure: string }
  | { kind: 'appel'; key: string; appel: AppelFil; heure: string };

/** Regroupement visuel : même expéditeur, à moins de 2 minutes. */
const FENETRE_GROUPE_MS = 2 * 60 * 1000;

const cleJour = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function libelleJour(t: number, maintenant: number, locale: 'fr' | 'en' = 'fr'): string {
  const jour = cleJour(t);
  if (jour === cleJour(maintenant)) return locale === 'fr' ? "Aujourd'hui" : 'Today';
  const hier = new Date(maintenant);
  hier.setDate(hier.getDate() - 1);
  if (jour === cleJour(hier.getTime())) return locale === 'fr' ? 'Hier' : 'Yesterday';
  const d = new Date(t);
  const memeAnnee = d.getFullYear() === new Date(maintenant).getFullYear();
  return d.toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    weekday: memeAnnee ? 'long' : undefined,
    day: 'numeric',
    month: 'long',
    year: memeAnnee ? undefined : 'numeric',
  });
}

export const heureCourte = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * État des coches d'un message ENVOYÉ par moi :
 * en attente (horloge) · échec · envoyé ✓ · reçu ✓✓ · lu ✓✓ (vert).
 */
export function etatLivraison(m: MessageFil, moi: string, recus: ReadonlySet<string>): EtatLivraison {
  if (m.sync_status === 'FAILED') return 'FAILED';
  if (m.sync_status !== 'SENT') return 'PENDING';
  if (m.read_by.some((u) => u !== moi)) return 'READ';
  if (m.server_id && recus.has(m.server_id)) return 'DELIVERED';
  return 'SENT';
}

/**
 * @param messages messages locaux (ordre quelconque)
 * @param appels   appels terminés de la conversation
 * @returns éléments du plus RÉCENT au plus ancien (FlatList inversée)
 */
export function construireFil(
  messages: readonly MessageFil[],
  appels: readonly AppelFil[],
  { moi, maintenant, recus = new Set<string>(), locale = 'fr' }: { moi: string; maintenant: number; recus?: ReadonlySet<string>; locale?: 'fr' | 'en' },
): ElementFil[] {
  type Brut = { t: number; cle: string; m?: MessageFil; a?: AppelFil };
  const bruts: Brut[] = [
    ...messages.map((m) => ({ t: m.created_at, cle: m.local_temp_id, m })),
    ...appels.map((a) => ({ t: Date.parse(a.createdAt), cle: `appel-${a.id}`, a })),
  ].filter((b) => Number.isFinite(b.t));
  // Ordre stable : date, puis clé (un message en attente ne « saute » pas en passant à envoyé).
  bruts.sort((x, y) => x.t - y.t || (x.cle < y.cle ? -1 : x.cle > y.cle ? 1 : 0));

  const croissant: ElementFil[] = [];
  let precedent: Brut | null = null;
  for (const b of bruts) {
    if (!precedent || cleJour(precedent.t) !== cleJour(b.t)) {
      croissant.push({ kind: 'jour', key: `jour-${cleJour(b.t)}`, libelle: libelleJour(b.t, maintenant, locale) });
    }
    if (b.m) {
      const suite =
        Boolean(precedent?.m) &&
        precedent!.m!.sender_id === b.m.sender_id &&
        b.t - precedent!.t < FENETRE_GROUPE_MS &&
        cleJour(precedent!.t) === cleJour(b.t);
      croissant.push({
        kind: 'message',
        key: b.cle,
        message: b.m,
        mien: b.m.sender_id === moi,
        etat: etatLivraison(b.m, moi, recus),
        suiteDuPrecedent: suite,
        heure: heureCourte(b.t),
      });
    } else if (b.a) {
      croissant.push({ kind: 'appel', key: b.cle, appel: b.a, heure: heureCourte(b.t) });
    }
    precedent = b;
  }
  return croissant.reverse();
}

/** Messages reçus (pas les miens) dont l'identifiant serveur est connu : à acquitter. */
export const aAcquitter = (messages: readonly MessageFil[], moi: string): string[] =>
  messages.filter((m) => m.sender_id !== moi && m.server_id).map((m) => m.server_id as string);
