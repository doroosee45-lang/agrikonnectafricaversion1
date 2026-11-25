# Analyse complémentaire — W11/W12/W13, A3, idempotence, synchronisation

**Date :** 25 novembre 2026 · **Pour :** architecte · **Statut : ANALYSE. Aucune modification du code applicatif.**
Répond à la « Directive architecturale — consolidation du socle V1 », §2. Complète [`PROPOSITION_CORRECTIFS_V1.md`](PROPOSITION_CORRECTIFS_V1.md).

**Preuves :** recette `tests/e2e/analyseComplementaireV1.e2e.test.mjs` (15 cas), journal `preuves/logs/08-analyseComplementaireV1.log` : **11 conformes, 0 échec, 4 anomalies confirmées**.

**Statut des preuves :**
- **TESTÉ** = exécuté sur le banc local : PostgreSQL **18.4 embarqué**, isolation `read committed`, faux GoTrue, Windows 11, Node 26.13.0.
- **VALIDÉ** = rien à ce jour. **Aucune exécution sur Supabase réel.** Supabase utilise une autre version majeure de PostgreSQL et passe par PgBouncer en mode transaction (port 6543) : les résultats ne s'y transposent pas sans vérification.

---

## 1. W11 / W12 / W13 — révocation des droits sur les sockets existants

### 1.1 Faits établis

| Fait | Source | Statut |
|---|---|---|
| Un compte suspendu ou une adhésion révoquée continue de **recevoir** le contenu | W11, W12 (journal 03) | TESTÉ |
| **Nouveau — W13 :** après `POST /auth/logout`, le REST répond 401 au même jeton, mais le socket ouvert **continue d'envoyer** (`ok: true`) | W13 (journal 08) | TESTÉ |
| Le jeton n'est vérifié qu'à la poignée de main (`realtime/index.js`, `authenticateSocket`). Ni expiration ni révocation ne sont revérifiées ensuite | Lecture du code | Constat |
| Production : **une seule instance** (`render.yaml`, offre gratuite, sans mise à l'échelle) ; aucun adaptateur Socket.IO partagé | `render.yaml:18-29` | Constat |
| Les clients (`apps/web` et `apps/Mobile`, `services/realtime.ts`) utilisent `reconnection: true`. Socket.IO **ne se reconnecte pas** après une déconnexion décidée par le serveur, et les clients ne gèrent pas ce cas | Lecture du code ; comportement documenté de Socket.IO | Constat (non testé sur client) |
| PgBouncer en mode transaction (port 6543) ne permet pas `LISTEN/NOTIFY` | `docs/SUPABASE_CONNEXIONS.md` | Constat |

### 1.2 Révocation immédiate et filet périodique : deux garanties distinctes

| Mécanisme | Ce qu'il garantit | Délai | Portée |
|---|---|---|---|
| **Révocation immédiate** : appel explicite après chaque écriture qui retire un droit (`updateUserStatus`, `forceLogout`, `deleteUser`, `deleteMe`, `revokeRole`, **`logout`**) | Coupure ou sortie de rooms **avant** la réponse HTTP | Immédiat | **Instance qui traite la requête** uniquement, sans adaptateur |
| **Filet périodique** : relecture groupée des profils et adhésions des sockets connectés, et contrôle de l'expiration du jeton (`exp`) | Couvre les autres instances, les modifications hors API (SQL, console Supabase) et l'expiration des jetons | ≤ intervalle (proposé : 60 s) | Chaque instance pour ses propres sockets |
| Révocation de session **hors API** (console Supabase) | Non détectable par simple relecture du profil | ≤ intervalle seulement si le filet appelle `getUser(jeton)` pour chaque socket (un appel réseau par socket et par intervalle) ; sinon ≤ expiration du jeton (1 h par défaut chez Supabase) | — |

### 1.3 Multi-instances

| Option | Révocation immédiate inter-instances | Coût |
|---|---|---|
| **A — Sans adaptateur** (V1 actuel) + filet périodique | Non : délai borné par l'intervalle | Aucune dépendance nouvelle |
| B — Adaptateur Socket.IO PostgreSQL (`LISTEN/NOTIFY`) | Oui | 2 dépendances (`pg`, `@socket.io/postgres-adapter`) ; une connexion **directe** par instance (`DIRECT_URL`, 5432), pas le pooler |
| C — Adaptateur Redis | Oui | Nouvelle infrastructure (Redis) |

**Recommandation V1 : option A**, et **point d'extension documenté** pour B. Justification : une seule instance aujourd'hui ; le filet borne le délai sur toute topologie. B est ajoutable plus tard sans toucher aux appels de révocation, car ils passent tous par `bus.js`.

**Démonstration multi-instances (à faire avec le correctif, pas réalisable sans lui) :** deux processus serveur séparés sur la même base embarquée, un socket connecté à chacun. Révocation par l'API de l'instance 1 : socket de l'instance 1 coupé avant la réponse ; socket de l'instance 2 coupé en ≤ intervalle (intervalle réduit en test). Les deux délais mesurés figureront dans le journal.

### 1.4 Préalable côté clients (W13)
Déconnecter un socket dont le jeton a **expiré** couperait des utilisateurs légitimes, puisque les clients ne se reconnectent pas après une coupure décidée par le serveur. Ordre imposé :
1. Clients (phase Web/Mobile) : sur `session:revoked` ou `io server disconnect`, rafraîchir le jeton puis rappeler `connect()`.
2. Serveur : coupure à l'expiration du jeton.

Avant cela, côté serveur seul : coupure immédiate pour **compte inactif et déconnexion explicite** (pas de reconnexion souhaitée), sortie de rooms pour **droits réduits** (sans coupure).

---

## 2. A3 — clés de pièces jointes et URL externes

### 2.1 Inventaire des écritures de `messages.attachments` (code V1)

| Écriture | Contenu | Contrôle actuel |
|---|---|---|
| `postMessage` (REST `POST /messaging/conversations/:id/messages` et socket `send_message`) | Fourni par le client | `assertAttachments` : caractères, ≤ 500, préfixe de l'organisation (D3) ; **`..` accepté** (A3) |
| `ensureBusinessConversation` (premier message d'un fil) | `[]` | — |
| Message système d'ajout de membre (`addGroupMember`) | `[]` | — |

**Clients :** Web (`Messages.tsx:159-168`) et Mobile (`OfflineSyncEngine.ts:158-175`) envoient `confirmed.data.publicUrl || presign.data.media.publicUrl || storageKey`. Or `POST /media/:id/confirm` renvoie la ligne `media` avec un champ **`url`**, jamais `publicUrl` (`media.service.js:128-150`). **Les deux clients envoient donc la clé de stockage**, conforme à la grammaire proposée. Aucun client n'envoie d'URL externe. Une URL ne peut provenir que d'un appel d'API forgé, ou de données antérieures.

### 2.2 Inventaire des données existantes — autorisation requise
Non réalisé : il faut lire Supabase réel. Requête **en lecture seule** proposée, sans aucune donnée personnelle dans le résultat :

```sql
SELECT CASE
  WHEN a ~ '^https?://[^/]*supabase\.co/' THEN 'url_supabase (signée, probablement expirée)'
  WHEN a ~ '^https?://' THEN 'url_externe'
  WHEN a ~ '^[A-Za-z0-9._-]+/(media|documents)/[0-9]{4}-[0-9]{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$' THEN 'cle_conforme'
  WHEN a LIKE '%..%' THEN 'cle_traversee'
  ELSE 'cle_non_conforme' END AS categorie,
  count(*) AS nombre
FROM messages, unnest(attachments) AS a
GROUP BY 1 ORDER BY 2 DESC;
```

### 2.3 Risque des URL externes

| Risque | Constat | Gravité |
|---|---|---|
| Hameçonnage | Le Web affiche toute URL en lien cliquable (`Messages.tsx:392`) ; le Mobile l'ouvre au toucher (`Linking.openURL`, `[conversationId].tsx:88`) | Moyenne |
| **Fuite de l'adresse IP du destinataire** | Le Web place l'URL dans `<audio src>` quand elle finit par `.mp3`, `.webm`… Le navigateur la **précharge à l'affichage**, sans clic | Moyenne |
| Contenu non contrôlé | Pas de contrôle MIME ni de taille, contrairement au dépôt de médias | Moyenne |
| SSRF | Le serveur ne télécharge jamais une pièce jointe (`signerPiecesJointes` ignore les URL) | Nulle (vérifié dans le code) |

**Options :**
1. **Refuser toute URL** : seules les clés de stockage sont acceptées. **Recommandé pour la V1**, puisqu'aucun client n'en produit.
2. N'accepter que le domaine de stockage de la plateforme.
3. Accepter, mais afficher comme lien inerte avec avertissement (côté clients).

### 2.4 Défauts d'affichage relevés (phase Web/Mobile)

| ID | Constat | Statut |
|---|---|---|
| WEB-1 | Le fil Web lit `data.items` ; l'API renvoie `data.messages`. **Le fil Web s'affiche vide** | Contrat TESTÉ (C5) ; effet à l'écran non vérifié dans un navigateur |
| WEB-2 | Le Web affiche la clé brute (`href={att}`) au lieu de `attachmentUrls` : lien cassé | Lecture du code |
| MOB-1 | Le Mobile ouvre la clé brute (`Linking.openURL(att)`), qui ne s'ouvre pas ; `attachment_urls` est ignoré | Lecture du code |

---

## 3. Idempotence — démonstrations des mécanismes

**Ce qui est démontré :** la sémantique PostgreSQL sur laquelle repose la proposition (clé et écriture métier dans une même transaction). **Ce qui ne l'est pas encore :** le correctif lui-même, qui n'est pas écrit.

| ID | Scénario | Observé | Conséquence pour la conception |
|---|---|---|---|
| P0 | Isolation | `read committed`, PostgreSQL 18.4 | Supabase : à vérifier (`SHOW transaction_isolation`) |
| **P1** | Deux transactions, même clé | La seconde **attend** (≈ 0,8 s, durée de la première), puis échoue en **P2002** ; **1** ressource | Requêtes simultanées : pas de 409 « en cours » ; la seconde rejoue après la validation de la première |
| **P2** | Échec après l'écriture métier, avant validation | 0 clé, 0 ressource ; la reprise en crée 1 | Résout I4c |
| **P3** | Connexion tuée en cours de transaction (`pg_terminate_backend`) | Annulée (P1017) ; 0 clé, 0 ressource | Interruption du serveur côté base : rien n'est persisté. *Un arrêt réel du processus Node reste à tester après implémentation.* |
| **P4** | Clé expirée reprise par deux transactions concurrentes, ×10 | 10 manches sur 10 : 1 clé, 1 ressource (une transaction valide, l'autre P2002) | Expiration concurrente sûre avec `DELETE … WHERE expiresAt < now()` puis `INSERT` dans la même transaction |
| **P5** | Conflit d'unicité **dans** la transaction | Transaction entière annulée (`25P02`) | **Le conflit se traite hors de la transaction** : sur P2002, relire la clé validée puis rejouer. On ne capture pas l'erreur à l'intérieur |

**Corrections à la proposition :**
- le modèle `IdempotencyKey` a **déjà** une colonne `requestHash` : l'empreinte du corps (I6b) y sera stockée, pas dans `responseBody` ;
- Prisma ouvre ses transactions interactives avec `maxWait` 2 s et `timeout` 5 s par défaut, et Supabase limite à `connection_limit=5`. Une file de requêtes simultanées sur la même clé occupe une connexion par requête en attente. Il faudra régler `maxWait` et `timeout`, et mesurer.

**Reste à démontrer après implémentation :** arrêt réel du processus Node (`SIGKILL`) en cours de requête ; 20 requêtes simultanées ; rejeu après expiration ; corps différent ; et, **sur un environnement de préproduction autorisé**, le comportement à travers PgBouncer en mode transaction.

---

## 4. Synchronisation Mobile ↔ API

### 4.1 Incompatibilités démontrées

| ID | Scénario (requêtes et SQL **réels** du Mobile) | Observé | Statut |
|---|---|---|---|
| **OFF-1** | `POST /chat/sync` (`OfflineSyncEngine.ts:272`) | **404** « Route introuvable : POST /api/v1/chat/sync » | TESTÉ (C1) |
| — | `POST /messaging/sync` avec le corps du Mobile | 200 ; tous les champs lus par `applyServerDelta` sont présents | TESTÉ (C2) |
| — | Envoi socket, UUID v4 renvoyé deux fois | 1 message, `id = localTempId` | TESTÉ (C3) |
| **OFF-4a** | Repli REST avec `localTempId` renvoyé deux fois | **2 messages**, identifiants ≠ `localTempId` | TESTÉ (C4) |
| — | Base locale : envoi socket, puis tirage | 1 ligne (fusion `ON CONFLICT(local_temp_id)`) | TESTÉ (L1) |
| — | Base locale : même page appliquée deux fois | Aucun doublon : la relivraison est absorbée | TESTÉ (L2) |
| **OFF-4b** | Base locale : envoi REST, puis tirage | **`UNIQUE constraint failed: messages.server_id`** : `applyServerDelta` échoue | TESTÉ (L3) |
| OFF-6 | `hasMore` ignoré, une page par déclenchement | Lecture du code | Constat |

**Méthode L :** le SQL est **extrait à l'exécution** des fichiers `apps/Mobile/src/db/schema.ts` et `database.ts`, puis exécuté dans `node:sqlite` (SQLite 3.54) avec les paramètres dans l'ordre du code Mobile. Ce n'est pas un appareil : le SQLite d'Expo (`expo-sqlite`) n'est pas exercé.

### 4.2 Correction proposée (autorisation requise : hors ligne et Mobile)

| Côté | Correctif | Contrat |
|---|---|---|
| Serveur | `messageSchema` accepte `localTempId` (même format que le socket) et le transmet à `postMessage`, dont le rejeu idempotent existe déjà (D2) | Ajout d'un champ facultatif |
| Mobile | `/chat/sync` remplacé par `/messaging/sync` ; erreur de tirage capturée ; boucle tant que `hasMore` ; fusion locale aussi sur `server_id` ; affichage par `attachment_urls` | Aucun |
| Serveur, ensuite | S2 (curseur à recouvrement), **seulement après** les correctifs ci-dessus. L2 montre que le Mobile absorbe déjà les relivraisons | Relivraison possible |

### 4.3 Ce qui reste à démontrer avant de déclarer le hors ligne fiable
Reprise après coupure **pendant** l'envoi (socket et REST), doublons après réponse perdue, tirage concurrent d'une écriture (S2), longue absence (plus de 500 messages, plusieurs pages), redémarrage de l'application avec une file en attente, fichiers médias en attente, et tout cela **sur appareil réel ou émulateur**. **À ce jour : le fonctionnement hors ligne n'est PAS fiable** (OFF-1 bloque toute réception différée).

---

## 5. Évolutivité — points d'extension (à documenter, sans développement anticipé)

| Domaine | Point d'extension V1 existant | Usage futur |
|---|---|---|
| Autorisation | `shared/permissions.js` (matrice action × rôle), `authorize()`, `resolveTenant` (organisation active) | Nouvelles permissions V2-V5 sans toucher au socle |
| Modules | Montage par préfixe dans `routes/index.js` ; convention routes → contrôleur → service → schéma | Ajout d'un module sans modifier les autres |
| Messagerie | `subjectType` et `SUBJECT_MODEL` (`messaging.service.js`) | Fils liés aux commandes, litiges, projets (V2-V4) |
| Temps réel | `realtime/bus.js` (toutes les émissions) | Adaptateur multi-instances (option B), nouveaux événements |
| Idempotence | Middleware et table `idempotency_keys` (portée par opération) | Commandes, paiements (V2) |
| Tâches | `jobs/index.js` (registre, pause, supervision) | Tâches V2-V5 |
| Données | Schéma Prisma complet, tables V2-V5 conservées et non exposées ; migrations additives | Activation sans migration destructive |
| Fonctionnalités | Feature flags (`/admin/flags`) | Activation progressive |

## 6. Livrables du §5 de la directive — état

| Livrable | État |
|---|---|
| Rapport d'architecture final V1 | À produire (après les correctifs) |
| Inventaire des modules et fonctionnalités V1 | Partiel : `docs/PLAN_NETTOYAGE_V1.md`, `NETTOYAGE_V1_LISTE_EXACTE.tsv`, 181 routes montées |
| Sécurité et isolation multi-organisation | Partiel : `RAPPORT-STABILISATION-BACKEND-V1.md` §C-D, `PREUVES_SECURITE_WEBSOCKET.md`, présent document §1-2 |
| Transactions et idempotence | Partiel : `PREUVES_IDEMPOTENCE_SYNC.md`, présent document §3 |
| Synchronisation Web/Mobile | Partiel : présent document §4 ; WEB-1, WEB-2, MOB-1 ouverts |
| Migrations et intégrité | À produire (24 migrations, contrôle de dérive, E8 `ACADEMIA_ADMIN`) |
| Tests TESTÉ / VALIDÉ | Journaux 01 à 08 ; colonne VALIDÉ vide |
| Risques résiduels | `REVUE_CONTRADICTOIRE_BACKEND_V1.md` §5 + W13, OFF-4, WEB-1/2, MOB-1 |
| Points d'extension | Présent document §5 (à développer) |

**Le backend V1 n'est pas déclaré stabilisé.**

## 7. Anomalies ouvertes après cette analyse

| ID | Gravité | Côté | Autorisation requise |
|---|---|---|---|
| W11, W12 | Haute | Serveur | Correctif W11/W12 |
| **W13** (nouveau) | Haute | Serveur et clients | Correctif W13 ; reconnexion côté clients d'abord |
| I4c, I4b, I7, I6b | Haute / moyenne | Serveur | Correctif d'idempotence |
| A3 et URL externes | Moyenne | Serveur | Correctif A3 ; requête de lecture sur Supabase |
| **OFF-1** | Haute | Mobile | Hors ligne et Mobile |
| **OFF-4a / OFF-4b** | Haute | Serveur et Mobile | Hors ligne |
| OFF-6, S2 | Moyenne | Mobile, puis serveur | Hors ligne |
| **WEB-1** (nouveau) | Haute | Web | Phase Web |
| WEB-2, MOB-1 (nouveaux) | Moyenne | Web, Mobile | Phases Web et Mobile |
| E8, consentement coopératif | Moyenne / haute | Serveur | Décisions antérieures |
