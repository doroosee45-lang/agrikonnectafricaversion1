# Revue contradictoire — Backend V1 (lots R1 à R3)

**Date :** 25 novembre 2026 · **Pour :** architecte (autorité architecturale) et responsable du projet · **Exécutant :** agent de développement.
**Respect de la consigne absolue :** aucune modification fonctionnelle pendant la revue. Seuls des tests, un outil de test (`tests/e2e/support/socketClient.mjs`) et des documents ont été ajoutés. Aucune migration, aucun accès à Supabase réel.

**Documents de la revue :**
- [`INVENTAIRE_COMMITS_ET_MODIFICATIONS.md`](INVENTAIRE_COMMITS_ET_MODIFICATIONS.md) — R1 ;
- [`PREUVES_SECURITE_WEBSOCKET.md`](PREUVES_SECURITE_WEBSOCKET.md) — R2 ;
- [`PREUVES_IDEMPOTENCE_SYNC.md`](PREUVES_IDEMPOTENCE_SYNC.md) — R3 ;
- [`PLAN_RETRAIT_V2_V5.md`](PLAN_RETRAIT_V2_V5.md) — directive architecturale V1 : inventaire et plan, **non exécuté**.

Preuves : `preuves/stabilisation-v1-modifies.patch` (diff intégral) et `preuves/logs/01` à `07` (journaux bruts).

## 1. Conclusions

1. **R1 — Il n'existe aucun commit de stabilisation.** Tout est dans l'arbre de travail, au-dessus de `d781d9e`. Aucune archive n'a été transmise à l'agent : la comparaison demandée n'a pas pu être faite.
2. **R2 — 14 scénarios conformes sur 17, 3 anomalies.** Deux sont graves (W11, W12) et révèlent qu'une correction annoncée comme faite, D8, n'est que **partielle** : un compte suspendu, ou un membre dont l'adhésion est révoquée, **continue de recevoir le contenu des messages** en temps réel.
3. **R3 — Une création en double reste possible** (I4c, prouvée). La demande « démontrer qu'aucune création métier en double n'est possible » ne peut donc pas être satisfaite en l'état. Une perte définitive de messages à la synchronisation est également prouvée (S2). Une stratégie de curseur est proposée et validée **sur un modèle**.
4. **Trois affirmations antérieures de l'agent étaient fausses** et sont rectifiées : le script `test:hors-v1` (lot 1), « les messages ne sont plus reçus » après révocation (rédaction initiale de R2), et les statuts 409 de I1 (rédaction initiale de R3). Plusieurs résultats du lot 1 et du début du lot 2 n'ont pas de journal conservé (inventaire §6) : ils ne valent pas preuve tant qu'ils n'ont pas été relancés.

## 2. Résultats d'exécution

| Journal | Recette | Conformes | Échecs | Anomalies (`todo`) |
|---|---|---|---|---|
| 03 | `revueContradictoireV1` (nouvelle) | 17 | 0 | **8** |
| 04 | `realtimeStabilisation` | 7 | 0 | — |
| 05 | `stabilisationV1` (e2e) | 6 | 0 | — |
| 06 | unitaires messagerie et appels | 78 | 0 | — |
| 07 | contre-épreuve, code d'origine | 0 | 7 | — |
| 02 | `npm test` complet | 642 | 250 (classés : rapport de stabilisation §H) | — |

Banc : PostgreSQL **embarqué**, faux GoTrue, Windows 11, Node 26.13.0. **Aucune validation de production n'est revendiquée.**

## 3. Anomalies — fiches

Format demandé : identifiant · fichier et ligne · cause · risque · attendu · observé · preuve · recommandation. Les fiches détaillées sont dans les documents R2 et R3 ; résumé ci-dessous.

| ID | Fichier : ligne | Cause | Risque | Attendu | Observé | Preuve | Recommandation |
|---|---|---|---|---|---|---|---|
| **W11** | `realtime/index.js:145-160`, `:179` | Rooms rejointes à la connexion jamais quittées quand une adhésion est révoquée | **Fuite de contenu** vers un ex-membre | 0 message reçu | 1 reçu, avec son contenu | journal 03, test W11 | Déconnecter les sockets de l'utilisateur à chaque changement d'adhésion (`disconnectSockets`) |
| **W12** | idem | Profil relu seulement quand le client agit | **Fuite de contenu** vers un compte suspendu | 0 message reçu | 1 reçu, avec son contenu | journal 03, test W12 | Idem, à la suspension et à la suppression de compte, plus une relecture périodique |
| **A3** | `messaging.service.js:181`, `:188`, `:213` | `..` autorisé ; contrôle par `startsWith` | URL signée inter-tenant **si** le stockage normalise (non vérifié sur Supabase réel) | 422 | 201 ; clé transmise à `createSignedUrls` | journal 03, test A3 | N'accepter que la forme `<org>/(media\|documents)/<AAAA-MM>/<nom>` |
| **I4c** | `middleware/idempotency.js:85`, `:99` | Clé supprimée après un échec, alors que l'écriture métier est faite | **Doublon** de création | 1 exploitation | 2 exploitations | journal 03, test I4c | Ne jamais supprimer une clé après le début de l'effet ; persistance de la réponse dans la transaction métier |
| **I4b** | `middleware/idempotency.js:59` (seule mention d'`expiresAt`) | Expiration jamais lue | Création bloquée indéfiniment (409) après un arrêt du serveur | Requête retraitable | 409 indéfiniment | journal 03, test I4b | Lire `expiresAt` ; reprendre les clés « en cours » trop anciennes |
| **I7** | idem | Ni expiration ni purge | Rejeu perpétuel ; table sans borne | Nouvelle requête | Rejouée | journal 03, test I7 | Tâche V1 `idempotency.purge` |
| **I6b** | `middleware/idempotency.js:47` | Aucune empreinte du corps | Création perdue sans erreur (201 trompeur) | 422 | 201 rejoué, autre exploitation renvoyée | journal 03, test I6b | Empreinte SHA-256 du corps, 422 si elle diffère |
| **S2** | `messaging.service.js:692`, `:743` | Curseur `Date.now()` ; `createdAt` fixé avant la validation de la transaction | **Perte définitive** de messages hors ligne | Livré au tirage suivant | Perdu | journal 03, test S2 | Curseur à recouvrement L et déduplication par `id` (test S-modèle : 0 perte sur 2 000 scénarios) |

## 4. Rectification du rapport de stabilisation

| Point du rapport | Statut réel après la revue |
|---|---|
| D8 « droits socket relus » | **Partiel** : vrai pour l'**envoi** et l'adhésion à une room ; faux pour la **réception** (W11, W12) |
| E11 « idempotence » | **Partiel** : protège les renvois ordinaires et concurrents (I1, I2, I5, I6) ; n'empêche pas I4c et ne gère pas l'expiration (I4b, I7) |
| Synchronisation « aucune perte au-delà de 500 » (lot 1) | **Vrai pour la pagination** (S1, S3 à S6) ; **une perte subsiste en concurrence** (S2) |
| D3, D4, D7, D9, C1 à C4, E1 à E12 hors E11 | Non contredits par la revue |

## 5. Anomalies restantes et arbitrages

| # | Sujet | Gravité | Nature | Décision attendue |
|---|---|---|---|---|
| 1 | W11, W12 : réception après révocation ou suspension | **Haute** (confidentialité) | Correctif localisé, sans migration | Autoriser le correctif ? |
| 2 | I4c : doublon après échec de persistance | **Haute** (intégrité) | Correctif simple (ne pas supprimer la clé) ou complet (transaction commune : architecture) | Quelle option ? |
| 3 | A3 : traversée de chemin dans les clés | Moyenne (latente) | Correctif de quelques lignes | Autoriser ? Mesurer l'existant sur Supabase (requête en lecture) ? |
| 4 | S2 : perte en synchronisation concurrente | Moyenne | Change la sémantique du curseur ; dépend de la déduplication mobile | Valider la stratégie L ; vérifier le mobile d'abord |
| 5 | I4b, I7 : expiration des clés | Moyenne | Correctif plus une tâche de purge V1 | Autoriser ? |
| 6 | I6b : clé réutilisée avec un autre corps | Faible | Correctif sans migration | Autoriser ? |
| 7 | Consentement coopératif (rapport §E) | Haute (métier) | Nouvel endpoint ou nouvelle règle | Décision métier |
| 8 | E8 : vue sécurité Super Admin en 422 (`ACADEMIA_ADMIN`) | Moyenne | Schéma ou rôles | Décision |
| 9 | Retrait V2-V5 | — | Plan en 7 lots ([`PLAN_RETRAIT_V2_V5.md`](PLAN_RETRAIT_V2_V5.md)) | Valider le plan ; trancher X1 à X4 |
| 10 | Commit des travaux | — | Branche dédiée proposée | Autoriser la création de la branche et des commits ? |
| 11 | Ordre des travaux | — | Correctifs de la revue d'abord, ou retrait V2-V5 d'abord | Décision |

**Aucune nouvelle phase de développement n'est engagée.** L'agent attend la revue et l'accord de l'architecte.
