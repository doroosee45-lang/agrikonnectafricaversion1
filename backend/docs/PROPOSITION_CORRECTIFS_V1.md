# Proposition technique — correctifs W11/W12, A3, idempotence et synchronisation

**Date :** 25 novembre 2026 · **Pour :** architecte (autorisation) · **Statut : PROPOSITION. Aucune modification fonctionnelle effectuée.**
Répond à la « Décision architecturale — revue R1 à R3 », §7, points 1 à 6.

---

## 1. État Git sécurisé

| Élément | Valeur |
|---|---|
| Branche | `stabilisation/backend-v1` (créée depuis `main`) — **aucune fusion** |
| Commit de base | `d781d9e8b848de409f9e49f24593f222294361b5` (`main`, inchangé) |
| Commit 1 — code | `444a17193026cdc2865061e77784779bfe24d9a0` — `fix(backend-v1): stabilisation lots 1 et 2` (18 fichiers `backend/src`) |
| Commit 2 — tests | `736c333b4fd83622b6222bd18e679a8775b9a0f4` — `test(backend-v1): recettes de stabilisation et de revue contradictoire` (tests et `package.json`) |
| Commit 3 — documents | `eaf49590c3aafc8c388a93e2d951203d6b0d7753` — `docs(backend-v1): rapports, revue R1-R3, preuves et plan de nettoyage` (rapports, patch, 7 journaux, plans, `.gitignore`) |
| Arbre de travail après les commits | Propre (`git status` vide) |

**Empreintes.** Git normalise les fins de ligne (`core.autocrlf=true`). Les empreintes de la revue (arbre de travail) et du commit diffèrent donc pour les fichiers en CRLF, à contenu identique (vérifié par `cmp` après retrait des `\r`) :

| Fichier | Arbre de travail (revue) | Contenu commité |
|---|---|---|
| `src/realtime/sendGuard.js` | `753c6785…` (CRLF) | `d556e56c…` (LF) |
| `src/realtime/index.js` | `5e1c9be9…` | identique |
| `src/middleware/idempotency.js` | `b5506e66…` | identique |
| `src/modules/messaging/messaging.service.js` | `e8ce4ee9…` (CRLF) | `0ae4c681…` (LF) |

**Incident à déclarer : nettoyage commencé puis annulé.** Après le « tu peux nettoyer » du responsable du projet, et avant réception de votre décision, l'agent avait commencé le nettoyage. Ce qui a été fait :
- `apps/Mobile/.metro-cache/` (9 916 fichiers) et 87 fichiers temporaires retirés ;
- routes V3 retirées de `soil.routes.js` ;
- offres groupées retirées (routes, contrôleur, schéma) ;
- création de `soil/profile.service.js`.

**Tout a été restauré depuis `HEAD` avant les commits**, sauf deux journaux locaux **ignorés par Git, donc jamais versionnés, perdus définitivement** : `test-run.log` (racine, sortie d'un `npm test` antérieur) et `flux/anomalies-seule.log`. Seule modification conservée : l'exception `.gitignore` qui permet de versionner les journaux de preuve (commit 3).

---

## 2. W11 / W12 — réception après révocation ou suspension

### Constat (rappel)
Les rooms Socket.IO sont rejointes une fois, à la connexion. Aucun changement d'état côté serveur ne les fait quitter, sauf le retrait d'un groupe. Un compte suspendu ou une adhésion révoquée continue de **recevoir** le contenu (tests W11, W12, journal `03`).

### Points où l'état change (relevé exhaustif dans le code V1)

| Fonction | Fichier | Effet attendu |
|---|---|---|
| `updateUserStatus` (statut ≠ `ACTIVE`) | `admin.service.js:304` | Couper toutes les sessions temps réel de l'utilisateur |
| `forceLogout` | `admin.service.js:596` | Idem |
| `deleteUser` | `admin.service.js:800` | Idem |
| `deleteMe` | `users.service.js:284` | Idem |
| `revokeRole` | `admin.service.js:761` | Retirer des rooms des organisations où l'utilisateur n'a plus `messages.read` |
| Modification **hors API** (SQL, console Supabase) | — | Filet de sécurité périodique |

Aucune route V1 ne retire une adhésion `Membership` en dehors de `deleteMe` et `deleteUser`. Le retrait d'un membre de coopérative ne modifie que `CooperativeMember`.

### Solution proposée — deux régimes

**Régime 1 : compte inactif → déconnexion.** Nouvel utilitaire `bus.js`, `deconnecterUtilisateur(userId, motif)` : il émet `session:revoked { reason }` vers `roomForUser(userId)`, puis `io.in(roomForUser(userId)).disconnectSockets(true)`. Il est appelé **après** l'écriture réussie dans les 4 premières fonctions. Une reconnexion est refusée par l'authentification socket (profil non `ACTIVE`).

**Régime 2 : droits réduits → sortie de rooms, sans déconnexion.** Pour `revokeRole` : on recalcule les adhésions actives et on fait quitter les rooms d'organisation et de conversation qui ne sont plus justifiées, sur le modèle de `retirerOrganisationDuFil` (D4). **Pourquoi pas une déconnexion :** Socket.IO ne se reconnecte **pas** automatiquement après une déconnexion décidée par le serveur (raison `io server disconnect`). Or les clients Web et Mobile (`services/realtime.ts`) ne gèrent ni ce cas ni `session:revoked`. Un utilisateur dont on retire un seul rôle perdrait le temps réel jusqu'au redémarrage de l'application.

**Filet de sécurité : relecture périodique.** Dans `attachRealtime`, toutes les `REALTIME_RECHECK_MS` (proposé : 60 s), un seul `findMany` regroupe les profils des sockets connectés (statut, adhésions actives). Profil inactif : régime 1. Adhésion disparue : régime 2. Exposition maximale à une modification hors API : 60 s. Coût : une requête par minute et par instance.

### Fichiers concernés
`src/realtime/bus.js`, `src/realtime/index.js`, `src/modules/admin/admin.service.js`, `src/modules/users/users.service.js`, `src/config/env.js` (`REALTIME_RECHECK_MS`, avec valeur par défaut).

### Risques
| Risque | Mesure |
|---|---|
| Plusieurs instances du serveur | Aucun adaptateur Socket.IO partagé n'est configuré : `disconnectSockets` n'atteint que l'instance locale. Le filet périodique couvre chaque instance. À documenter pour un déploiement multi-instances. |
| Charge de la relecture | Une requête groupée par minute ; intervalle configurable |
| Client déconnecté sans explication | `session:revoked` est émis avant la coupure (ajout de contrat, sans rupture) |

### Tests à ajouter
- W11 et W12 : passage de `todo` à tests normaux ;
- déconnexion via les vraies routes REST : `PATCH /admin/users/:id/status`, `POST /admin/users/:id/force-logout`, `DELETE /admin/users/:id`, `DELETE /me` ;
- `revokeRole` : plus de contenu reçu des organisations concernées, **socket toujours connecté** et messages des autres organisations toujours reçus ;
- filet périodique (intervalle réduit en test) après modification directe en base ;
- contre-épreuve sur le code actuel.

---

## 3. A3 — chemins des pièces jointes

### Proposition
Grammaire **unique et stricte** des clés de stockage, identique à celle que produit le serveur (`media.service.js:60-64`, `storageKey(org, 'media'|'documents', AAAA-MM, <uuid>.<ext>)`) :

```
^<orgId assaini>/(media|documents)/\d{4}-\d{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$
```

Elle s'applique :
1. **à l'écriture** (`assertAttachments`, `messaging.service.js:173`) : 422 `invalid_storage_key` ;
2. **à la signature** (`signerPiecesJointes`, l. 208) : une clé non conforme, même déjà stockée, n'est jamais signée (`attachmentUrls` vaut `null`).

La règle « préfixe de l'organisation de l'expéditeur » (D3) est conservée. Les URL `http(s)` restent acceptées, comme aujourd'hui. **Point à arbitrer :** elles permettent d'insérer n'importe quel lien externe dans un message.

### Fichiers
`src/modules/messaging/messaging.service.js` ; constante partagée avec `media.service.js` pour qu'une seule définition fasse foi.

### Risques et impacts
- **Clés existantes non conformes en base** (anciens formats, traversées) : elles ne seraient plus signées. Mesure préalable proposée, **en lecture seule, sur Supabase réel, avec votre autorisation** : `SELECT id, a FROM messages, unnest(attachments) a WHERE a !~ '^https?://' AND a !~ '<grammaire>'`.
- Clients : Web et Mobile n'envoient que des clés issues de `POST /media/upload-url` (`OfflineSyncEngine.ts:173`), donc conformes. Aucune rupture attendue.

### Tests
- A3 : passage de `todo` à test normal ;
- 10 variantes : `..`, `.`, `//`, segment vide, mauvaise catégorie, mois invalide, nom non UUID, extension absente, URL encodée `%2e%2e`, barre oblique inverse ;
- une clé conforme d'une autre organisation reste refusée (D3) ;
- une clé non conforme **déjà stockée** n'est pas signée.

---

## 4. Idempotence — I4c, I4b, I7, I6b

### Pourquoi le mécanisme actuel ne peut pas garantir la cohérence
Trois écritures **indépendantes** : réservation de la clé, écriture métier, enregistrement de la réponse. Toute interruption entre elles laisse un état incohérent (I4b : clé « en cours » orpheline ; I4c : clé supprimée alors que l'exploitation existe).

### Solution proposée : clé et écriture métier dans **la même transaction**

```
requête (Idempotency-Key, corps validé)
  └─ middleware : empreinte = SHA-256(portée + organisation active + corps validé canonique)
     ├─ clé déjà enregistrée et non expirée :
     │    empreinte identique → rejeu (statut d'origine, ressource relue, en-tête Idempotent-Replayed)
     │    empreinte différente → 422 IDEMPOTENCY_KEY_REUSED
     ├─ clé enregistrée mais expirée → traitée comme absente (supprimée dans la transaction)
     └─ sinon → req.idempotence = { clé, portée, empreinte } → service
  └─ service (prisma.$transaction) :
       1. INSERT idempotency_keys (clé, portée, empreinte, ressource = id créé)
       2. écritures métier (exploitation, cultures…)
       3. COMMIT : clé et ressource deviennent visibles ensemble
     effets de bord (audit, notifications, temps réel) : APRÈS le commit
```

**Propriétés attendues, toutes à démontrer par test avant toute revendication :**

| Situation | Comportement |
|---|---|
| Erreur après l'écriture métier, avant le commit (I4c) | Annulation de tout ; le renvoi s'exécute normalement : **1** ressource |
| Arrêt du serveur en cours de transaction | PostgreSQL annule la transaction : ni clé ni ressource ; le renvoi crée **1** ressource |
| Requêtes simultanées, même clé | La seconde bloque sur l'index unique `(key, scope)` jusqu'au commit de la première, puis rejoue. Plus d'état « en cours » ni de 409 |
| Clé orpheline (I4b) | **Impossible par construction** : une clé n'existe que si sa transaction a abouti |
| Expiration (I7) | Clé expirée ignorée et remplacée. Tâche V1 `idempotency.purge` (quotidienne, sur le modèle de `notifications.purge`), qui utilise l'index existant `idempotency_keys_expires_at_idx` |
| Corps différent (I6b) | 422 `IDEMPOTENCY_KEY_REUSED` |
| Même clé, deux organisations | Clé cloisonnée par utilisateur **et** organisation active (corrige l'observation de la revue) |

**Stockage sans migration :** la table `idempotency_keys` existante suffit. `responseStatus` reçoit le statut, `responseBody` (JSON) reçoit `{ empreinte, ressource: { type, id } }`. Le rejeu relit la ressource au lieu de renvoyer un corps figé : il renvoie l'état courant de l'exploitation créée.

**Périmètre :** les 4 créations où l'idempotence est montée (`POST /farms`, `/plots`, `/productions`, `/plots/:id/crop-history`). Le mode facultatif est conservé : sans en-tête, comportement inchangé pour le Web.

### Alternatives écartées
| Option | Raison |
|---|---|
| Conserver indéfiniment les clés | Refusée par votre décision ; ne règle pas I4c |
| Transaction ouverte par le middleware et propagée par `AsyncLocalStorage` à tout le code | Modifie le client Prisma pour toute l'application ; Prisma ne gère pas les transactions imbriquées |
| Identifiant de ressource dérivé de la clé (sans table) | Atomique pour une seule ligne, mais sans empreinte (I6b) ni gestion d'expiration |

### Fichiers
`src/middleware/idempotency.js`, `farms.service.js`, `plots.service.js` (création et historique cultural), `productions.service.js`, leurs contrôleurs, `src/jobs/index.js` (purge). **À vérifier avant de coder :** chaque création métier se fait-elle déjà en une seule transaction ? Une écriture hors transaction (par exemple `audit`) devra être placée après le commit.

### Risques
- **Connexions Supabase** : la transaction reste ouverte le temps de la création (quelques ms). Voir `docs/SUPABASE_CONNEXIONS.md` (`EMAXCONNSESSION`) : à mesurer sous charge.
- **Attente sous concurrence** : bornée par `timeout` de `$transaction`.
- **Rejeu non identique octet pour octet** : il renvoie la ressource relue. Écart assumé et documenté.

### Tests
| Cas | Méthode |
|---|---|
| Erreur après l'écriture métier | Échec injecté dans la transaction, après la création ; 0 ressource, puis 1 au renvoi |
| **Arrêt réel du serveur** | Processus serveur séparé, sur la même base embarquée, bloqué en milieu de transaction par un point d'arrêt réservé aux tests, puis tué (`SIGKILL`) ; redémarrage, renvoi : 1 ressource |
| Concurrence | 20 requêtes simultanées, même clé : 1 ressource, 20 réponses cohérentes |
| Expiration | Clé expirée : nouvelle exécution ; purge effective |
| Reprise | Renvoi après 500 et après coupure de connexion côté client |
| Corps différent | 422 |
| Organisation différente | Pas de rejeu croisé |
| Non-régression | I1, I2, I3, I5, I6 de la revue ; Web sans en-tête |

---

## 5. S2 — synchronisation : analyse du client réel

Examen **intégral** de `apps/Mobile/src/services/OfflineSyncEngine.ts` (299 lignes) et de `apps/Mobile/src/db/database.ts` / `schema.ts`.

### 5.1 Fonctionnement réel du client

| Étape | Code | Route appelée |
|---|---|---|
| Déclenchement | Événement réseau (NetInfo), retour au premier plan, minuterie de nouvel essai, envoi optimiste | — |
| 1. Médias en attente | `processMediaUploadQueue` | `POST /media/upload-url`, `PUT` sur l'URL signée, `POST /media/:id/confirm` |
| 2. File d'envoi (FIFO) | `processOutboxQueueFifo` → `dispatchMessageIdempotent` | Socket `send_message` (avec `localTempId`) ; **repli REST** `POST /messaging/conversations/:id/messages` |
| 3. Tirage | `pullServerDelta` | **`POST /chat/sync`** |
| Identifiant local | `generateUuidV4()` (`database.ts:148`), 36 caractères | compatible avec le contrôle serveur (20 à 40 caractères `[A-Za-z0-9_-]`) |
| Déduplication | `applyServerDelta` : `INSERT … ON CONFLICT(local_temp_id) DO UPDATE` ; clé = `local_temp_id ‖ server_id ‖ id` | — |
| Curseur | `sync_meta.comms_last_pulled_at` ← `serverTimestamp` | — |

### 5.2 Anomalies du client et du contrat (constat statique, **non exécuté sur appareil**)

| ID | Constat | Preuve | Effet |
|---|---|---|---|
| **OFF-1** | Le tirage appelle `/chat/sync` ; le backend expose `/messaging/sync`. Aucune route `/chat` parmi les 181 routes montées | `OfflineSyncEngine.ts:272` ; introduit par `a7a27e5` | Le tirage échoue (404) : **aucun message n'est reçu par synchronisation différée**. L'exception n'est pas capturée dans `triggerSync` (`try/finally` sans `catch`) et devient un rejet de promesse non géré côté mobile |
| **OFF-4** | Le repli REST envoie `localTempId`, que le schéma `messageSchema` ne déclare pas. `validate()` remplace le corps par la sortie Zod (`validate.js:28`), qui retire la clé | `messaging.routes.js:19-22` | (a) renvoi REST après perte de réponse : **doublon** côté serveur ; (b) le serveur attribue un ULID, que `markMessageSent` enregistre comme `server_id`. Au tirage suivant, le message revient avec `local_temp_id = ULID`, n'entre pas en conflit sur `local_temp_id`, et heurte **`UNIQUE(server_id)`** : `applyServerDelta` échoue |
| ~~OFF-5~~ | Vérifié : **pas d'anomalie**. `http.ts` déballe l'enveloppe `{ success, data }` (l. 21), donc `res.data.id` est bien l'identifiant du message | `apps/Mobile/src/services/api/http.ts:21` | — |
| **OFF-6** | `hasMore` n'est pas lu : une seule page de 500 par déclenchement. La suite n'est tirée qu'au prochain événement réseau ou de premier plan | `OfflineSyncEngine.ts:267-276` | Retard de réception après une longue absence ; pas de perte (le curseur est correct depuis le lot 1) |
| OFF-7 | `updated` et `deleted` toujours vides côté serveur : accusés de lecture et blocages non synchronisés | `deltaSync` | Limite fonctionnelle, à documenter |

### 5.3 Transactions concurrentes et longues
- Écriture d'un message : transaction courte (`message.create` + `conversation.update`, `messaging.service.js` `postMessage`). Les autres écritures de `messages` (`ensureBusinessConversation`, messages système d'ajout de membre) sont des écritures uniques. Aucune transaction longue identifiée dans le code ; leur durée réelle sous charge Supabase n'est **pas mesurée**.
- La perte S2 se produit dès qu'une transaction chevauche une lecture de synchronisation. Démontrée avec une transaction réelle tenue 300 ms (journal `03`).

### 5.4 Exigences du CDC maître (§42 « Fonctionnement en connectivité limitée »)
Enregistrement local, opérations en attente, synchronisation différée, reprise après interruption, gestion des conflits, compression des photos, indication de l'état de synchronisation, et « synchronisation contrôlée afin d'éviter les doublons ou les pertes ». En l'état : enregistrement local, file, reprise avec temporisation et indicateur **existent**. **La synchronisation différée ne fonctionne pas** (OFF-1). **Doublons et pertes restent possibles** (OFF-4, S2). Aucune compression des photos n'a été trouvée dans le moteur.

### 5.5 Ordre de correction proposé
1. **OFF-1** — corriger la route du client (`/messaging/sync`), et capturer l'erreur de tirage. *Prérequis : sans lui, S2 n'a aucun effet observable.*
2. **OFF-4** — serveur : accepter `localTempId` dans `messageSchema` et le transmettre à `postMessage` (rejeu idempotent déjà en place, D2). Client : upsert aussi sur `server_id`.
3. **OFF-6** — client : boucler tant que `hasMore`.
4. **S2** — serveur seul : curseur à recouvrement `L` (proposition non approuvée). Compatible avec le client **une fois OFF-4 corrigé**, car la déduplication par `local_temp_id = id` absorbe les relivraisons. `L` à fixer d'après la durée maximale mesurée des transactions d'écriture (proposé : 5 s), assorti d'un `statement_timeout` côté base.

**OFF-1, OFF-4 et OFF-6 touchent le Mobile et le hors ligne : ils exigent votre autorisation explicite, et la phase Mobile.**

---

## 6. Tests de non-régression à exécuter après chaque correctif

| Suite | Contenu | Journal de référence |
|---|---|---|
| `tests/stabilisationV1.test.mjs` | 19 tests unitaires des lots 1 et 2 | `06` |
| `tests/e2e/stabilisationV1.e2e.test.mjs` | 6 recettes PostgreSQL | `05` |
| `tests/e2e/realtimeStabilisation.e2e.test.mjs` | 7 recettes WebSocket | `04` |
| `tests/e2e/revueContradictoireV1.e2e.test.mjs` | 25 cas : les `todo` corrigés doivent devenir des réussites, les autres rester des réussites | `03` |
| `messaging.integration`, `messagingConfig`, `calls`, `push` (unitaires) ; e2e `calls`, `push` | Messagerie et appels | `06` |
| `req-v1.integration`, `auditLot2`, `auditLot3`, `adminUsers`, `adminSecurity`, `mfaLogin`, `verifyEmail`, `otpVerification`, `completenessByRole`, `profileSettings` | Socle V1 | `02` (dans `npm test`) |
| `npm run check`, `check:fields`, `check:perms`, `check:mounts` | Contrôles statiques | — |
| `npm test` complet | Comparaison avec `02` : aucun nouvel échec | `02` |
| Contre-épreuve | Chaque nouveau test échoue sur le code de `444a171` | à produire |

Banc : PostgreSQL embarqué et faux GoTrue. **TESTÉ ≠ VALIDÉ** : aucune exécution sur Supabase réel n'est prévue sans autorisation.

---

## 7. Impacts

| Correctif | API / contrat | Web | Mobile | Base de données | Services externes |
|---|---|---|---|---|---|
| W11/W12 | Ajout de l'événement `session:revoked` ; sockets coupés pour les comptes inactifs | À gérer plus tard : afficher la déconnexion | Idem | Aucun | Aucun |
| A3 | 422 `invalid_storage_key` pour une clé non conforme | Aucun (clés issues du serveur) | Aucun | Aucune écriture ; mesure en lecture seule à autoriser | Supabase Storage : moins de clés signées |
| Idempotence | 422 `IDEMPOTENCY_KEY_REUSED` ; plus de 409 « en cours » ; rejeu = ressource relue | Aucun (pas d'en-tête) | Bénéfice direct | Aucune migration ; nouveaux contenus JSON dans `idempotency_keys` ; tâche de purge | Connexions Supabase : transactions plus longues de quelques ms |
| S2 (si approuvé) | Curseur : relivraison possible dans la fenêtre `L` | Non concerné | Exige OFF-1 et OFF-4 d'abord | Aucune | Aucun |
| OFF-1 / OFF-4 / OFF-6 | `messageSchema` accepte `localTempId` (ajout) | Aucun | **Modifications Mobile** (phase Mobile) | Aucune | Aucun |

**Rien de ce document n'est appliqué.** Ordre d'exécution proposé, sous réserve de votre autorisation correctif par correctif : W11/W12, puis A3, puis l'idempotence (I4c, I4b, I7, I6b), puis OFF-4 côté serveur, puis S2, et OFF-1 / OFF-6 en phase Mobile.
