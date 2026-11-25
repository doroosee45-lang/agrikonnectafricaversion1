/**
 * Exigences CDC couvertes : SEC-12.
 *
 * Chaque identifiant renvoie à la règle appliquée dans ce fichier ; la preuve
 * exécutable correspondante est référencée dans `tests/` (voir docs/TRACEABILITY.md).
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { success } from '../shared/http/response.js';
import { translateMessage } from '../shared/i18n/index.js';
import { ApiError } from '../shared/errors/ApiError.js';
import { logger } from '../shared/http/logger.js';

/**
 * Idempotence des créations sensibles (CDC §13.2) :
 * commandes, mouvements de stock, synchronisation.
 *
 * Le client envoie `Idempotency-Key: <uuid>`. Si la clé a déjà produit une
 * réponse, on la rejoue telle quelle au lieu de créer un doublon.
 */
/** M-01 — fonction pure (testée) : clé stockée, cloisonnée par utilisateur. */
export const cleIdempotence = (userId, cleClient) => `${userId ?? 'anonyme'}:${String(cleClient)}`;

/**
 * @param {string} scope
 * @param {{ facultatif?: boolean }} [options]
 *   `facultatif: true` — sans en-tête, la requête passe inchangée ; avec
 *   en-tête, la règle s'applique entièrement. Utilisé pour les créations V1
 *   (exploitations, parcelles, productions) : le mobile envoie la clé pour ne
 *   pas dupliquer une création renvoyée après une coupure réseau, le Web ne
 *   l'envoie pas et ne doit pas recevoir de 400.
 */
export const idempotency = (scope, { facultatif = false } = {}) => async (req, res, next) => {
  const key = req.headers['idempotency-key'];

  if (facultatif && (key === undefined || key === '')) return next();

  if (!key || String(key).length < 8) {
    return next(
      ApiError.badRequest('En-tête Idempotency-Key requis pour cette opération sensible'),
    );
  }

  /*
   * M-01 — la clé est rangée PAR UTILISATEUR (`<userId>:<clé>`) : l'unicité
   * `(key, scope)` devient propre à chacun. Une clé connue d'un tiers (journal,
   * proxy, client qui génère des clés prévisibles) ne rejoue jamais la réponse
   * d'un autre utilisateur. Aucune migration : seul le contenu de `key` change.
   */
  const value = cleIdempotence(req.user?.id, key);
  const where = { key_scope: { key: value, scope } };

  try {
    // Réserver la clé avant tout effet métier. L'unicité SQL arbitre les requêtes concurrentes.
    await prisma.idempotencyKey.create({
      data: {
        key: value,
        scope,
        userId: req.user?.id ?? null,
        responseStatus: null,
        responseBody: null,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });
  } catch (error) {
    if (error.code !== 'P2002') return next(error);

    try {
      const existing = await prisma.idempotencyKey.findUnique({ where });
      if (existing && existing.responseStatus !== null && existing.responseStatus !== undefined) {
        res.setHeader('Idempotent-Replayed', 'true');
        return res.status(existing.responseStatus).json(existing.responseBody);
      }
      return next(ApiError.conflict('Une requête avec cette clé idempotente est déjà en cours'));
    } catch (lookupError) {
      return next(lookupError);
    }
  }

  const originalJson = res.json.bind(res);
  let responseHandled = false;
  res.json = (body) => {
    if (responseHandled) return originalJson(body);
    responseHandled = true;

    if (res.statusCode >= 500) {
      return prisma.idempotencyKey
        .delete({ where })
        .catch((error) => logger.error('IDEMPOTENCY_PENDING_DELETE_FAILED', error.message))
        .then(() => originalJson(body));
    }

    return prisma.idempotencyKey
      .update({
        where,
        data: { responseStatus: res.statusCode, responseBody: body },
      })
      .then(() => originalJson(body))
      .catch(async (error) => {
        logger.error('IDEMPOTENCY_RESPONSE_PERSIST_FAILED', error.message);
        await prisma.idempotencyKey
          .delete({ where })
          .catch((deleteError) => logger.error('IDEMPOTENCY_PENDING_DELETE_FAILED', deleteError.message));
        res.json = originalJson;
        return next(ApiError.internal('Impossible de conserver la réponse idempotente'));
      });
  };

  return next();
};

/* ═══════════════════ Idempotence TRANSACTIONNELLE (I4c, I4b, I7, I6b) ═══════════════════
 *
 * Le mécanisme historique ci-dessus enchaîne trois écritures indépendantes
 * (réservation, écriture métier, réponse) : une interruption entre elles
 * produisait une clé orpheline (I4b) ou un doublon (I4c). Ici, la clé, l'écriture
 * métier, son audit et la réponse sont validés ou annulés ENSEMBLE, dans UNE
 * transaction PostgreSQL. Sémantique démontrée sur le banc (analyse
 * complémentaire, P1 à P5) puis par la recette idempotenceV1.
 *
 *  - portée : clé client cloisonnée par UTILISATEUR et ORGANISATION ACTIVE ;
 *  - empreinte : SHA-256(portée, organisation, corps validé canonique), dans
 *    la colonne existante `requestHash` ; corps différent → 422 (I6b) ;
 *  - expiration : 24 h ; une clé expirée est supprimée puis réservée de nouveau
 *    DANS la transaction (I7 ; concurrence sûre, P4) ; purge quotidienne
 *    (`idempotency.purge`) ;
 *  - concurrence : la transaction commence par un verrou consultatif NON
 *    bloquant sur la clé (`pg_try_advisory_xact_lock`). Une requête concurrente
 *    n'attend jamais en tenant une connexion du pool (sinon 20 requêtes sur la
 *    même clé épuisaient le pool et bloquaient toute l'API — constaté en
 *    recette) : elle rejoue la réponse si elle est déjà validée, sinon 409
 *    IDEMPOTENCY_REQUEST_IN_PROGRESS ; le client renvoie et obtient le rejeu.
 *    Un conflit sur l'index unique est traité HORS de la transaction (P5) ;
 *  - interruption : rien n'est validé ; la reprise s'exécute normalement (P2, P3) ;
 *  - transition : une ligne « en cours » (`responseStatus` nul) ne peut venir que
 *    de l'ANCIEN mécanisme ; elle n'est reprise qu'après expiration (I4b) pour ne
 *    jamais risquer de doublon pendant le déploiement.
 */

const DUREE_CLE_MS = 24 * 3600 * 1000;

/** Clé stockée : utilisateur, organisation active et clé client. */
export const cleIdempotenceV1 = (userId, organizationId, cleClient) =>
  `v1:${userId ?? 'anonyme'}:${organizationId ?? 'aucune'}:${String(cleClient)}`;

/** JSON canonique : clés triées à tous les niveaux (empreinte stable). */
const canonique = (valeur) => {
  if (Array.isArray(valeur)) return `[${valeur.map(canonique).join(',')}]`;
  if (valeur && typeof valeur === 'object' && !(valeur instanceof Date)) {
    return `{${Object.keys(valeur).sort().map((k) => `${JSON.stringify(k)}:${canonique(valeur[k])}`).join(',')}}`;
  }
  return JSON.stringify(valeur instanceof Date ? valeur.toISOString() : valeur ?? null);
};

export const empreinteRequete = (scope, organizationId, corps) =>
  createHash('sha256').update(`${scope}\n${organizationId ?? ''}\n${canonique(corps)}`).digest('hex');

const erreurCleReutilisee = () =>
  new ApiError(422, 'Clé d’idempotence déjà utilisée pour une requête différente', {
    code: 'IDEMPOTENCY_KEY_REUSED',
    errors: [{ field: 'Idempotency-Key', code: 'reused', message: 'Utilise une nouvelle clé pour une nouvelle requête' }],
  });

const erreurEnCours = () =>
  new ApiError(409, 'Une requête avec cette clé idempotente est déjà en cours : renvoie-la pour obtenir sa réponse', {
    code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
  });

/** Marqueur interne : verrou de la clé déjà pris par une requête concurrente. */
const EN_COURS = Symbol('idempotence-en-cours');

const rejouer = (res, ligne) => {
  res.setHeader('Idempotent-Replayed', 'true');
  return res.status(ligne.responseStatus).json(ligne.responseBody);
};

/**
 * Décision sur une clé DÉJÀ VALIDÉE (lue hors transaction).
 * Renvoie 'executer' | 'rejouer' | une ApiError.
 */
const decider = (ligne, empreinte, maintenant = new Date()) => {
  if (!ligne) return 'executer';
  if (ligne.expiresAt <= maintenant) return 'executer';
  if (ligne.responseStatus === null || ligne.responseStatus === undefined) {
    return erreurEnCours();
  }
  if (ligne.requestHash && ligne.requestHash !== empreinte) return erreurCleReutilisee();
  return 'rejouer';
};

/**
 * Middleware (après `validate`) : prépare `req.idempotence` et rejoue sans
 * rien exécuter si la clé est déjà validée. Facultatif : sans en-tête, la
 * requête passe inchangée (le Web n'envoie pas de clé).
 */
export const idempotenceTransactionnelle = (scope) => async (req, res, next) => {
  const cleClient = req.headers['idempotency-key'];
  if (cleClient === undefined || cleClient === '') return next();
  if (String(cleClient).length < 8 || String(cleClient).length > 200) {
    return next(ApiError.badRequest('En-tête Idempotency-Key invalide (8 à 200 caractères)'));
  }
  try {
    const organizationId = req.tenant?.organizationId ?? null;
    const cle = cleIdempotenceV1(req.user?.id, organizationId, cleClient);
    const empreinte = empreinteRequete(scope, organizationId, req.body);
    const ligne = await prisma.idempotencyKey.findUnique({ where: { key_scope: { key: cle, scope } } });
    const decision = decider(ligne, empreinte);
    if (decision instanceof ApiError) return next(decision);
    if (decision === 'rejouer') return rejouer(res, ligne);
    req.idempotence = { cle, scope, empreinte };
    return next();
  } catch (error) {
    return next(error);
  }
};

/**
 * Exécute une création, idempotente si `req.idempotence` est posé.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {(db: any) => Promise<object>} executer création métier ; reçoit le client (transactionnel ou non)
 * @param {{ message: string, status?: number }} reponse
 */
export const executerIdempotent = async (req, res, executer, { message, status = 201 }) => {
  if (!req.idempotence) {
    return success(res, await executer(prisma), { status, message });
  }
  const { cle, scope, empreinte } = req.idempotence;
  const where = { key_scope: { key: cle, scope } };
  try {
    const corps = await prisma.$transaction(
      async (tx) => {
        // Verrou NON bloquant : jamais d'attente en tenant une connexion du pool.
        const [{ acquis }] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtextextended(${`idempotence:${scope}:${cle}`}, 0)) AS acquis`;
        if (!acquis) throw EN_COURS;
        // Clé expirée (ou « en cours » héritée et expirée) : reprise sûre (P4).
        await tx.idempotencyKey.deleteMany({ where: { key: cle, scope, expiresAt: { lte: new Date() } } });
        // Réservation (la clé n'est visible des autres qu'à la validation).
        await tx.idempotencyKey.create({
          data: { key: cle, scope, userId: req.user?.id ?? null, requestHash: empreinte, responseStatus: null, expiresAt: new Date(Date.now() + DUREE_CLE_MS) },
        });
        const donnees = await executer(tx);
        const enveloppe = { success: true, message: translateMessage(message, req.locale), data: donnees };
        await tx.idempotencyKey.update({ where, data: { responseStatus: status, responseBody: JSON.parse(JSON.stringify(enveloppe)) } });
        return enveloppe;
      },
      { maxWait: 10_000, timeout: 15_000 },
    );
    return res.status(status).json(corps);
  } catch (error) {
    // Requête concurrente en cours, ou conflit sur la clé : relire HORS transaction (P5).
    if (error === EN_COURS || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
      const ligne = await prisma.idempotencyKey.findUnique({ where });
      const decision = decider(ligne, empreinte);
      if (decision === 'rejouer') return rejouer(res, ligne);
      if (decision instanceof ApiError) throw decision;
      if (error === EN_COURS) throw erreurEnCours();
    }
    throw error;
  }
};

/** Purge des clés expirées (tâche quotidienne `idempotency.purge`). */
export const purgerClesExpirees = async (maintenant = new Date()) => {
  const { count } = await prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lte: maintenant } } });
  return { deleted: count };
};
