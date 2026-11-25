# Rapport de stabilisation — Backend V1 (Phase 1)

**Date :** 25 novembre 2026 · **Périmètre :** backend uniquement (`backend/`). Le Web et le Mobile n'ont pas été modifiés ; leurs contrats API ont seulement été lus.
**Base de données :** aucune migration, aucune écriture sur la base Supabase réelle. Toutes les preuves sur base réelle ont tourné sur un PostgreSQL embarqué jetable (voir §H).

Ce document distingue ce qui est **corrigé et prouvé**, ce qui est **constaté mais non corrigé** (décision requise), et ce qui **n'a pas pu être vérifié**.

> **Lot 2 (même jour).** Reprise et vérification du lot 1, puis seconde passe sur la couche temps réel, la messagerie et la synchronisation hors ligne V1. Nouveaux constats : D7 à D9, E9 à E11. Le plus grave, **D7**, permettait à **tout utilisateur connecté d'arrêter l'API** avec un seul événement WebSocket. Deux affirmations du lot 1 étaient inexactes et sont corrigées ici : le script `test:hors-v1` n'existait pas, et les nouvelles suites n'étaient appelées par aucun script npm. Périmètre strictement V1 : aucun module V2 à V5 n'a été modifié.

> **Revue contradictoire R1-R3 (même jour) : certaines conclusions ci-dessous sont nuancées.** D8 et E11 ne sont que **partiels**, et une perte de synchronisation en concurrence subsiste. Voir [`REVUE_CONTRADICTOIRE_BACKEND_V1.md`](REVUE_CONTRADICTOIRE_BACKEND_V1.md) §4.

---

## A. État initial

| Élément | Constat |
|---|---|
| Dépôt | `main`, arbre propre, dernier commit `d781d9e`. |
| Modules montés | 24 modules, **181 routes** réellement montées (inventaire runtime de la pile Express). La documentation (`PERIMETRE-BACKEND.md`, `/api/v1/docs`) annonce encore 44 modules / 385 routes et une portée « V1 → V5 » : elle décrit la base d'avant la découpe V1 (commit `e10e28c`). |
| Schéma | 110 modèles Prisma, 24 migrations — schéma complet V1→V5 conservé, tables V2+ présentes mais non exposées. |
| Tests unitaires (`npm test`, hors e2e) | 72 fichiers : **505 réussis, 41 échecs**. 33 fichiers échouent au chargement ou partiellement parce qu'ils testent des modules V2-V5 retirés (marketplace, alertes, IoT, satellite, IA…). Les vrais résultats V1 étaient noyés dans ce bruit. |
| Banc e2e | Fonctionne sous Windows (PostgreSQL embarqué). Parcours `journeys` : 11/17, les 6 échecs étant tous des parcours V2-V5. |

## B. Conformité V1 (CDC V1 §3) — état réel après intervention

| Réf. | Domaine | État backend | Preuve |
|---|---|---|---|
| V1-F02 | Authentification, profils, session, MFA, OTP | Opérationnel (couvert par les recettes existantes ; non retouché sauf `syncProfile`) | `authShortcut`, `mfa*`, `profileSettings`, e2e `mfaLogin`, `verifyEmail`, `otpVerification` |
| V1-F03 | Organisations | **Corrigé** : `PATCH /organizations/:id` répondait 404 à tout le monde | e2e `stabilisationV1` |
| V1-F04 | Rôles et permissions côté serveur | Conforme ; 3 corrections (voir §C) | inventaire runtime, tests RBAC |
| V1-F05→F09 | Producteurs, exploitations, parcelles, cultures, productions | Conforme : isolation tenant par `assertOwnership` vérifiée service par service | `req-v1` (50/50) |
| V1-F10 | Coopératives (fondations) | **Corrigé** (agrégation hors consentement) ; **décision requise** sur le consentement (§E) | e2e `stabilisationV1`, `req-v1` COOP-05 |
| V1-F12 | Fondations Academia | Rôles et permissions présents dans la matrice, aucun module monté — conforme au CDC V1 (fondations seulement) | `permissions.js` |
| — | Communication (hors CDC V1, préservée) | **Stabilisée** (§F) | tests dédiés |

Exigence hors V1 constatée mais **non** traitée (normal) : `GET /orders` répond 404 parce que le module commandes est V2 ; l'appel vient du Web (`mess.md`) et relève de la phase frontend.

## C. Rôles et permissions

**Méthode.** Inventaire **runtime** : la pile Express réelle est parcourue et, pour chacune des 181 routes, la chaîne de gardes effective est relevée (`authenticate`, `resolveTenant`, `authorize`, `requireSuperAdmin`…). Résultat : toute route non publique exige un jeton ; celles qui n'exigent que l'authentification portent sur soi (`/me`, MFA, déconnexion, appareils push). Les mutations de gouvernance (rôles, suppression de compte, feature flags, politique de sécurité, pause des tâches) passent par `requireSuperAdmin` + preuve MFA de session. Garde d'acteur (un ADMIN n'agit pas sur un SUPER_ADMIN) et protection du dernier SUPER_ADMIN vérifiées dans `admin.service.js`.

| # | Problème | Gravité | Correction |
|---|---|---|---|
| C1 | **H-07 perdu à la découpe V1** : `requireVerifiedForWrites` était défini mais monté nulle part. Un compte sans e-mail ni téléphone vérifié pouvait écrire des messages, créer des groupes, lancer des appels. | Haute | Garde rétablie sur `/messaging` et `/calls` (`routes/index.js`). `POST /messaging/sync`, qui est une lecture, en est exempté. |
| C2 | `GET /verifications/me` → 403 pour acheteur, fournisseur, transporteur, investisseur, qui ne pouvaient pas lire leur propre statut. | Moyenne | `verifications.read` ouvert à tout compte authentifié ; le service ne lit que l'organisation active. |
| C3 | `POST /media/upload-url` → 403 pour tout acteur non producteur autorisé à écrire des messages : pièce jointe impossible. | Moyenne | Alternative `media.upload` **ou** `messages.write` sur `upload-url` et `confirm`. `media.upload` lui-même n'est **pas** élargi. |
| C4 | Clés `dataproducts.manage` et `data.read` déclarées deux fois. | Faible | Doublon retiré ; test qui l'interdit. |

**À arbitrer (non modifié) :**
- `SUPPORT_AGENT` figure parmi les rôles producteurs (écriture sur exploitations, parcelles, productions). Le code le décrit comme « agent d'appui qui agit pour le compte des producteurs », attribué par un administrateur uniquement ; le CDC général le décrit comme « assistance utilisateurs (tickets) ». Les droits restent limités à l'organisation où le rôle est porté.
- `reports.create` cite un rôle `VISITOR` qui n'existe pas dans l'énumération (`PUBLIC_USER` existe). Sans effet.
- `verifications.create` reste réservé aux producteurs : un acheteur voit ses critères mais ne peut pas déposer de dossier.

## D. Sécurité

| # | Vulnérabilité | Gravité | État |
|---|---|---|---|
| D1 | **Socket `send_message`** : contournait toute la chaîne REST — ni permission, ni compte vérifié, ni Zod — et attribuait le message à la **première** organisation de l'utilisateur, quelle que soit la conversation. Renvoyait aussi les messages d'erreur internes au client. | Haute | Corrigé : `realtime/sendGuard.js` (fonction pure, testée) applique les mêmes règles que le REST ; seules les erreurs métier sont renvoyées. |
| D2 | **Réémission `localTempId`** : le message existant était renvoyé **avant** le contrôle de participation ; une collision d'identifiant entre deux fils donnait un 500. | Moyenne | Corrigé : contrôle d'accès d'abord, réémission réservée au même expéditeur dans le même fil, collision → 409, format vérifié. |
| D3 | **Pièces jointes** : une clé de stockage arbitraire était acceptée. Combinée à la signature des pièces jointes (D5), cela aurait permis d'obtenir l'URL signée d'un document privé d'une autre organisation. | Haute (latente) | Corrigé : une clé doit commencer par le préfixe de l'organisation de l'expéditeur. |
| D4 | **Membre retiré d'un groupe** : restait dans la room Socket.IO et recevait le contenu des nouveaux messages jusqu'à sa déconnexion. | Moyenne | Corrigé : sortie de room à la volée (`retirerOrganisationDuFil`), sauf pour une session qui appartient aussi à une organisation restante ; audit du retrait. |
| D5 | **Dossier de vérification au nom d'autrui** : `subjectId` libre pour PROFILE / ORGANIZATION / COOPERATIVE. La vraie personne était ensuite bloquée (409, « demande déjà en cours »). | Moyenne | Corrigé : sujet borné à soi ou à l'organisation active ; 404 sinon. |
| D6 | `syncProfile` : `locale` des métadonnées Supabase stockée sans contrôle. | Faible | Liste fermée `fr` / `en`. |
| D7 | **Arrêt du serveur par un client** : Socket.IO 4.8 appelle les écouteurs dans un `process.nextTick` sans try/catch. `typing`, `conversation:join` ou `conversation:leave` avec une charge utile `null` (la valeur par défaut `= {}` ne s'applique pas à `null`), ou `ping:app` avec un argument qui n'est pas une fonction, levaient une `uncaughtException` que `server.js` traite par `shutdown()`. **Un seul événement d'un compte quelconque arrêtait l'API pour tous.** `send_message` renvoyait en outre au client le texte de l'exception interne. | **Critique** | Corrigé : `ecouteurProtege()` (`realtime/index.js`) ramène la charge utile à un objet et l'accusé à une fonction, et capture les erreurs synchrones et asynchrones. Preuve sur le code d'origine : `TypeError: Cannot destructure property 'conversationId' of 'payload' as it is null` et `TypeError: ack is not a function`, relevées en `uncaughtException`. |
| D8 | **Droits socket figés à la connexion** : statut du compte, adhésions et rôles n'étaient lus qu'à la poignée de main. Un compte suspendu, ou une organisation retirée, continuait d'envoyer et de rejoindre des fils par WebSocket jusqu'à la reconnexion, alors que le REST le refusait déjà. | Moyenne | Corrigé : `send_message` et `conversation:join` relisent le profil (`chargerProfilActif`, même requête que `authenticate`). Compte inactif → `UNAUTHORIZED` et coupure du socket. |
| D9 | **Événements perdus à la connexion** : le gestionnaire `connection` attendait le chargement des rooms avant d'enregistrer ses écouteurs. Un événement reçu dans cet intervalle était abandonné sans accusé. C'est le cas du moteur hors ligne mobile, qui vide sa file d'envoi dès la reconnexion. | Moyenne | Corrigé : écouteurs enregistrés avant toute attente ; `ready` reste émis une fois les rooms chargées. |

Contrôlé sans anomalie : `authenticate` (profil `ACTIVE` exigé à chaque requête), isolation des rôles par tenant (H-03), verrouillage de connexion, plafonds OTP, `syncProfile` (toujours `FARMER`, jamais un rôle issu des métadonnées), webhook LiveKit à signature vérifiée, appels (participation, machine à états, jetons délivrés par le serveur), CORS, Helmet, limitation de débit, `updateMe` en `.strict()`.

## E. Logique métier

| # | Défaut | Correction |
|---|---|---|
| E1 | `PATCH /organizations/:id` : `assertOwnership` compare `resource.organizationId`, champ absent du modèle `Organization` → **404 systématique**. Le Web appelle cette route. | Comparaison sur `organization.id` = organisation active. |
| E2 | **Vue coopérative** (`overview`) : pour chaque membre, l'agrégation retenait une organisation arbitraire parmi ses adhésions (entreprise employeuse, coopérative elle-même) : des parcelles **hors consentement** étaient comptées. | Agrégation limitée à l'organisation `INDIVIDUAL` du membre (CDC D2). Prouvé : 2 ha agrégés, et non 52. Le même défaut existe dans les **offres groupées** (`groupoffers.service.js`) : fonction commerciale non établie en V1 (CDC V1 §3.10), **non modifiée** à dessein. |
| E3 | Médias : `kind: AUDIO` envoyé tel quel à l'énumération `MediaKind` (PHOTO/VIDEO) → **note vocale impossible** ; `kind: IMAGE`, envoyé par le Web et le mobile → 422. | Alias `IMAGE` → `PHOTO` ; conversion explicite vers l'énumération existante (le type réel reste porté par `mimeType`). **Aucune migration.** |
| E4 | Médias : bucket choisi selon `kind` au dépôt mais selon le MIME à la confirmation → URL signée sur le mauvais bucket. | Bucket déduit de la clé, identique aux deux étapes. |
| E5 | Contrat médias : clients en attente de `presign.data.media.id`, backend renvoyant `mediaId` → plantage côté client. | Ajout de `media: { id, storageKey }` ; `mediaId` conservé. |
| E6 | `deleteMe` : deux écritures hors transaction. | Transaction unique. |
| E7 | Tâches planifiées : `iot.markSilent`, `recommendations.monitor`, `alerts.escalate` sont des bouchons qui renvoient des compteurs à zéro, présentés comme des exécutions réussies dans l'administration. | **Non modifié** : ces tâches relèvent de la V3. Signalé seulement. |
| E8 | **Vue sécurité Super Admin cassée** : `GET /admin/security/overview` répond 422 « Requête base de données invalide ». Cause : `GOVERNANCE_ROLES` contient `ACADEMIA_ADMIN`, déclaré dans `schema.prisma` mais **absent des 24 migrations et du client Prisma généré** (dérive de schéma). | **Non corrigé — décision requise** : la correction touche les rôles Academia ou le schéma. Détecté par `tests/e2e/adminSecurity.e2e.test.mjs` (2 échecs), défaut préexistant, indépendant de cette intervention. |
| E9 | **Groupes fusionnés** : `createGroup` passait par `ensureBusinessConversation`, qui cherche un fil *contenant* les participants (`hasEvery`). Créer « Famille » avec A et B renvoyait le « Famille » d'un autre administrateur qui contenait aussi C : les messages partaient à un membre que le créateur n'avait pas choisi. | Un groupe n'est rejoué que s'il est identique (même nom, même administrateur, mêmes membres, protection contre le double envoi) ; sinon il est créé, avec audit `conversation.create`. Format `subjectId = GRP:<nom>` inchangé. |
| E10 | `POST /messaging/conversations` avec `subjectType` `FARM`, `ORGANIZATION` ou `COOPERATIVE` (acceptés par le schéma Zod) → **500**, car ces types n'ont aucun modèle associé (`prisma[undefined]`). | 422 `VALIDATION_ERROR` explicite (`subjectType: unsupported`). Aucune règle de parties n'est inventée pour ces objets. |
| E11 | **Doublons à la synchronisation** : le mobile envoie `Idempotency-Key` sur `POST /farms`, `/plots` et `/productions`, mais le backend l'ignorait. Une création renvoyée après une coupure réseau était **dupliquée** (CDC général §42 ; CDC V1 §5.1, règle 8). | Middleware existant `idempotency()` monté en mode **facultatif** sur ces trois créations et sur `POST /plots/:id/crop-history` : avec clé, rejeu de la réponse (cloisonné par utilisateur) ; sans clé, comportement inchangé, le Web ne reçoit aucun 400. Table `idempotency_keys` existante, **aucune migration**. |
| E12 | **Complétude du profil (PROF-03)** : le critère « profil professionnel » était réclamé à **tous** les comptes (producteur, acheteur, transporteur, investisseur). Ces comptes ne pouvaient jamais atteindre 100 %. Les recettes `completenessByRole` (COMPLETE-01 à 04, 06) échouaient pour cette raison. | Critère limité à l'agronome, le seul rôle établi par les recettes (COMPLETE-05, 07). **À confirmer** : faut-il l'étendre à `LAB_PARTNER`, `SUPPLIER`, etc. ? |

**Décision requise — consentement coopératif (non modifié).** Un `COOPERATIVE_ADMIN` invite n'importe quel compte par e-mail ou téléphone **en choisissant lui-même les portées de consentement** (`plots`, `productions`, `soil`), puis le passe à `ACTIVE`. Le producteur n'accepte jamais rien : **aucun parcours d'acceptation n'existe côté membre**. Corriger exige soit un nouvel endpoint d'acceptation (interdit sans validation par le CDC V1 §3.10), soit de bloquer l'activation (ce qui rendrait la coopérative inutilisable). Je n'ai donc rien modifié et je soumets ce point à arbitrage.

## F. Module de communication (hors CDC V1, préservé)

Aucun élément supprimé, aucune architecture remplacée. Structure constatée : REST `/messaging` (fils DIRECT / GROUP / objets métier, contacts limités au pays, groupes, signalement, archivage, blocage par modération, `POST /sync` hors ligne), Socket.IO `/realtime` (authentification par jeton Supabase, rooms par utilisateur, organisation et conversation, `typing`, `conversation:join`, `send_message`), appels audio LiveKit `/calls` + webhook signé.

Corrections : D1, D2, D3, D4, C1, C3, E3-E5 (pièces jointes), plus :
- **Synchronisation hors ligne** : `deltaSync` plafonnait à 500 messages mais renvoyait `serverTimestamp = maintenant`. Un mobile resté longtemps hors ligne **perdait définitivement** les messages au-delà de 500. Le curseur est désormais la date du dernier message livré, avec `hasMore`, et la coupure ne sépare jamais deux messages de la même milliseconde.
- **Affichage des pièces jointes pour le destinataire** : les fils renvoyaient la clé de stockage brute ou une URL signée déjà expirée (300 s). Ajout de `attachmentUrls` (REST, temps réel) et `attachment_urls` (sync), URL fraîches signées à la lecture, uniquement pour les clés des organisations participantes. Ces deux champs sont des **ajouts** : `attachments` et `remote_media_url` restent la référence stable.
- Membre ajouté à un groupe : notifié (`conversation:new`) pour rejoindre la room.
- Lot 2 : D7 (arrêt du serveur), D8 (droits relus à chaque envoi), D9 (événements perdus à la connexion), E9 (groupes fusionnés), E10 (500). Contrat d'événements inchangé (`send_message`, `conversation:join`, `typing`, `ping:app`, `ready`) ; seul `UNAUTHORIZED` s'ajoute aux codes de refus.

**Reste à vérifier en phases Web/Mobile** : affichage de `attachmentUrls`, consommation de `hasMore` par `OfflineSyncEngine`, choix de l'organisation dans `send_message` (`organizationId` facultatif), appels audio sur appareils réels (LiveKit non exercé ici).

**Non traité, à arbitrer :** `archiveConversation` archive le fil pour **tous** les participants ; dans un groupe, n'importe quel membre peut ainsi le fermer.

## G. Fichiers modifiés

| Fichier | Motif |
|---|---|
| `src/routes/index.js` | C1 (H-07) |
| `src/shared/permissions.js` | C2, C4 |
| `src/realtime/sendGuard.js` *(nouveau)* | D1 — garde d'envoi socket, fonction pure |
| `src/realtime/index.js` | D1 |
| `src/realtime/bus.js` | D4 |
| `src/modules/messaging/messaging.service.js` | D2, D3, D4, sync, `attachmentUrls`, notification d'ajout |
| `src/modules/media/media.routes.js` · `media.schema.js` · `media.service.js` | C3, E3, E4, E5 |
| `src/modules/verification/verification.service.js` | D5 |
| `src/modules/organizations/organizations.service.js` | E1 |
| `src/modules/cooperatives/cooperatives.service.js` | E2 |
| `src/modules/auth/auth.service.js` | D6 |
| `src/modules/users/users.service.js` | E6 |
| `tests/stabilisationV1.test.mjs` *(nouveau, 19 tests)* | preuves unitaires |
| `tests/e2e/stabilisationV1.e2e.test.mjs` *(nouveau, 6 tests)* | preuves sur PostgreSQL réel |
| `tests/messaging.integration.test.mjs` | données de test alignées sur D3 + cas de refus ajouté |
| `tests/req-v1.integration.test.mjs` | COOP-05 (données), SEC-12 (visait `/orders`, V2), NFR-06 (bug du test si planificateur désactivé) |
| `tests/jobs.integration.test.mjs` | IOT-03 ignoré avec motif (V3) ; planificateur ignoré seulement si `JOBS_ENABLED=false` |
| `src/realtime/index.js` *(lot 2)* | D7, D8, D9 |
| `src/modules/messaging/messaging.service.js` *(lot 2)* | E9, E10 |
| `src/middleware/idempotency.js` | E11 — option `facultatif` (comportement par défaut inchangé) |
| `src/modules/farms/farms.routes.js` · `plots/plots.routes.js` · `productions/productions.routes.js` | E11 |
| `src/modules/users/users.service.js` *(lot 2)* | E12 |
| `tests/e2e/realtimeStabilisation.e2e.test.mjs` *(nouveau, 7 tests)* | preuves D7-D9, D4, E9-E11 par vrais WebSockets et PostgreSQL réel |
| `package.json` | les 3 nouvelles suites ajoutées à `test`, `test:unit`, `test:dbless` et `test:e2e` (aucune autre modification ; le script `test:hors-v1` annoncé au lot 1 n'a **pas** été créé) |

## H. Tests exécutés

Machine : Windows 11, Node 26.13.0. Base : PostgreSQL embarqué (binaires `embedded-postgres`), schéma appliqué par les 24 migrations du dépôt. **Isolation vérifiée** : `prisma migrate status` lancé depuis `backend/` avec `DATABASE_URL` pointé sur `127.0.0.1:1` cible bien `127.0.0.1:1`, la variable d'environnement l'emporte sur `.env`. Le banc n'a donc jamais touché Supabase. (Le commentaire de `scripts/check-migrations.mjs`, qui affirme le contraire, est inexact.)

**Tests unitaires du lot 1**, fichier par fichier (fichiers unitaires seulement, hors recettes e2e) :

| | Avant | Après lot 1 |
|---|---|---|
| Réussis | 505 | **522** (dont 19 nouveaux) |
| Échecs dans des fichiers V1 | 7 (`req-v1` ×2, `jobs` ×2, `adminOperations` ×3) | 3 (`adminOperations` ×3) : ces tests exercent la modération d'annonces, fonction V2 désactivée (« V2 désactivé »). Le lot 1 les comptait à tort comme corrigés. |
| Échecs dans des fichiers dépendant de modules V2-V5 absents | 34 | inchangé. **Rectificatif** : le script `test:hors-v1` annoncé n'a jamais été créé ; ces fichiers restent dans `npm test`. |

**Suite complète `npm test`, lot 2** (894 tests ; `npm test` inclut aussi des recettes e2e) :

| | Début du lot 2 | Fin du lot 2 |
|---|---|---|
| Réussis | 637 | **642** |
| Échecs | 255 | **250** |

Les 250 échecs restants ont été classés un par un selon leur première cause (script de classement appliqué au journal final) :

| Cause | Échecs |
|---|---|
| Route V2 à V5 non montée en V1 (404 « Route introuvable ») | 177 |
| Fichier qui importe un module V2 à V5 retiré (`channels`, `iot`, `transport`…) ou fonction V2 désactivée | 45 |
| Autres recettes V2 à V5 (moteur Python GeoAI non lancé, règles agronomiques, imports géospatiaux, SMS d'alerte) | 9 |
| Fichiers V1 : `adminOperations` ×5 (annonces V2 : `POST /listings` absent, « V2 désactivé ») · `journeys` ×6 (marketplace, traçabilité, data room, clés d'API, synchronisation générique, tâche V2) · `adminSecurity` ×2 (E8, décision requise) · `surfacePublique` ×4 et `webLinks` ×2 (références calées sur le routeur V5, risque 11) | 19 |

**Aucun échec restant n'a pour cause un défaut de code V1 non documenté.**

**Contre-épreuves** (les tests mordent réellement) :
- version d'origine de `messaging.service.js` : 5 des 6 tests M1/M2 échouent (le 6ᵉ est la non-régression « même expéditeur ») ;
- **tout `src/` d'origine** (stash) : la recette e2e `stabilisationV1` échoue **6/6** ; avec les correctifs, **6/6** réussissent.

**Contre-épreuves du lot 2** (code d'origine `HEAD` restauré le temps du test, puis remis) :
- `realtimeStabilisation` contre `realtime/index.js` et `messaging.service.js` d'origine : **0/5 réussis** (avec les correctifs : 5/5). R2 seul relève sur le code d'origine `TypeError: Cannot destructure property 'conversationId' of 'payload' as it is null` et `TypeError: ack is not a function` en `uncaughtException`, ce qui démontre D7 ;
- I1 contre `farms.routes.js` d'origine : échoue (« même exploitation renvoyée ») : le renvoi créait un doublon ;
- E12 : les 5 échecs `completenessByRole` de la suite initiale disparaissent avec la correction.

**Recettes e2e V1**, PostgreSQL réel, exécutées sur le code final :

| Recette | Résultat |
|---|---|
| `realtimeStabilisation` (nouvelle) | **7/7** |
| `stabilisationV1` | **6/6** |
| `auditLot3`, `calls`, `push`, `stabilisationV1` (passage groupé) | **33/33** |
| `completenessByRole` + `profileSettings` | **12/12** |
| Messagerie, appels, stabilisation (unitaires : `stabilisationV1`, `messaging.integration`, `messagingConfig`, `calls`) | **78/78** |
| `mfaLogin`, `verifyEmail`, `otpVerification`, `adminUsers`, `adminSettings`, `adminMonitoring`, `adminNotifications` (dans `npm test`) | sans échec |

**Contrôles statiques** : `check` OK ; `check:fields` 0 problème ; `check:perms` 0 permission manquante ; `check:mounts` 0 collision. `check:trace` signale à tort les modules V1 comme non montés : son analyseur n'accepte que les guillemets simples et `routes/index.js` utilise des doubles. Défaut d'outil, préexistant.

**Non exécuté** : `npm run verify` dans son ensemble (il inclut `smoke`, qui démarre le serveur sur la configuration `.env`, donc sur Supabase réel) ; `test:geoai` (Python, hors V1) ; aucun appel réel à Supabase Storage, LiveKit, Twilio ni e-mail.

## I. Risques résiduels

1. **Consentement coopératif** (§E) : décision métier requise. Risque de confidentialité tant qu'elle n'est pas prise.
2. **Contrat OpenAPI publié** (`/api/v1/docs/openapi.json`) : il documente **260 opérations V2-V5 inexistantes** en V1 (`check:mounts`), et `/api/v1/docs` annonce la version 5.0.0 et des routes publiques absentes. Régénérer le contrat le réduirait à la V1 ; je ne l'ai pas fait sans votre accord, car les équipes V2 peuvent s'en servir.
3. **Comptes non vérifiés** : le rétablissement de H-07 refuse désormais l'écriture de messages et d'appels aux comptes sans e-mail ni téléphone vérifié. Si la base réelle contient de tels comptes actifs en messagerie, ils recevront un 403 `accountNotVerified`. Je n'ai pas pu le mesurer, la base n'ayant pas été interrogée.
4. **URL signées** des pièces jointes valables `SIGNED_URL_TTL_SECONDS` (300 s) : le client doit relire le fil pour les renouveler.
5. **Stockage, LiveKit, SMS et e-mail jamais exercés en réel** ; la signature des pièces jointes est prouvée dans son contrôle d'accès, pas contre un vrai bucket.
6. Idempotence : appliquée depuis le lot 2 aux créations d'exploitations, de parcelles, de productions et d'historique cultural (E11). **À vérifier en phase Mobile** : `http.ts` génère la clé dans l'intercepteur ; elle ne protège que si une nouvelle tentative réutilise la même configuration de requête, et pas si la file hors ligne reconstruit l'appel. Sans en-tête, un renvoi portant le même `id` client répond toujours 409 au lieu de rejouer.
7. Documentation existante (`PERIMETRE-BACKEND.md`, `/docs`) décalée par rapport à la V1 réelle (385 → 181 routes).
8. Synchronisation différée des messages : quand la page n'est pas pleine, le curseur reste `Date.now()` calculé avant la requête. Un message dont la transaction se termine pendant la lecture peut être manqué. Fenêtre de quelques millisecondes, non corrigée (le corriger change la sémantique du curseur côté client).
9. `listContacts` expose nom et prénom des membres de toutes les organisations du pays (100 au plus) à tout compte autorisé à lire les messages. Comportement existant, conservé ; à valider au regard du CDC §35 (données personnelles).
10. Bancs e2e : la toute première connexion WebSocket d'un processus de test prend 18 à 38 s, sur le code d'origine comme sur le code corrigé. Cause non identifiée (environnement de test Windows) ; les connexions suivantes prennent moins d'une seconde.
11. **Références de tests calées sur le routeur V5** : `surfacePublique` (seuil ≥ 340 routes en 401, référence `fixtures/surface-anonyme.json`) et `webLinks` (« routeur web anormalement petit ») échouent parce qu'ils attendent les 385 routes V1 à V5. Analyse faite route par route : sur 282 écarts, 275 sont des routes V2 à V5 retirées et 7 des routes V1 absentes de la référence, toutes protégées (401) ou 404. **Aucune route n'est devenue anonyme.** Régénérer la référence (`node tests/e2e/anonyme.probe.mjs`) est une décision de gouvernance de sécurité, non prise sans votre accord.

## J. Verdict

Le backend V1 est **stabilisé dans son périmètre**. Les défauts bloquants et de sécurité identifiés sont corrigés, et chaque correction est prouvée par un test qui **échoue sur le code d'origine**. Le défaut le plus grave de la mission, D7, permettait à n'importe quel compte d'arrêter l'API d'un seul événement WebSocket : il est corrigé et verrouillé par une recette sur vrais sockets.

Le backend **peut passer à la phase Web/Mobile**, sous réserve de ces décisions :

| Décision | Section | Bloquante ? |
|---|---|---|
| Consentement coopératif : aucun parcours d'acceptation côté membre | E | Oui, pour une mise en service réelle des coopératives (confidentialité) |
| Vue sécurité Super Admin en 422 (`ACADEMIA_ADMIN` absent des migrations) | E8 | Non pour le Web/Mobile ; oui pour le jalon I5 |
| Contrat OpenAPI : 260 opérations V2 à V5 documentées sans implémentation | I-2 | Non, mais il trompe les intégrateurs |
| Références de tests de sécurité calées sur V5 (`surfacePublique`, `webLinks`) | I-11 | Non ; à régénérer pour retrouver un contrôle utile |
| Rôles soumis au critère « profil professionnel » | E12 | Non |

Ce verdict **ne vaut pas validation en conditions réelles** : ni la base Supabase, ni le stockage, ni LiveKit, ni les fournisseurs SMS et e-mail n'ont été exercés. Les appels audio ne sont vérifiés que dans leur contrôle d'accès et leur machine à états. Aucune migration n'a été créée ni appliquée.
