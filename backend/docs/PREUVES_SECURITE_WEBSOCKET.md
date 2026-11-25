# Preuves de sécurité — WebSocket et pièces jointes (lot R2)

**Date :** 25 novembre 2026 · **Banc :** PostgreSQL **embarqué** jetable, faux GoTrue, vrais WebSockets (protocole Socket.IO v4 sur `ws`) contre `attachRealtime`. **Ce n'est pas Supabase réel.** Aucune affirmation ci-dessous ne vaut validation de production.

**Journaux :** `preuves/logs/03-revueContradictoireV1.log` (W6 à W10, A1 à A5), `04-realtimeStabilisation.log` (W1 à W5), `07-contre-epreuve-code-origine.log` (code d'origine).
**Recettes :** `tests/e2e/revueContradictoireV1.e2e.test.mjs`, `tests/e2e/realtimeStabilisation.e2e.test.mjs`.

Lecture du journal : `✔` = conforme, `⚠ … # ANOMALIE` = test `todo` qui affirme le comportement attendu et échoue ; le message d'échec donne le comportement observé.

## 1. Synthèse

| ID | Scénario | Attendu | Observé | Test (journal) | Verdict |
|---|---|---|---|---|---|
| W1 | Charge utile `null` (`typing`, `conversation:join`, `conversation:leave`, `send_message`) | Ignorée ou refusée, sans exception | Aucune exception ; `send_message` → `INVALID_PAYLOAD` ; `join` → `MISSING_ID` | R2 (04) | Conforme |
| W2 | Accusé qui n'est pas une fonction (`ping:app` avec une chaîne, `send_message` avec une chaîne en dernier argument) | Ignoré | Aucune exception ; serveur toujours joignable (`ping:app` répond) | R2 (04) | Conforme |
| W3 | Exception synchrone dans un écouteur | Capturée, journalisée | Capturée (`ecouteurProtege`) ; 0 `uncaughtException` | R2 (04) | Conforme |
| W4 | Rejet asynchrone dans un écouteur | Capturé | Capturé ; 0 `unhandledRejection` | R2 (04) | Conforme |
| W5 | Compte suspendu après la connexion | Refus et coupure du socket | `UNAUTHORIZED`, socket fermé, 0 message persisté | R3 (04) | Conforme |
| W6 | Adhésion révoquée après la connexion | Refus d'envoi et d'adhésion à la room | `send_message` → `NOT_FOUND`, `join` → `FORBIDDEN`, 0 message | W6 (03) | Conforme |
| W7 | Conversation d'un autre tenant | Invisible | Socket : `NOT_FOUND` / `FORBIDDEN` ; REST : 404 ; 0 message | W7 (03) | Conforme |
| W8 | Changement d'organisation active | Message attribué à une organisation **participante** | Sans choix : organisation participante retenue (`senderOrgId` = coopérative) ; choix d'une organisation non participante → `NOT_FOUND` | W8 (03) | Conforme |
| W9 | Organisation non autorisée (celle d'un tiers) | Refus, rien d'écrit | `NOT_FOUND`, 0 message | W8+W9 (03) | Conforme |
| W10 | Rôle sans `messages.write` (INVESTOR) | Refus socket et REST | `PERMISSION_DENIED` ; REST 403 | W10 (03) | Conforme |
| **W11** | **Réception** après révocation de l'adhésion (socket déjà connecté) | Plus aucun contenu reçu | **1 message reçu avec son contenu** | W11 `todo` (03) | **ANOMALIE** |
| **W12** | **Réception** après suspension du compte (socket déjà connecté) | Plus aucun contenu reçu | **1 message reçu avec son contenu** | W12 `todo` (03) | **ANOMALIE** |
| A1 | Clé de stockage d'une autre organisation | Refus | REST 422 `foreign_storage_key` ; socket `VALIDATION_ERROR` | A1 (03) | Conforme |
| A2 | Clés malformées (espace, `<script>`, vide, > 500 caractères, nombre, caractère accentué) | 422 | 422 pour les 6 | A2 (03) | Conforme |
| **A3** | **Traversée de chemin** `<org>/../<autre org>/documents/…` | 422 | **201** ; clé transmise **telle quelle** à `createSignedUrls` | A3 `todo` (03) | **ANOMALIE** |
| A4 | Accès après retrait d'un participant | Plus d'accès au fil ni aux pièces | REST 404 ; synchronisation : 0 message livré | A4 (03) | Conforme |
| A5 | Expiration et renouvellement des URL signées | TTL de configuration ; URL neuve à chaque lecture | TTL = `SIGNED_URL_TTL_SECONDS` (300 s) ; URL différente à chaque lecture ; bucket `media` ; clé stable dans `remote_media_url` | A5 (03) | Conforme **pour la partie backend** (voir §3) |

**Contre-épreuve :** sur le code d'origine (`HEAD`), la recette 04 échoue **7/7**. Le journal 07 relève 3 `uncaughtException`, dont `TypeError: Cannot destructure property 'conversationId' of 'payload' as it is null` et `TypeError: ack is not a function`.

## 2. Scénarios conformes — mécanisme et emplacement

| ID | Fichier et ligne | Mécanisme |
|---|---|---|
| W1-W4 | `src/realtime/index.js:85` (`ecouteurProtege`) ; enregistrements l. 163, 189, 210, 217, 263 | Charge utile ramenée à un objet, accusé ramené à une fonction, erreurs synchrones et asynchrones capturées. Corrige D7 : Socket.IO 4.8 appelle les écouteurs dans un `process.nextTick` sans try/catch (`node_modules/socket.io/dist/socket.js:685`) et `server.js` traite une `uncaughtException` par `shutdown()`. |
| W5, W6 | `src/realtime/index.js:42` (`chargerProfilActif`), l. 179 (`profilCourant`) | Profil et adhésions **relus** à chaque `send_message` et `conversation:join` (même requête que `authenticate`). |
| W7, W8, W9 | `src/realtime/sendGuard.js:43-70` | Seules les adhésions dont l'organisation participe au fil sont candidates ; `organizationId` demandé filtré parmi elles ; aucune candidate → `NOT_FOUND`, comme en REST. |
| W10 | `src/realtime/sendGuard.js:70` | `can(rolesEffectifs, 'messages.write')`, rôles du tenant retenu. |
| A1, A2 | `src/modules/messaging/messaging.service.js:173-195` (`assertAttachments`) | Liste fermée de caractères, longueur ≤ 500, préfixe de l'organisation expéditrice. |
| A4 | `messaging.service.js` (`listMessages`, `deltaSync`) et `retirerOrganisationDuFil` (l. 396) | Lecture et synchronisation bornées à `participantOrgIds`, sortie de room immédiate. |
| A5 | `messaging.service.js:208-240` (`signerPiecesJointes`), l. 226 | Signature à chaque lecture avec `env.SIGNED_URL_TTL_SECONDS` ; uniquement les clés d'organisations participantes. |

## 3. Anomalie A3 — traversée de chemin dans les clés de pièces jointes

| Rubrique | Contenu |
|---|---|
| **Identifiant** | A3 |
| **Fichier et ligne** | `src/modules/messaging/messaging.service.js:181` (liste de caractères autorisés) et `:188` (contrôle de préfixe) ; signature : `:213` |
| **Cause** | Le motif `^[A-Za-z0-9._\-/]+$` autorise `.` et `/`, donc `..`. Le contrôle d'appartenance est un simple `startsWith("<org>/")`. Une clé `<orgA>/../<orgB>/documents/x.pdf` passe les deux contrôles, est stockée, puis transmise à `createSignedUrls` pour chaque lecteur du fil. |
| **Risque** | Si le stockage normalise `..`, l'expéditeur obtient une **URL signée vers un document privé d'une autre organisation** (documents de vérification, pièces justificatives). **Non vérifié contre Supabase Storage réel** : selon la normalisation appliquée par le stockage, le risque va de nul (clé littérale inexistante) à une fuite inter-tenant. Les clés légitimes, générées par le serveur (`storageKey()` dans `src/shared/crypto.js:36`), ne contiennent jamais `..`. |
| **Attendu** | 422 pour toute clé contenant un segment `.` ou `..`, ou un `/` doublé. |
| **Observé** | `observé 201 pour 01M89499…/../01M8949A…/documents/2026-11/secret.pdf ; clés transmises à la signature : ["01M89499…/../01M8949A…/documents/2026-11/secret.pdf"]` (journal 03). |
| **Preuve** | Test `A3` (`todo`), `tests/e2e/revueContradictoireV1.e2e.test.mjs`. |
| **Recommandation** | Dans `assertAttachments` et `signerPiecesJointes`, refuser toute clé dont un segment (`split('/')`) vaut `''`, `.` ou `..`, et n'accepter que la forme produite par `storageKey()` : `<org>/(media|documents)/<AAAA-MM>/<nom>`. Correctif de quelques lignes, sans migration. **Non appliqué** (consigne R1 : aucune modification avant décision). Effet sur les données existantes à mesurer : `SELECT count(*) FROM messages WHERE EXISTS (SELECT 1 FROM unnest(attachments) a WHERE a LIKE '%..%')`, sur Supabase, avec votre autorisation. |

## 4. Anomalies W11 et W12 — réception après révocation ou suspension

| Rubrique | Contenu |
|---|---|
| **Identifiant** | W11 (adhésion révoquée), W12 (compte suspendu) |
| **Fichier et ligne** | `src/realtime/index.js:145-160` (rooms rejointes à la connexion), `:179` (`profilCourant`, appelé seulement par `send_message` et `conversation:join`) ; diffusion : `src/realtime/bus.js` (`emitToConversation`) |
| **Cause** | Les rooms d'organisation et de conversation sont rejointes **une fois**, à la connexion. La correction D8 relit le profil à chaque **action** du client, mais rien ne fait quitter les rooms quand une adhésion est révoquée ou un compte suspendu côté serveur. Le socket reste abonné tant qu'il n'agit pas ou ne se reconnecte pas. Seul le retrait d'un groupe (D4, `retirerOrganisationDuFil`) fait sortir de la room. |
| **Risque** | **Confidentialité.** Un compte suspendu par l'administration, ou un membre exclu d'une organisation, continue de recevoir en temps réel le **contenu** des nouveaux messages de toutes les conversations de cette organisation, sans limite de durée s'il reste connecté sans agir. Le REST, lui, refuse déjà (403 ou 404). |
| **Attendu** | 0 message reçu après la révocation ou la suspension. |
| **Observé** | `observé : 1 message(s) reçu(s) avec leur contenu après révocation` ; `… après suspension` (journal 03). |
| **Preuve** | Tests `W11` et `W12` (`todo`), `tests/e2e/revueContradictoireV1.e2e.test.mjs`. |
| **Recommandation** | Aux points où le serveur change ces états (changement de statut d'un profil et d'une adhésion dans `admin.service.js`, `users.service.js` `deleteMe`, retrait d'un membre de coopérative ou d'organisation), appeler un utilitaire `bus.js` qui déconnecte les sockets de l'utilisateur (`io.in(roomForUser(id)).disconnectSockets(true)`). Le client se reconnecte alors avec ses droits actuels. Filet de sécurité complémentaire : relecture périodique (par exemple toutes les 60 s) du profil des sockets connectés. **Non appliqué** (consigne R1). |

## 5. Limites de ces preuves

- **URL signées (A5) :** le stockage est remplacé par une doublure qui enregistre les appels. Ce qui est prouvé : TTL transmis, nouvelle signature à chaque lecture, bucket, clés limitées aux organisations participantes. Ce qui **n'est pas** prouvé : l'expiration effective d'une URL au bout de 300 s, qui est appliquée par Supabase Storage.
- **Appels audio :** non couverts par R2. LiveKit n'est pas exercé ; seuls le contrôle d'accès et la machine à états le sont (`tests/calls.test.mjs`, journal 06).
- **Charge :** aucun test de montée en charge des sockets.
- **Instantané de connexion :** les rooms rejointes à la connexion proviennent d'un instantané. Seul le retrait d'un groupe les met à jour (D4, A4). Révocation d'adhésion et suspension ne le font pas : voir W11 et W12.
