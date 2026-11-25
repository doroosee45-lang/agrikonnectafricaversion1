# Rapport de correction consolidé — Backend V1 (et synchronisation Mobile)

**Date :** 25 novembre 2026 · **Pour :** architecte (validation) · **Réponse à :** « Directive architecturale — arbitrage des rapports transactions, migrations et synchronisation V1 », §5.
**Branche :** `correction/backend-v1` (depuis `stabilisation/backend-v1`), **non fusionnée**. `main` inchangé (`d781d9e`).
**Aucune** opération sur Supabase réel, **aucune** migration appliquée hors du banc, **aucune** donnée existante modifiée, **aucune** conversation supprimée ou fusionnée.

**Classement des résultats :**
- **ANALYSÉ** : établi par lecture du code ou par conception.
- **TESTÉ** : exécuté sur le banc local (PostgreSQL **18.4 embarqué**, isolation `read committed`, faux GoTrue, Windows 11, Node 26.13.0), journal dans `docs/preuves/logs/`.
- **VALIDÉ** : **rien**. Aucune exécution sur Supabase réel, PgBouncer ni appareil mobile.

---

## 1. Synthèse

| Mesure | Avant (journal) | Après (journal) |
|---|---|---|
| `npm test` complet | 642 réussis / 250 échecs (02) | **648 / 248** (36). Les 2 échecs E8 sont levés ; les 248 restants sont tous classés V2-V5 ou références V5, comme avant ; **aucun nouvel échec** |
| Recettes V1 de la branche (13 fichiers e2e) | — | **107 réussis, 0 échec**, 4 ignorés motivés, 3 `todo` (37) |
| Contrôle des migrations | Dérive détectée (09) | **Aucune dérive**, 25 migrations, RLS sur 110 tables (12) |
| Vérification de types Mobile | — | **0 erreur** (34) |
| Tests Mobile | 49/54 | 49/54 : **5 échecs de navigation identiques avant et après** (33) |

## 2. Anomalies corrigées

Chaque correction : contre-épreuve sur le code antérieur (le test échoue), puis réussite avec le correctif.

| ID | Correction | Commit | Preuve après | Contre-épreuve | Statut |
|---|---|---|---|---|---|
| **E8 / dérive** | Migration additive **M1** : fondations Academia (5 énumérations, 8 valeurs, 4 tables, RLS). Client Prisma local régénéré en 5.22.0, version du déploiement | `681519e` | 12 (aucune dérive), 13 (E8 5/5) | 11 : avec le client de production, E8 échoue **en base** (`22P02 invalid input value for enum "Role"`) | TESTÉ (banc) ; **non appliquée en production** |
| **TX-1** | Inscription traitée en **saga explicite** (pas une transaction distribuée) : Supabase Auth, puis transaction PostgreSQL (jeton de consentement **dans** la transaction), puis étapes non bloquantes. Compensation (suppression de l'utilisateur Supabase) **uniquement** si la transaction échoue ; un échec de la compensation est journalisé | `055a3d7` | 15 : TX-1a et TX-1b 2/2 | 14 : TX-1b **500, profil orphelin, connexion impossible** | TESTÉ |
| **TX-2** | `ensureBusinessConversation` : verrou consultatif **transactionnel** par sujet ; recherche, création et premier message dans une transaction | `055a3d7` | 15 : 30 ouvertures simultanées → **1 fil** | 16 : **22 fils** | TESTÉ |
| **TX-3** (`createGroup`, étude séparée) | Même sérialisation, sur la clé `GROUP:<nom>` | `055a3d7` | 15 : 30 créations → **1 groupe** | 16 : **30 groupes** | TESTÉ |
| **W13** | Déconnexion : coupure des **seuls** sockets ouverts avec ce jeton (empreinte SHA-256) ; les autres appareils restent connectés | `f2b191c` | 19 : RV-1 ; 21 : W13 | 20 : RV 0/6 | TESTÉ |
| **W12** | Compte inactif (suspension, suppression, déconnexion forcée) : coupure **immédiate** de tous ses sockets ; événement `session:revoked { reason }` ; reconnexion refusée | `f2b191c` | 19 : RV-2, RV-2 bis (≤ 25 ms) | 20 | TESTÉ |
| **W11** | Droits réduits (rôle retiré) : sortie des rooms non autorisées, **sans coupure** | `f2b191c` | 19 : RV-3 | 20 | TESTÉ |
| **W11/W12 hors API, multi-instances** | Filet périodique par instance (`REALTIME_RECHECK_MS`, 60 s par défaut) : modifications faites hors API et autres instances | `f2b191c` | 19 : RV-4 (≈ 200 ms avec un filet de 400 ms) ; **RV-5 : deux processus serveur sans adaptateur partagé → 24 ms sur l'instance qui traite, 624 ms par le filet sur l'autre** | 20 | TESTÉ |
| **A3** | Grammaire **unique** des clés (`shared/storageKeys.js`) ; nouveaux messages : clé conforme de l'expéditeur, **URL externes refusées** ; données anciennes renvoyées **inchangées** mais jamais signées | `51b5f9d` | 23 : PJ 4/4 ; 26 : unitaires | 24 : clé `…/../<autre org>/…` **signée**, URL externe relayée | TESTÉ (stockage simulé) |
| **I4c, I4b, I7, I6b** | Idempotence **transactionnelle** : clé, écriture métier, audit et réponse validés ensemble. Portée utilisateur + organisation ; empreinte dans `requestHash` ; expiration appliquée et purge quotidienne ; verrou **non bloquant** sur la clé (409 `IDEMPOTENCY_REQUEST_IN_PROGRESS` ou rejeu) ; conflit traité hors transaction | `b3e1fba` | 27 : ID 11/11, dont **ID-3 arrêt réel** (`SIGKILL` d'un second processus en pleine transaction : rien validé, reprise = 1) et ID-1b (pool non épuisé) | 28 : ID-3 **clé orpheline, 409 sans fin** | TESTÉ (PgBouncer non exercé) |
| **OFF-1** | Mobile : tirage sur `/messaging/sync` ; échec capturé | `78ee72d` | 31 : SM-1 ; analyse C1 | 08 : 404 | TESTÉ (sans appareil) |
| **OFF-4a** | Serveur : `localTempId` accepté par le repli REST (rejeu idempotent) | `78ee72d` | 31 : SM-2 (1 message, id = id local) | 32 : **2 messages** | TESTÉ |
| **OFF-4b** | Mobile : fusion sur `server_id` **ou** `local_temp_id` (`db/deltaPlan.ts`, logique pure partagée) | `78ee72d` | 31 : SM-3 ; analyse L3 | 08 : `UNIQUE constraint failed: messages.server_id` | TESTÉ (node:sqlite, pas expo-sqlite) |
| **OFF-6** | Mobile : toutes les pages (`hasMore`), curseur enregistré après chaque page (`services/syncPull.ts`) | `78ee72d` | 31 : SM-4 (1 201 messages sur 3 pages), SM-5 (coupure à la page 2 puis reprise : ni perte ni doublon) | ANALYSÉ (ancien code : une page par déclenchement) | TESTÉ |

**Constaté pendant la correction, puis corrigé :** la première version de l'idempotence faisait attendre les requêtes concurrentes **en tenant une connexion**. 20 requêtes sur la même clé épuisaient le pool (P2024), et la panne aurait été totale avec `connection_limit=5` en production. D'où le verrou non bloquant ; ID-1b vérifie qu'une requête sans rapport reste servie en 121 ms pendant une rafale de 30.

## 3. Changements de comportement (contrats)

| Point | Avant | Après |
|---|---|---|
| Socket | — | Ajout de l'événement `session:revoked { reason: LOGOUT \| SESSIONS_REVOKED \| ACCOUNT_INACTIVE }` avant une coupure par le serveur |
| Pièces jointes | URL externes acceptées | **422 `external_url_refused`** ; clés libres → **422 `invalid_storage_key`** ; `attachmentUrls` = `null` pour les anciennes URL |
| Idempotence | Erreurs métier enregistrées et rejouées ; 409 `CONFLICT` | Erreur métier : rien d'enregistré, **le renvoi réexécute** ; requête concurrente : **409 `IDEMPOTENCY_REQUEST_IN_PROGRESS`** ; corps différent : **422 `IDEMPOTENCY_KEY_REUSED`** ; clé expirée (24 h) : nouvelle exécution |
| Message REST | `localTempId` ignoré | Accepté (facultatif) |
| Ouverture de fil | Rejeu concurrent compté comme création | `replayed: true`, sans audit ni émission |
| Configuration | — | `REALTIME_RECHECK_MS` (défaut 60 000) |
| Tests | — | Revue I3 adaptée (sémantique documentée) ; I4a, I4b, I4c, I7 marqués `skip` avec motif (ancien format de clé), remplacés par ID-2, ID-3, ID-6, ID-7 ; données de test alignées sur la grammaire A3 |

## 4. Migrations

| Migration | État | Conditions avant production |
|---|---|---|
| `20261125000000_academia_foundations` (**M1**) | **Préparée, non appliquée.** Additive, sans instruction destructive | Comparer d'abord l'état réel (`docs/RAPPORT_MIGRATIONS_INTEGRITE_V1.md` §4, 3 requêtes en lecture seule). Puis l'appliquer, ou la déclarer déjà appliquée (`migrate resolve`) **sur décision**. `ALTER TYPE … ADD VALUE` n'est pas annulable |
| Curseur S2 (colonne `xid8` sur `messages`) | **Non créée** : conception seulement (§5) | Décision d'architecture |

## 5. S2 — conception d'un curseur stable (non implémentée)

**Principe.** Chaque message porte l'identifiant de la transaction qui l'a écrit (`xid8 DEFAULT pg_current_xact_id()`). Au tirage, le serveur lit `x = pg_snapshot_xmin(pg_current_snapshot())`, borne sous laquelle toute transaction est **terminée**. Il livre `curseur ≤ xid < x`, triés par `(xid, id)`, puis renvoie `x` comme nouveau curseur. Une écriture en cours a un `xid ≥ x` : elle sera livrée au tirage suivant sa validation. Chaque ligne appartient à un seul intervalle : **ni perte, ni doublon, sans fenêtre de temps arbitraire**.

**Démontré (TESTÉ, table de démonstration sur le banc, journal 35) :** sur le scénario S2, la ligne est perdue avec le curseur temporel actuel et livrée avec le curseur de transaction. 300 écritures concurrentes de durées aléatoires, tirées en continu : **0 perte, 0 doublon**.

**Conditions et risques :**
- migration : ajout de colonne avec valeur par défaut volatile, donc **réécriture de la table** `messages` ; index `(xid, id)` ;
- PostgreSQL 13 ou plus (`pg_current_xact_id`), à vérifier sur Supabase ;
- une transaction longue, n'importe où dans la base, **retarde** la livraison sans rien perdre. Mesures : `idle_in_transaction_session_timeout` et `statement_timeout` ;
- contrat : nouveau champ de curseur opaque. Transition avec `lastPulledAt` (ms) pour les clients non mis à jour ; mise à jour de `syncPull.ts` côté Mobile ;
- pagination dans un intervalle : curseur composite `(xid, id)`.

**Aucune implémentation sans votre décision.**

## 6. Anomalies non corrigées et raisons

| ID | Constat | Raison |
|---|---|---|
| **S2** | Perte possible en synchronisation concurrente (courbe actuelle) | Conception présentée (§5), décision et migration requises |
| Expiration du jeton (sockets) | Un socket dont le jeton a expiré reste connecté (compté par le filet) | **Décision d'architecture** : pas de coupure avant adaptation des clients Web et Mobile |
| Révocation hors console Supabase | Une session révoquée depuis la console Supabase (hors API) n'est pas détectée avant l'expiration du jeton | Coût d'un appel `getUser` par socket et par intervalle ; à décider |
| Multi-instances : révocation **immédiate** sur les autres instances | Bornée par le filet (60 s) ; pas d'adaptateur Socket.IO partagé | Option B (adaptateur PostgreSQL `LISTEN/NOTIFY` via `DIRECT_URL`) = 2 dépendances : décision |
| **WEB-1, WEB-2, MOB-1** | Fil Web vide (`items` contre `messages`) ; clés brutes affichées sur le Web et le Mobile | Phases Web et Mobile |
| Tests Mobile de navigation (5) | Échouent avant comme après | Hors synchronisation, phase Mobile |
| Tâches planifiées | Verrous consultatifs **de session** (`jobs/index.js:372`), non fiables derrière PgBouncer en mode transaction | Hors périmètre autorisé ; à traiter |
| Épuisement du pool traduit en 422 | `errorHandler` : P2024 → 422 (devrait être 503) | Hors périmètre autorisé |
| `audit` hors transaction (autres modules) | Seules les 4 créations idempotentes écrivent l'audit dans leur transaction | Ailleurs, l'audit reste indépendant (best effort), comme avant |
| Consentement coopératif ; nettoyage V2-V5 | Ouverts | Décisions antérieures en attente |
| Modifications Web d'un autre intervenant | `MapPage`, `leaflet`, `react-leaflet`, `lucide-react` dans `apps/web`, non commités | Non touchées ; périmètre V1 à arbitrer |

## 7. Risques résiduels

1. **Rien n'est validé sur Supabase réel.** Version de PostgreSQL différente, PgBouncer en mode transaction, `connection_limit=5`, latence réseau. Les verrous consultatifs **transactionnels** utilisés sont compatibles avec ce mode ; ce n'est **pas** démontré sur l'environnement réel.
2. **M1** doit précéder ou accompagner le déploiement de ce code : le client de production connaît déjà Academia (E8 en production sinon).
3. Le **filet périodique** fait une requête groupée par minute et par instance. Il n'a pas été mesuré sous charge.
4. Les modules Mobile n'ont été testés qu'en **Node** (`node:sqlite`). `expo-sqlite`, le réseau mobile et les redémarrages de l'application n'ont pas été exercés.

## 8. Décisions nécessaires

1. Autoriser les **3 requêtes de lecture** sur Supabase réel, puis décider l'application de **M1**.
2. **S2** : valider la conception du curseur de transaction, et autoriser sa migration.
3. **Expiration des jetons** et **révocation hors API** sur les sockets : calendrier, après adaptation des clients.
4. **Multi-instances** : rester sur le filet (option A), ou adopter un adaptateur partagé (option B).
5. Correction des **verrous de session des tâches** et de la traduction **P2024 → 503**.
6. Revue de la branche `correction/backend-v1`, puis autorisation de fusion.

**Le backend V1 n'est pas déclaré stabilisé** : S2, l'application de M1 et la validation sur l'environnement réel restent à faire.
