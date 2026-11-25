# Preuves — idempotence et synchronisation (lot R3)

**Date :** 25 novembre 2026 · **Banc :** PostgreSQL **embarqué** jetable (pas Supabase réel), faux GoTrue, application Express réelle.
**Journal :** `preuves/logs/03-revueContradictoireV1.log` · **Recette :** `tests/e2e/revueContradictoireV1.e2e.test.mjs` (I*, S*).
Lecture : `✔` = conforme ; `⚠ … # ANOMALIE` = test `todo` qui affirme le comportement attendu, et dont le message d'échec donne le comportement observé.

Périmètre de l'idempotence (lot 2, E11) : `POST /farms`, `POST /plots`, `POST /productions`, `POST /plots/:id/crop-history`, en mode **facultatif** (sans en-tête `Idempotency-Key`, comportement d'origine). Les scénarios sont joués sur `POST /farms` et `POST /plots` : même middleware, portées distinctes.

## 1. Idempotence — synthèse

| ID | Scénario | Attendu | Observé | Verdict |
|---|---|---|---|---|
| I1 | 6 requêtes **simultanées**, même clé | 1 seule création | 1 exploitation en base ; statuts relevés : 201 (exécution réelle) + 5 × 201 rejoués. Le cas 409 « en cours » n'est pas survenu dans cette exécution (cause non établie) ; l'état « en cours » est couvert par I4a | Conforme |
| I2 | Rejeu après succès | Même réponse, `Idempotent-Replayed: true`, pas de nouvelle création | Corps identique, en-tête présent, 1 exploitation | Conforme |
| I3 | Rejeu après erreur métier (parcelle sur l'exploitation d'un autre tenant) | Erreur rejouée, aucune écriture | 404, puis 404 rejoué ; 0 parcelle | Conforme |
| I4a | Arrêt du serveur **après réservation de la clé**, avant la réponse | Aucun doublon | 409 « en cours » ; 0 création | Conforme sur le doublon (voir I4b) |
| **I4b** | Même situation, clé **expirée** | Requête de nouveau traitable | **409 indéfiniment** | **ANOMALIE** |
| **I4c** | Écriture métier réussie, **échec de persistance de la réponse** | Le renvoi ne duplique pas | 1er appel **500** (1 exploitation créée) ; renvoi **201** ; **2 exploitations** | **ANOMALIE — doublon prouvé** |
| I5 | Même clé, deux utilisateurs | Aucun rejeu croisé | Deux créations distinctes, pas d'en-tête de rejeu | Conforme |
| I6 | Même clé, deux opérations différentes | Portées indépendantes | Parcelle créée (201), non rejouée | Conforme |
| **I6b** | Même clé, même opération, **corps différent** | Refus explicite (422) | **201 rejoué** : renvoie l'exploitation « I6b-A », la création « I6b-B » est perdue sans erreur | **ANOMALIE** |
| **I7** | Clé expirée après succès | Traitée comme une nouvelle requête | **Rejouée** (pas d'expiration effective) | **ANOMALIE** |

**Réponse à la demande « démontrer qu'aucune création métier en double n'est possible » : ce n'est pas démontrable, et c'est faux.** I4c prouve un doublon dans le cas « écriture métier réussie, puis échec de persistance de la réponse ». I1, I2, I4a, I5 et I6 prouvent l'absence de doublon dans les autres cas testés.

## 2. Anomalies d'idempotence

### I4c — doublon après échec de persistance de la réponse

| Rubrique | Contenu |
|---|---|
| **Fichier et ligne** | `src/middleware/idempotency.js:99` (branche `.catch` de la mise à jour de la réponse : `delete({ where })` puis 500) ; aussi `:85` (toute réponse ≥ 500 supprime la clé) |
| **Cause** | La réservation de la clé, l'écriture métier et la persistance de la réponse sont **trois écritures séparées**, hors transaction commune. Si la troisième échoue, le middleware **supprime** la clé et renvoie 500, alors que l'exploitation est déjà créée. Le client renvoie (comportement normal après un 500), la clé n'existe plus, une seconde exploitation est créée. Même effet si un service répond ≥ 500 après une écriture partielle non transactionnelle. |
| **Risque** | Doublons d'exploitations, de parcelles ou de productions sur réseau instable ou en cas de panne passagère de la base : précisément la situation que l'idempotence devait couvrir. |
| **Observé** | `1er appel 500 (fermes : 1) ; renvoi 201 ; fermes finales : 2` |
| **Recommandation** | Ne jamais supprimer une clé après le début de l'effet métier : la laisser en état « en cours » avec une date d'expiration courte (traitée par I4b). Solution complète : persister la réponse dans **la même transaction** que l'écriture métier (le service reçoit le client transactionnel). Décision d'architecture : elle touche la signature des services. |

### I4b / I7 — `expiresAt` jamais appliqué ni purgé

| Rubrique | Contenu |
|---|---|
| **Fichier et ligne** | `src/middleware/idempotency.js:59` (seule mention de `expiresAt`, à l'écriture). Aucune lecture dans le middleware ; aucune tâche de purge dans `src/jobs/index.js` ; index `idempotency_keys_expires_at_idx` créé par la migration initiale mais inutilisé. |
| **Cause** | La clé existante est honorée quel que soit son âge. |
| **Risque** | I4b : après un arrêt du serveur en cours de requête, la clé reste « en cours » pour toujours et le client reçoit 409 à chaque renvoi : **création impossible avec cette clé**. Le mobile traite 409 comme un conflit (`services/api/types.ts:69`). I7 : rejeu perpétuel et table sans limite de croissance. |
| **Observé** | I4b : `observé 409 … « Une requête avec cette clé idempotente est déjà en cours »` (clé expirée depuis 1 h). I7 : `rejoué=true, statut 201` (clé expirée). |
| **Recommandation** | Lire `expiresAt` : clé expirée, on la supprime puis on la réserve à nouveau, dans la même instruction pour rester sûr en concurrence. Clé « en cours » au-delà d'un délai court (par exemple 2 min), on la reprend. Ajouter une tâche de purge `idempotency.purge` (V1, sur le modèle de `notifications.purge`). Aucune migration nécessaire. |

### I6b — aucune empreinte du corps

| Rubrique | Contenu |
|---|---|
| **Fichier et ligne** | `src/middleware/idempotency.js:47` : la clé stockée est `<userId>:<clé client>`, sans empreinte de la requête. |
| **Risque** | Un client qui réutilise une clé par erreur (génération défaillante, file hors ligne qui recopie l'en-tête) **perd silencieusement** la seconde création et reçoit un 201 trompeur. |
| **Observé** | `observé 201, rejoué=true, exploitation renvoyée « I6b-A »` pour une demande « I6b-B ». |
| **Recommandation** | Stocker une empreinte SHA-256 du corps (dans `responseBody` ou un champ existant, pour rester sans migration) et répondre 422 `IDEMPOTENCY_KEY_REUSED` si elle diffère, comme le recommande le brouillon IETF *Idempotency-Key HTTP Header Field*. |

**Observation non testée (à arbitrer) :** la clé est cloisonnée par utilisateur, pas par organisation active. Un même utilisateur qui réutilise une clé en changeant d'organisation reçoit le rejeu de la création faite dans la première.

## 3. Synchronisation — synthèse

Point d'entrée : `POST /messaging/sync` (`deltaSync`, `src/modules/messaging/messaging.service.js:690-750`). Page de 500 messages, curseur `serverTimestamp`, indicateur `hasMore` (lot 1).

| ID | Scénario | Attendu | Observé | Verdict |
|---|---|---|---|---|
| S1 | 650 messages à la **même milliseconde**, à cheval sur la coupure de page | Aucun message perdu ni dupliqué | 1 301 messages reçus sur 1 301, 0 doublon ; pages de 400, 650 et 251 | Conforme (journal : `S1 : 1301 reçus / 1301 attendus ; pages 400, 650, 251 ; ids distincts 1301`) |
| S3 | Reconnexion après **10 jours** hors ligne | Tout le retard livré | Idem S1 (messages horodatés de J−10 à maintenant) | Conforme |
| S4 | Lots **supérieurs à 500** messages | Pagination | 3 pages, `hasMore` vrai puis faux | Conforme |
| S5 | Reprise avec `hasMore` | Curseur = dernier message livré | Union des pages = ensemble attendu | Conforme |
| S6 | **Interruption entre deux pages** (réponse perdue puis redemandée) | Page identique | Même liste d'`id`, même curseur | Conforme |
| **S2** | **Transaction concurrente** : message inséré, validé **après** la lecture | Livré au tirage suivant | **Perdu définitivement** | **ANOMALIE** |
| S7 | Rejeu de créations mobiles | Pas de doublon | Voir I1 à I7 (exploitations, parcelles) ; messages : `localTempId` (D2, `tests/stabilisationV1.test.mjs`, journal 06) | Conforme, sauf I4c / I6b |

### S2 — perte d'un message validé après la lecture

| Rubrique | Contenu |
|---|---|
| **Fichier et ligne** | `src/modules/messaging/messaging.service.js:692` (`const now = Date.now()`) et `:743` (curseur rendu = `now` quand la page n'est pas pleine) |
| **Cause** | `createdAt` est fixé **à l'insertion**, la visibilité intervient **à la validation**. Un message inséré avant la lecture mais validé après n'est pas lu, alors que le curseur rendu (`now`) lui est postérieur. Au tirage suivant (`createdAt > curseur`), il est exclu pour toujours. |
| **Risque** | Perte silencieuse et définitive de messages pour un client mobile, sans erreur. Plus probable sous charge ou avec des transactions longues (pièces jointes signées, notifications dans la même requête). |
| **Observé** | `perdu : créé à 1795602827039, curseur rendu pendant la transaction 1795602827352` : transaction réelle tenue ouverte 300 ms dans PostgreSQL. |
| **Preuve** | Test `S2` (`todo`). |

### Stratégie de curseur proposée (non appliquée)

**Principe : curseur à recouvrement et déduplication côté client.**
1. Requête : `createdAt > curseur − L`, tri `(createdAt, id)`, page de 500, coupure jamais au milieu d'une même milliseconde (règle actuelle conservée).
2. Curseur rendu : `min(createdAt du dernier message livré, maintenant − L)`.
3. Client : application **par `id`** (upsert sur `server_id`). Les messages relivrés dans la fenêtre L sont absorbés.
4. L ≥ durée maximale d'une transaction d'écriture de message, par exemple 30 s. Une transaction qui dépasse L doit échouer (`statement_timeout` / `idle_in_transaction_session_timeout` côté PostgreSQL).

**Pourquoi ce choix plutôt qu'une séquence :** une séquence (`bigserial`) est attribuée à l'insertion, pas à la validation ; elle présente la même course. Les variantes exactes (instantané `pg_snapshot_xmin`, file transactionnelle) demandent une migration ou SQL spécifique : à réserver à une décision d'architecture.

**Démonstration.** Test `S-modèle` : simulation déterministe (graine fixe) de 2 000 scénarios de 200 messages, chacun visible à `t + d` avec `d < L`, tirés à des instants aléatoires. Résultat : **stratégie proposée, 0 perte** sur l'ensemble ; stratégie actuelle, pertes > 0, ce qui reproduit S2. Les relivraisons dans la fenêtre sont comptées et toutes absorbées par l'application par `id` : **0 doublon appliqué**.
**Limite :** c'est la démonstration d'un **modèle**, pas du code de production, qui n'est pas modifié sans décision. Elle suppose aussi que le client déduplique par `id`. À vérifier en phase Mobile dans `OfflineSyncEngine`.

**Effets de bord à arbitrer :** contrat inchangé (`serverTimestamp`, `hasMore`), mais un client qui ne déduplique pas recevrait des doublons d'affichage. Cette garantie doit donc être vérifiée côté mobile **avant** l'application.
