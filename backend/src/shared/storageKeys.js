import { randomUUID } from 'node:crypto';
import { storageKey } from './crypto.js';

/**
 * Clés de stockage des médias — définition UNIQUE (A3).
 *
 * Forme produite par le serveur (`POST /media/upload-url`) et seule forme
 * acceptée ailleurs (pièces jointes de messages) :
 *
 *   <organisation assainie>/<media|documents>/<AAAA-MM>/<uuid v4>.<extension>
 *
 * Avant A3, la messagerie acceptait toute chaîne `[A-Za-z0-9._-/]` commençant
 * par le préfixe de l'organisation : `<orgA>/../<orgB>/documents/x.pdf` passait
 * et était transmise telle quelle à la signature du stockage.
 */
export const CATEGORIES_STOCKAGE = Object.freeze(['media', 'documents']);

const MOTIF_CLE =
  /^(?!\.{1,2}\/)[A-Za-z0-9_-][A-Za-z0-9._-]*\/(media|documents)\/\d{4}-(0[1-9]|1[0-2])\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$/;

/** Préfixe des clés d'une organisation (même assainissement que `storageKey`). */
export const prefixeStockage = (organizationId) => `${storageKey(organizationId)}/`;

/** Vrai si `cle` a exactement la forme produite par le serveur. */
export const estCleStockageConforme = (cle) => typeof cle === 'string' && cle.length <= 500 && MOTIF_CLE.test(cle);

/** Vrai si `cle` est conforme ET appartient à l'organisation donnée. */
export const estCleDeLOrganisation = (cle, organizationId) =>
  estCleStockageConforme(cle) && Boolean(organizationId) && cle.startsWith(prefixeStockage(organizationId));

/** Génère une clé conforme (utilisée par `media.service.js`). */
export const nouvelleCleStockage = (organizationId, categorie, extension, date = new Date()) =>
  storageKey(organizationId, categorie, date.toISOString().slice(0, 7), `${randomUUID()}.${extension}`);
