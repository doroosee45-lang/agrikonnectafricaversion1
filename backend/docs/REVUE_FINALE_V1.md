# Revue contradictoire finale : branche `correction/backend-v1`

**Périmètre :** backend V1 uniquement.

**Niveaux de preuve :**
- **ANALYSÉ** : lecture de code ou raisonnement ;
- **TESTÉ** : exécuté sur le banc (PostgreSQL 18.4 embarqué, faux GoTrue, Socket.IO réel) ;
- **VALIDÉ** : exécuté sur l'environnement réel. **Aucun point n'est VALIDÉ.** Rien n'a été exécuté sur Supabase.

**La V1 n'est pas déclarée stabilisée.** Aucune fusion n'a été faite et aucune migration n'a été appliquée.

---

## 1. Résultats par vérification

### 1.1 TX-3 : création de groupe (`createGroup`)

**Diagnostic présenté avant toute modification. Aucune correction n'a été appliquée.**

- **Clé de verrou :** `conversation:GROUP:GRP:<nom>` ([messaging.service.js:328-342](../src/modules/messaging/messaging.service.js#L328-L342), [conversations.js:20](../src/shared/conversations.js#L20)). C'est un `pg_advisory_xact_lock(hashtextextended(clé, 0))`.
- **Sérialisation et unicité sont distinctes.**
  - Le verrou **sérialise** seulement les créations concurrentes portant le même nom, quel que soit le locataire.
  - La **déduplication** fonctionnelle exige le même administrateur (`participantOrgIds[0] === organisation active`) **et** le même nombre de membres ([messaging.service.js:347](../src/modules/messaging/messaging.service.js#L347)).
  - Deux locataires qui créent « Famille » ne se voient donc jamais. Ils attendent seulement l'un après l'autre, pendant quelques millisecondes.
- **Preuves (TESTÉ, journal 38) :**
  - TX3-1 : même nom, administrateurs et membres différents, en concurrence → **deux groupes distincts**.
  - TX3-2 : même administrateur, membres différents → deux groupes.
- **Collision de hachage :** `hashtextextended` produit 64 bits. Une collision ne ferait que sérialiser deux créations sans rapport, sans fusionner de données (ANALYSÉ).
- **Proposition, non appliquée :** inclure l'organisation administratrice dans la clé (`GROUP:<org>:<nom>`). Cela supprime l'attente entre locataires sans rien changer à la déduplication. La décision vous revient.
- **Écart restant (ANALYSÉ) :** la déduplication compare le **nombre** de membres, pas leur **ensemble**. Un même administrateur qui crée deux groupes de même nom et de même taille, avec des membres différents, et en concurrence, obtiendrait le premier groupe. Ce cas n'a pas été testé. Il est à arbitrer.

### 1.2 TX-1 : inscription Supabase Auth → PostgreSQL

| Étape en panne | Comportement | Preuve |
|---|---|---|
| Après la création Auth, pendant la transaction PostgreSQL | Annulation, puis compensation par `deleteUser`. Aucun orphelin, réinscription possible. | RC-1, TESTÉ |
| **Échec de la compensation** | **Avant correction :** non détecté. `supabase-js` renvoie `{ error }` sans exception, donc le `.catch` ne voyait rien, et la connexion répondait **404** (compte inutilisable). **Après correction :** journal et audit `auth.register.compensation_failed`, orphelin identifié, profil recréé à la connexion (audit `auth.profile.recovered`). | RC-2 ; contre-preuve journal 41, après journal 42 |
| Arrêt du serveur entre la création Auth et la transaction | Pas de journal. L'orphelin est révélé par la réconciliation et récupéré à la connexion. | RC-3 |
| Après la transaction (étapes non bloquantes) | `nonBloquant` journalise, l'inscription reste valide. | `transactionsV1`, TESTÉ (journaux antérieurs) |
| Profil sans utilisateur Auth | Identifié par la réconciliation. | RC-4 |

- **Mécanisme de reprise :** [scripts/reconcilier-comptes.mjs](../scripts/reconcilier-comptes.mjs), en **lecture seule**, produit trois listes : `orphelinsAuth`, `orphelinsApplicatifs`, `compensationsEchouees`. **Il n'a pas été exécuté sur Supabase**, faute d'autorisation.
- **Limite :** le compte récupéré reçoit le rôle FARMER, pas le type demandé à l'inscription (par exemple BUYER). Le rôle n'est jamais lu dans les métadonnées, qui sont modifiables par l'utilisateur.
- **Non-régression authentification :** e2e 52/52, unitaires 34/34 (journal 43).
- **Commit :** `df87e00`.

### 1.3 W11, W12, W13 : autorisation Socket.IO

- **Autorisation effective dans les gestionnaires, pas seulement par les rooms :**
  - `typing`, `conversation:join` et `send_message` relisent le profil et les droits (`ecouteurProtege`, `chargerProfilActif`).
  - La connexion et `conversation:join` utilisent la règle unique `organisationsLisibles` (droit `messages.read`, [bus.js:127](../src/realtime/bus.js#L127)).
  - Preuves : WH-1 et WH-2, TESTÉ (journal 38, commit `dc4854a`).
- **Clients réels :** WC-1 et WC-2 avec le client `socket.io-client` 4.8.4 des applications, TESTÉ.
  - `session:revoked` est reçu, puis vient la coupure serveur, **sans reconnexion automatique**.
  - Une coupure réseau, à l'inverse, provoque une reconnexion.
  - Les applications Web et Mobile réelles n'ont pas été exécutées. Leur réaction (écran de déconnexion) est ANALYSÉE.
- **Délai maximal d'exposition :**

| Origine du changement | Délai | Niveau |
|---|---|---|
| Appel API traité par **cette** instance (suspension, déconnexion forcée, retrait de rôle, suppression de compte, déconnexion) | Immédiat : coupure en 0 à 30 ms après la réponse | TESTÉ (RV-1, RV-2, RV-2 bis) |
| Appel API traité par **une autre** instance (sans adaptateur Redis) | ≤ `REALTIME_RECHECK_MS` (60 s par défaut, de 1 s à 1 h) + durée d'un passage (une requête pour tous les profils de l'instance) | TESTÉ (RV-5) |
| Changement fait **hors API** (console Supabase, SQL) sur le statut ou les adhésions | ≤ `REALTIME_RECHECK_MS` + durée d'un passage | ANALYSÉ (même filet) |
| **Expiration du jeton** | **Non bornée** : comptée par le filet (`jetonsExpires`) mais pas coupée | Risque ouvert |
| **Révocation de session côté Supabase** (console, « sign out ») | **Non détectée** tant que le statut et les rôles restent valides | Risque ouvert |

### 1.4 A3 : pièces jointes

- **Nouveaux messages :** URL externe refusée, clé non conforme refusée, clé d'une autre organisation refusée (PJ-2, PJ-3, TESTÉ).
- **Données antérieures :** renvoyées **inchangées** et jamais signées (PJ-4).
- **Clé d'un autre locataire :** seule une clé de l'organisation **expéditrice**, si elle est participante, est signée ([messaging.service.js:211-220](../src/modules/messaging/messaging.service.js#L211-L220)).
  - A3-X : un ancien message de A contenant une clé conforme de B n'est signé pour personne.
  - A3-Y : non-régression (journal 38).
- **`attachmentUrls` à null (ANALYSÉ) :**
  - le Web et le Mobile **ignorent `attachmentUrls`** et affichent la clé brute `attachments` ;
  - pour une donnée ancienne non signée, le comportement reste donc celui d'avant (lien inutilisable ou URL externe d'origine) ;
  - aucun plantage n'a été identifié, mais **aucun affichage du média signé non plus** (WEB-1, WEB-2, MOB-1, préexistants).

### 1.5 Idempotence

Fichier : [idempotency.js](../src/middleware/idempotency.js). Routes concernées : création d'exploitation, de parcelle, de production et d'historique cultural.

- **Portée :**
  - clé `userId:organizationId:cléClient` (ligne 144), unique avec la `scope` de route ;
  - empreinte SHA-256 de la portée, de l'organisation et du corps canonique (ligne 156) ;
  - même clé avec un autre utilisateur, une autre organisation ou une autre opération → portées indépendantes (ID-8) ;
  - corps différent → 422 `IDEMPOTENCY_KEY_REUSED` (ID-4).
- **Concurrence :** verrou **non bloquant** `pg_try_advisory_xact_lock` (ligne 236).
  - 20 requêtes simultanées → une seule exécution, les autres reçoivent 409 `IDEMPOTENCY_REQUEST_IN_PROGRESS` ou un rejeu (ID-1).
  - Une rafale de 30 requêtes n'épuise pas le pool : une requête sans rapport est servie en environ 100 à 200 ms (ID-1b).
- **Expiration :** 24 h. Une clé expirée est supprimée puis réservée de nouveau dans la même transaction (ID-6). La tâche `idempotency.purge` fait le ménage.
- **Effets de bord :**
  - la clé, l'écriture métier, l'audit et la réponse sont dans **une seule transaction** ;
  - erreur métier ou panne → rien n'est validé, la reprise exécute de nouveau (ID-2 ; ID-3 avec un vrai SIGKILL) ;
  - **les quatre services n'appellent aucun service externe** (pas de notification, de socket, de SMS ni d'e-mail ; ANALYSÉ par recherche dans `farms`, `plots` et `productions`) ;
  - une ré-exécution après une erreur métier ne peut donc produire **aucun doublon externe**.
- **Tests conservés :** ID-1 à ID-10, dont ID-1b (saturation du pool), ID-2 (panne) et ID-3 (arrêt réel).
- **Écart de sémantique documenté :** après une erreur, la reprise **ré-exécute** au lieu de rejouer l'erreur (révision de I3).

### 1.6 Tâches planifiées et pool de connexions (nouveau, commit `a934a6e`)

- **JOBS-1 :** `runJob` prenait un verrou de **session** dans une transaction et le libérait dans un `finally`.
  - Défaut : quand la transaction était expirée, le déverrouillage échouait et le verrou restait sur la connexion rendue au pool, ou sur le serveur partagé par PgBouncer.
  - **Contre-preuve, TESTÉ (journal 44) :** un verrou survivant.
  - **Correction :** `pg_try_advisory_xact_lock`, libéré au COMMIT ou au ROLLBACK, avec le même espace de clés. Résultat 3/3 (journal 45).
  - Les tests unitaires du verrou ont été alignés sur le nouveau contrat.
  - **Risque résiduel (ANALYSÉ) :** si une tâche dépasse le délai de 30 min, la transaction expire et le verrou est libéré pendant que la tâche continue. Une autre instance pourrait alors lancer la même tâche. Avant la correction, la tâche était bloquée sans limite. Les tâches V1 sont des purges et des expirations idempotentes.
  - **PgBouncer non mesuré.**
- **POOL-1 :**
  - P2024 (et P2028 « Unable to start a transaction ») partaient en 422, et les clients classent un 4xx comme définitif.
  - **Correction :** 503 `DB_POOL_EXHAUSTED` avec `Retry-After: 2`. Les autres P2028 sont inchangés.
  - 18/18. Contre-preuve sur HEAD : 422 (journal 46).
  - Côté Mobile, un statut ≥ 500 est de catégorie `server` et rejouable ([apps/Mobile/src/services/api/types.ts:72](../../apps/Mobile/src/services/api/types.ts#L72)), ANALYSÉ.
- **Non-régression :** 63 réussis. Les 4 échecs (`alertSmsJob`, route `/agronomic-ranges` absente) **existent à l'identique sur HEAD** (journaux 47 et 48).
- **Non déployé.**

### 1.7 S2 : curseur stable

Non implémenté. Le dossier complet est dans [DOSSIER_S2_CURSEUR_STABLE.md](DOSSIER_S2_CURSEUR_STABLE.md) (commit `188e4e9`, journaux 49 à 51).

- **Version :** PostgreSQL ≥ 13 requis. Banc en 18.4 ; version Supabase non vérifiée.
- **Migration :** `ADD COLUMN xid8 NOT NULL DEFAULT pg_current_xact_id()` prend **3 ms sans réécriture** (fonction STABLE). L'hypothèse initiale d'une réécriture est réfutée.
- **Verrou :** `lock_timeout` est indispensable.
- **Index :** `CONCURRENTLY`.
- **Concurrence :** pagination composite et lecture en une instruction, 0 perte et 0 doublon, sur trois répétitions.
- **Transactions longues :** elles retardent la livraison sans perte.
- **Pièges P1 et P2 :** constatés et documentés.
- **Compatibilité :** contrat additif ; retour arrière décrit.

## 2. Fichiers et fonctions modifiés pendant cette revue

| Commit | Fichiers et fonctions |
|---|---|
| `dc4854a` | `realtime/bus.js` (`organisationsLisibles` exporté) ; `realtime/index.js` (connexion, `conversation:join`) ; `messaging.service.js` (`signerPiecesJointes`) ; tests `revueFinaleV1` |
| `df87e00` | `auth.service.js` (compensation, `creerProfilDepuisAuth`, récupération dans `login`) ; `scripts/reconcilier-comptes.mjs` ; faux GoTrue (`GET /admin/users`) ; tests `reconciliationComptesV1` |
| `a934a6e` | `jobs/index.js` (`runJob`) ; `shared/http/errorHandler.js` (`poolSature`, P2024, P2028, `Retry-After`) ; tests `jobsVerrousV1`, `poolSaturationV1`, `jobs.integration` (contrat du verrou), `helpers/fakePrisma` |
| `188e4e9` | Documentation et banc uniquement : `DOSSIER_S2_CURSEUR_STABLE.md`, `curseurStableS2Dossier` |

## 3. Anomalies restantes

| Code | Anomalie | Niveau |
|---|---|---|
| S2 | Perte possible en synchronisation concurrente (curseur temporel) | TESTÉ, conception prête |
| W-exp | Socket maintenu après l'expiration du jeton | ANALYSÉ |
| W-sb | Révocation de session côté Supabase non détectée par les sockets | ANALYSÉ |
| W-multi | Révocation sur une autre instance bornée à 60 s (sans adaptateur) | TESTÉ |
| WEB-1, WEB-2, MOB-1 | Les clients ignorent `attachmentUrls` et affichent des clés brutes ; le Web lit `data.items` | ANALYSÉ, préexistant |
| TX-3b | Déduplication de groupe par nombre de membres, pas par ensemble | ANALYSÉ |
| TX-1b | Compte récupéré avec le rôle FARMER, pas le type demandé | TESTÉ |
| JOBS-1b | Tâche de plus de 30 min : chevauchement possible entre instances | ANALYSÉ |
| SYNC-U | `deltaSync` ne synchronise ni modifications ni suppressions (`updated` et `deleted` vides) | ANALYSÉ, préexistant |
| T-pre | 5 tests de navigation Mobile et 4 tests `alertSmsJob` échouent avant et après les corrections ; tests V2 à V5 hors périmètre | TESTÉ |
| M1 | Migration préparée, non appliquée sur Supabase | — |

## 4. Risques non résolus

1. **Rien n'est VALIDÉ sur Supabase.** PgBouncer, le pool `connection_limit=5`, la version PostgreSQL et les volumes réels n'ont pas été mesurés.
2. État réel des comptes inconnu : la réconciliation n'a pas été exécutée.
3. Déploiement sur plusieurs instances : pas d'adaptateur Socket.IO, donc filet de 60 s.
4. Clients Web et Mobile non exécutés de bout en bout (seul le client Socket.IO l'a été).

## 5. Opérations qui restent soumises à votre autorisation

1. **Lectures sur Supabase :**
   - version PostgreSQL ;
   - taille et volume de `messages` ;
   - `node scripts/reconcilier-comptes.mjs` (lecture seule) ;
   - vérification préalable des objets de M1.
2. **Application de M1** sur Supabase, et usage éventuel de `prisma migrate resolve` (seulement avec une preuve d'existence exacte des objets).
3. **Décisions d'architecture :**
   - clé de verrou TX-3 incluant l'organisation ;
   - déduplication de groupe par ensemble de membres ;
   - option A de S2, contrat additif et procédure de « génération » ;
   - coupure des sockets à l'expiration du jeton.
4. **Implémentation et migration de S2**, puis publication du client Mobile.
5. **Récupération des orphelins réels** : toute écriture issue du rapport de réconciliation.
6. **Déploiement** de JOBS-1 et POOL-1.
7. **Fusion dans `main`.**
8. Toute suppression, fusion de conversations ou nettoyage.

## 6. Non-régression V1 finale (journal 52)

Ensemble exécuté : 18 fichiers e2e (V1, messagerie, appels, notifications push, authentification, MFA, OTP) et 14 fichiers unitaires et d'intégration.

**Résultat (TESTÉ) : 360 tests, 351 réussis, 0 échec, 6 ignorés, 3 `todo`.**

- **Ignorés :** I4a, I4b, I4c et I7 portent sur l'ancien mécanisme d'idempotence, remplacé par ID-2, ID-3, ID-6 et ID-7. IOT-03 est hors V1. Le planificateur est ignoré parce que `JOBS_ENABLED=false`.
- **`todo` :** il s'agit notamment de W11 hors API (modification directe en base), appliqué par le filet en 60 s au plus alors que le test n'attend que 400 ms. C'est l'anomalie W-multi et hors API du §3.

## 7. État Git

- **Branche :** `correction/backend-v1`, non fusionnée.
- **Commits de cette revue :** `dc4854a`, `df87e00`, `a934a6e`, `188e4e9`, et le commit de ce document.
- **Laissés intacts et non commités (autre contributeur) :**
  - `apps/web/package.json` ;
  - `apps/web/package-lock.json` ;
  - `apps/web/src/App.tsx` ;
  - `apps/web/src/pages/public/Home.tsx` ;
  - `apps/web/src/pages/public/MapPage.tsx` (non suivi).
