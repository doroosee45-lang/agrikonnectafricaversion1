/**
 * Contenu des messages de l'écran de discussion — logique PURE (testée sous Node).
 *
 * Sans migration du serveur (pas de colonne `type` ni `metadata`), chaque
 * message métier est un texte LISIBLE partout (Web, notifications, anciens
 * clients) que le Mobile reconnaît pour afficher une carte :
 *
 *   📍 Position partagée (±12 m)
 *   https://maps.google.com/?q=-4.32170,15.31250
 *
 *   🌱 Parcelle : Champ Nord — 2,50 ha (Maïs)
 *   https://maps.google.com/?q=-4.32170,15.31250&ak_plot=<identifiant>
 *
 *   🎤 Note vocale (0:12)        📷 Photo        📄 rapport.pdf
 *
 * Le type d'un média vient de l'extension de sa pièce jointe (clé de stockage).
 */

export type TypeAffichage = 'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT' | 'LOCATION' | 'PARCEL';

export interface Position {
  lat: number;
  lng: number;
  precisionM?: number | null;
}

export interface Parcelle {
  plotId: string;
  nom: string;
  surfaceHa: number | null;
  culture?: string | null;
  lat: number;
  lng: number;
}

const EXT_IMAGE = /\.(jpe?g|png|webp|heic)(\?|$)/i;
const EXT_AUDIO = /\.(m4a|mp3|ogg|wav|webm|aac|caf)(\?|$)/i;
const EXT_DOCUMENT = /\.(pdf|mp4)(\?|$)/i;
const URL_CARTE = /https:\/\/maps\.google\.com\/\?q=(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:&ak_plot=([A-Za-z0-9_-]{6,64}))?/;

const arrondi = (n: number) => Math.round(n * 1e5) / 1e5;
const coordonneesValides = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

export const urlCarte = (lat: number, lng: number) => `https://maps.google.com/?q=${arrondi(lat).toFixed(5)},${arrondi(lng).toFixed(5)}`;

/** Durée « m:ss » (notes vocales, appels courts). */
export function formatDuree(totalSecondes: number): string {
  const s = Math.max(0, Math.round(totalSecondes));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** Surface « 2,50 ha » (séparateur décimal français). */
export const formatSurface = (ha: number | null | undefined) =>
  ha == null || !Number.isFinite(ha) ? null : `${ha.toFixed(2).replace('.', ',')} ha`;

/* ─────────────── corps envoyés ─────────────── */

export function corpsPosition(p: Position): string {
  if (!coordonneesValides(p.lat, p.lng)) throw new Error('Coordonnées invalides');
  const precision = p.precisionM && p.precisionM > 0 ? ` (±${Math.round(p.precisionM)} m)` : '';
  return `📍 Position partagée${precision}\n${urlCarte(p.lat, p.lng)}`;
}

export function corpsParcelle(p: Parcelle): string {
  if (!coordonneesValides(p.lat, p.lng)) throw new Error('Coordonnées invalides');
  const surface = formatSurface(p.surfaceHa);
  const details = [surface, p.culture ? `(${p.culture})` : null].filter(Boolean).join(' ');
  return `🌱 Parcelle : ${p.nom.trim()}${details ? ` — ${details}` : ''}\n${urlCarte(p.lat, p.lng)}&ak_plot=${p.plotId}`;
}

export const corpsNoteVocale = (dureeMs: number) => `🎤 Note vocale (${formatDuree(dureeMs / 1000)})`;
export const corpsPhoto = () => '📷 Photo';
export const corpsDocument = (nom: string) => `📄 ${nom.trim() || 'Document'}`;

/* ─────────────── lecture ─────────────── */

export function lirePosition(contenu: string): Position | null {
  if (!contenu.startsWith('📍')) return null;
  const m = URL_CARTE.exec(contenu);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!coordonneesValides(lat, lng)) return null;
  const precision = /\(±(\d+) m\)/.exec(contenu);
  return { lat, lng, precisionM: precision ? Number(precision[1]) : null };
}

export function lireParcelle(contenu: string): Parcelle | null {
  if (!contenu.startsWith('🌱')) return null;
  const m = URL_CARTE.exec(contenu);
  if (!m || !m[3]) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!coordonneesValides(lat, lng)) return null;
  const entete = contenu.split('\n')[0].replace(/^🌱 Parcelle : /, '');
  const [nom, details = ''] = entete.split(' — ');
  const surface = /(\d+(?:,\d+)?) ha/.exec(details);
  const culture = /\(([^)]+)\)/.exec(details);
  return {
    plotId: m[3],
    nom: nom.trim(),
    surfaceHa: surface ? Number(surface[1].replace(',', '.')) : null,
    culture: culture ? culture[1] : null,
    lat,
    lng,
  };
}

/** Durée d'une note vocale lue dans son texte (secondes), sinon null. */
export function lireDureeNoteVocale(contenu: string): number | null {
  const m = /^🎤 Note vocale \((?:(\d+):)?(\d+):(\d{2})\)/.exec(contenu);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Type d'affichage d'un message : pièce jointe d'abord, puis contenu métier. */
export function typeAffichage(m: { content: string; attachments?: string[] | null; local_media_uri?: string | null; type?: string | null }): TypeAffichage {
  const piece = m.attachments?.[0] ?? m.local_media_uri ?? null;
  if (piece) {
    if (EXT_IMAGE.test(piece)) return 'IMAGE';
    if (EXT_AUDIO.test(piece)) return 'AUDIO';
    if (EXT_DOCUMENT.test(piece)) return 'DOCUMENT';
  }
  if (m.type === 'AUDIO' || m.type === 'IMAGE' || m.type === 'DOCUMENT') return m.type;
  if (lireParcelle(m.content)) return 'PARCEL';
  if (lirePosition(m.content)) return 'LOCATION';
  return 'TEXT';
}

/** Type MIME accepté par le serveur pour un fichier local (null = refusé). */
export function mimeDepuisNom(nom: string): string | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(nom)?.[1]?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'pdf':
      return 'application/pdf';
    case 'm4a':
      return 'audio/mp4';
    case 'mp3':
      return 'audio/mpeg';
    case 'ogg':
      return 'audio/ogg';
    case 'wav':
      return 'audio/wav';
    case 'webm':
      return 'audio/webm';
    case 'mp4':
      return 'video/mp4';
    default:
      return null;
  }
}

/** Types MIME acceptés par le serveur (backend/src/modules/media/media.schema.js). */
export const MIMES_ACCEPTES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

/** Filtres du sélecteur de fichiers natif (Android : types MIME ; iOS : convertis en UTI). */
export const FILTRES_SELECTEUR = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'audio/*'];

/** Libellé lisible des formats acceptés (messages d'erreur). */
export const FORMATS_LISIBLES = 'PDF, JPEG, PNG, WebP, MP4, M4A, MP3, OGG, WAV';

/**
 * Fichier choisi dans le sélecteur natif → type MIME accepté, nom avec la
 * bonne extension et genre d'envoi. Le type annoncé par le système est
 * prioritaire (les noms Android « content:// » n'ont pas toujours d'extension) ;
 * l'extension sert de repli. `null` = format refusé par le serveur.
 */
export function preparerFichier(nom: string | null | undefined, mimeSysteme: string | null | undefined):
  | { nom: string; mime: string; genre: 'IMAGE' | 'AUDIO' | 'DOCUMENT' }
  | null {
  const brut = (nom ?? '').trim() || 'fichier';
  const annonce = (mimeSysteme ?? '').toLowerCase();
  const mime = MIMES_ACCEPTES[annonce] ? annonce : mimeDepuisNom(brut);
  if (!mime || !MIMES_ACCEPTES[mime]) return null;
  const ext = MIMES_ACCEPTES[mime];
  const nomFinal = brut.toLowerCase().endsWith(`.${ext}`) ? brut : `${brut.replace(/\.[A-Za-z0-9]{1,5}$/, '')}.${ext}`;
  const genre = mime.startsWith('image/') ? 'IMAGE' : mime.startsWith('audio/') ? 'AUDIO' : 'DOCUMENT';
  return { nom: nomFinal, mime, genre };
}

/** Plafond serveur des médias (NFR-04). */
export const TAILLE_MAX_MEDIA = 5 * 1024 * 1024;
