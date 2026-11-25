/**
 * Identifiants Firebase Cloud Messaging (compte de service Firebase Admin).
 *
 * Deux sources, par ordre de priorité :
 *   1. variables FCM_PROJECT_ID / FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY
 *      (hébergement sans fichier : Render, Railway, conteneurs…) ;
 *   2. FIREBASE_SERVICE_ACCOUNT_PATH : chemin du fichier JSON téléchargé depuis
 *      la console Firebase (Paramètres du projet → Comptes de service), relatif
 *      à la racine de `backend/` ou absolu.
 *
 * Le fichier est lu UNE seule fois (mémoïsé) : pas de double initialisation.
 * Aucune dépendance `firebase-admin` : l'envoi passe par l'API HTTP v1 de FCM
 * (src/integrations/push.js), signée avec la clé privée de ce compte.
 *
 * SECRET : le fichier JSON est ignoré par Git (`backend/.gitignore`) ; ni la
 * clé ni le contenu du fichier ne sont jamais journalisés.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from './env.js';
import { logger } from '../shared/http/logger.js';

const RACINE_BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * @typedef {{ projectId: string, clientEmail: string, privateKey: string, source: 'variables' | 'fichier' }} IdentifiantsFcm
 */

/** Lit et valide un fichier de compte de service. Lève une erreur SANS contenu du fichier. */
export const lireCompteDeService = (chemin) => {
  const absolu = path.isAbsolute(chemin) ? chemin : path.resolve(RACINE_BACKEND, chemin);
  let brut;
  try {
    brut = fs.readFileSync(absolu, 'utf8');
  } catch {
    throw new Error(`fichier de compte de service introuvable ou illisible : ${absolu}`);
  }
  let json;
  try {
    json = JSON.parse(brut);
  } catch {
    // Message volontairement générique : celui de JSON.parse peut citer un extrait du fichier.
    throw new Error(`fichier de compte de service : JSON invalide (${path.basename(absolu)})`);
  }
  if (json?.type !== 'service_account' || !json.project_id || !json.client_email || !json.private_key) {
    throw new Error(`fichier de compte de service incomplet (${path.basename(absolu)}) : type, project_id, client_email et private_key requis`);
  }
  return { projectId: json.project_id, clientEmail: json.client_email, privateKey: json.private_key, source: 'fichier' };
};

let memo; // undefined = pas encore résolu ; null = aucune source valide

/**
 * Identifiants FCM résolus, ou `null`. Mémoïsés pour la configuration du
 * processus ; une configuration explicite (`cfg`, tests) n'est jamais mémoïsée.
 * @returns {IdentifiantsFcm | null}
 */
export const identifiantsFcm = (cfg = env) => {
  const configurationProcessus = cfg === env;
  if (configurationProcessus && memo !== undefined) return memo;

  let resultat = null;
  if (cfg.FCM_PROJECT_ID && cfg.FCM_CLIENT_EMAIL && cfg.FCM_PRIVATE_KEY) {
    resultat = { projectId: cfg.FCM_PROJECT_ID, clientEmail: cfg.FCM_CLIENT_EMAIL, privateKey: cfg.FCM_PRIVATE_KEY, source: 'variables' };
  } else if (cfg.FIREBASE_SERVICE_ACCOUNT_PATH) {
    try {
      resultat = lireCompteDeService(cfg.FIREBASE_SERVICE_ACCOUNT_PATH);
    } catch (erreur) {
      logger.error(`[firebase] ${erreur.message} — notifications FCM désactivées`);
      resultat = null;
    }
  }
  if (configurationProcessus) memo = resultat;
  return resultat;
};

/** Seam de test : oublie les identifiants mémoïsés. */
export const reinitialiserFirebasePourTests = () => {
  memo = undefined;
};
