# Proposition : écran de discussion 1-à-1 (Mobile), architecture et modèle de données

**Statut :** proposition à valider. Aucun code d'écran n'est écrit et aucune migration n'est créée.
**Périmètre :** V1, application Mobile (React Native / Expo, TypeScript) et backend (Prisma / PostgreSQL).

---

## 1. Point de départ

| Élément de la spécification | Existant | Écart |
|---|---|---|
| Liste des messages | [messages/[conversationId].tsx](../apps/Mobile/src/app/messages/[conversationId].tsx) (142 lignes) : rendu par `.map()`, sans `FlatList`, sans pagination | À refaire |
| Hors ligne | SQLite comme source unique de vérité, file `outbox_queue` et `media_upload_queue`, statuts `PENDING` / `SENT` / `FAILED` | **Réutilisé tel quel** |
| Temps réel | Socket.IO : `message:new`, `message:read`, `typing` (émission et réception) | Pas d'interface « en train d'écrire » ; pas de présence |
| Coches envoyé / reçu / lu | `readBy String[]` sur `Message` ; pas d'état « distribué » | Modèle à compléter (§4) |
| Appel vocal | `CallButton` + `CallSession` (LiveKit, **audio seul**) | Cartes d'appel absentes du fil |
| Appel vidéo | **Absent de la V1** (pas de `CallKind` vidéo) | Décision D1 |
| Pièces jointes | `attachments String[]` (clés de stockage) ; type déduit de l'extension | Pas d'interface, pas de métadonnées (durée, GPS, parcelle) |
| Note vocale, photo, PDF, GPS | Aucune bibliothèque installée (`expo-audio`, `expo-image-picker`, `expo-document-picker`, `expo-location`) | Dépendances à ajouter |
| Réponse à un message | Préfixe texte `↪ « … »` dans le corps | Lien structuré proposé (§4) |

**Prérequis de fiabilité hors ligne (déjà documentés) :**
- **S2** : curseur de synchronisation. Une perte est possible sous concurrence. Voir [DOSSIER_S2_CURSEUR_STABLE.md](../backend/docs/DOSSIER_S2_CURSEUR_STABLE.md).
- **SYNC-U** : `deltaSync` ne renvoie aucune modification (`updated: []`). Les coches de lecture ne se resynchronisent donc pas après une coupure.

## 2. Architecture du composant (React Native, TypeScript)

```
app/messages/[conversationId].tsx         ← route : assemble, aucune logique métier
└─ features/messaging/conversation/
   ├─ ConversationScreen.tsx
   ├─ header/
   │  ├─ ConversationHeader.tsx           retour · avatar + nom (→ profil) · présence · actions
   │  ├─ PresenceLabel.tsx                « En ligne » / « Vu à 14:32 » / « Vu hier »
   │  └─ CallActions.tsx                  appel vocal (CallButton existant) · vidéo (D1)
   ├─ timeline/
   │  ├─ MessageList.tsx                  FlatList inverted + pagination vers le haut
   │  ├─ DateSeparator.tsx                « Aujourd'hui » / « Hier » / « 12 mars 2026 »
   │  ├─ MessageBubble.tsx                gauche (reçu, neutre) / droite (envoyé, vert AgriKonnect)
   │  ├─ MessageStatus.tsx                ⏱ en attente · ✓ envoyé · ✓✓ reçu · ✓✓ (vert) lu · ⚠ échec → renvoyer
   │  ├─ content/
   │  │  ├─ TextContent.tsx
   │  │  ├─ ImageContent.tsx              miniature, plein écran au toucher
   │  │  ├─ VoiceNoteContent.tsx          lecture, durée, progression
   │  │  ├─ DocumentContent.tsx           icône PDF, nom, taille, ouverture
   │  │  ├─ LocationCard.tsx              aperçu de carte statique → ouvre l'application Cartes
   │  │  └─ ParcelCard.tsx                nom, surface, culture, aperçu → fiche parcelle (si autorisé)
   │  ├─ CallEventCard.tsx                « Appel vocal · 3 min 12 » / « Appel manqué · Rappeler »
   │  └─ TypingIndicator.tsx              en ListHeaderComponent (liste inversée = bas de l'écran)
   ├─ composer/
   │  ├─ Composer.tsx                     barre fixe, au-dessus du clavier
   │  ├─ AttachmentMenu.tsx               Parcelle · Position GPS · Document PDF · Galerie
   │  ├─ AutoGrowInput.tsx                multilignes, hauteur bornée (5 lignes)
   │  ├─ CameraButton.tsx                 capture directe
   │  └─ MicButton.tsx                    maintenir pour enregistrer, glisser pour annuler, verrouiller
   ├─ hooks/
   │  ├─ useConversationTimeline.ts       SQLite → éléments de fil, page de 40, chargement des plus anciens
   │  ├─ useConversationRealtime.ts       rejoindre la room, message:new / read / delivered, typing
   │  ├─ useTypingEmitter.ts              émission limitée (début, puis toutes les 3 s, arrêt après 5 s)
   │  ├─ usePresence.ts
   │  ├─ useMarkAsRead.ts                 messages visibles (onViewableItemsChanged) → accusé groupé
   │  └─ useVoiceRecorder.ts              expo-audio, AAC 32 kb/s mono (faible poids sur réseau rural)
   └─ timeline.ts                         PUR et testé : construction du fil (voir ci-dessous)
```

**Fil d'affichage, construit par une fonction pure** (testée sous Node, comme `pushRoutage.ts`) :

```ts
type MessageKind = 'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT' | 'LOCATION' | 'PARCEL' | 'CALL_EVENT';
type DeliveryState = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

type TimelineItem =
  | { kind: 'date'; key: string; day: string }                       // « 2026-11-25 »
  | { kind: 'message'; key: string; message: LocalMessage; mine: boolean;
      state: DeliveryState; groupedWithPrevious: boolean }            // bulles groupées < 2 min
  | { kind: 'call'; key: string; message: LocalMessage; call: CallEventMeta };

function buildTimeline(messages: LocalMessage[], me: string, now: Date): TimelineItem[];
```

**Performances**
- `FlatList` avec `inverted`, `keyExtractor = local_temp_id` (stable entre l'état en attente et l'état envoyé), `windowSize={11}`, `maxToRenderPerBatch={20}`, et `onEndReached` pour charger les plus anciens.
- L'ouverture lit d'abord **SQLite** (affichage instantané, sans réseau), puis synchronise en arrière-plan.
- Pagination locale par `(created_at, id) < curseur`, avec un index SQLite `(room_id, created_at, id)`.
- Les bulles sont mémoïsées (`React.memo`, comparaison sur `updated_at` et `sync_status`).

**Hors ligne (réutilisation de l'existant)**
- Chaque envoi crée d'abord la ligne locale en `PENDING`, avec un `local_temp_id` qui devient l'identifiant serveur. Le renvoi est idempotent, c'est déjà le cas aujourd'hui.
- Photos, notes vocales et PDF passent par `media_upload_queue` (téléversement), puis par `outbox_queue` (message).
- Les positions GPS et les parcelles n'ont **pas** de fichier : elles passent directement par l'outbox, avec leurs métadonnées.
- Une note vocale enregistrée sans réseau reste lisible localement (`local_media_uri`) avant d'être envoyée.

## 3. Temps réel

| Événement | Sens | État |
|---|---|---|
| `message:new` | serveur → client | Existant |
| `message:read` | serveur → client | Existant (actuellement fondé sur `readBy`) |
| `message:delivered` | serveur → client | **Nouveau** : accusé de réception de l'appareil destinataire |
| `typing` | dans les deux sens | Existant (émission prête dans `realtime.ts`, interface à faire) |
| `presence:update` | serveur → client | **Nouveau** : connexion et déconnexion des sockets d'un utilisateur |
| `call:updated` | serveur → client | Existant. La fin d'appel produit une carte dans le fil (§4) |

- **Présence :** le compte de sockets par utilisateur est déjà connu du serveur, donc aucune table n'est nécessaire.
- **« Vu récemment » :** à la dernière déconnexion, le serveur écrit `Profile.lastSeenAt`.
- **Confidentialité :** la présence n'est diffusée qu'aux membres des conversations communes.

## 4. Modèle de données proposé (Prisma, migration **additive**)

```prisma
enum MessageType {
  TEXT
  IMAGE
  AUDIO
  DOCUMENT
  LOCATION
  PARCEL
  CALL_EVENT   // message système créé par le serveur à la fin d'un appel
}

model Message {
  id             String      @id                    // = localTempId du client (idempotence, déjà en place)
  conversationId String      @map("conversation_id")
  senderId       String      @map("sender_id")
  senderOrgId    String      @map("sender_org_id")
  type           MessageType @default(TEXT)         // NOUVEAU — défaut constant : pas de réécriture
  body           String                             // texte, légende, ou "" pour un média seul
  attachments    String[]                           // clés de stockage (inchangé)
  metadata       Json?                              // NOUVEAU — voir les schémas ci-dessous
  replyToId      String?     @map("reply_to_id")    // NOUVEAU — remplace le préfixe « ↪ »
  readBy         String[]    @map("read_by")        // CONSERVÉ pendant la transition (écriture double)
  editedAt       DateTime?   @map("edited_at")      // NOUVEAU — réservé (modification)
  deletedAt      DateTime?   @map("deleted_at")     // NOUVEAU — suppression logique « message supprimé »
  createdAt      DateTime    @default(now()) @map("created_at")

  conversation Conversation     @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  replyTo      Message?         @relation("MessageReply", fields: [replyToId], references: [id], onDelete: SetNull)
  replies      Message[]        @relation("MessageReply")
  receipts     MessageReceipt[]

  @@index([conversationId, createdAt, id])          // pagination stable (remplace l'index actuel)
  @@map("messages")
}

/// Accusés par destinataire : « reçu » (appareil) et « lu » (écran ouvert), horodatés.
model MessageReceipt {
  messageId   String    @map("message_id")
  userId      String    @map("user_id") @db.Uuid
  deliveredAt DateTime? @map("delivered_at")
  readAt      DateTime? @map("read_at")

  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@id([messageId, userId])
  @@index([userId, readAt])
  @@map("message_receipts")
}

model Profile {
  // … existant …
  lastSeenAt DateTime? @map("last_seen_at")         // NOUVEAU — « Vu récemment »
}
```

**Contenu de `metadata` selon le type**, validé par Zod côté serveur, avec une taille maximale de 2 Ko :

| Type | `metadata` |
|---|---|
| AUDIO | `{ durationMs, waveform?: number[≤64] }` |
| IMAGE | `{ width, height }` |
| DOCUMENT | `{ name, sizeBytes, mime: "application/pdf" }` |
| LOCATION | `{ lat, lng, accuracyM, label? }` |
| PARCEL | `{ plotId, name, areaHa, crop?, centroid: { lat, lng } }`, un **instantané** pris à l'envoi |
| CALL_EVENT | `{ callId, outcome: "COMPLETED" \| "MISSED" \| "DECLINED" \| "CANCELLED", durationSec }` |

**Pourquoi ces choix :**
- **Appels en messages système (`CALL_EVENT`)**, plutôt qu'une fusion à l'affichage avec `CallSession` : la carte suit le même chemin que les messages (synchronisation hors ligne, ordre, pagination), sans second flux à fusionner. `CallSession` reste la source de vérité ; le message est écrit au passage à `ENDED` / `MISSED`, dans la même transaction.
- **`MessageReceipt` plutôt que `readBy[]` :**
  - le tableau ne porte ni l'état « distribué » ni d'horodatage ;
  - chaque lecture réécrit toute la ligne du message, avec un risque de conflit entre écritures concurrentes.
  - `readBy` est conservé et alimenté pendant la transition, pour que les clients actuels continuent de fonctionner.
- **Instantané de parcelle :** le destinataire n'a généralement pas le droit de lire la parcelle d'un autre locataire. La carte affiche l'instantané. L'ouverture de la fiche complète passe par le contrôle d'accès habituel, et un refus aboutit à « Voir sur la carte » avec les coordonnées.
- **Migration :**
  - Toutes les colonnes sont nullables ou ont un défaut constant : pas de réécriture de table (même mécanisme que celui mesuré pour S2).
  - Les anciens messages prennent `type = TEXT`.
  - Les pièces jointes existantes sont reclassées à la lecture par leur extension, comme le fait déjà `deltaSync`.
  - **L'application sur Supabase reste soumise à autorisation.**
- **Côté SQLite :** colonnes équivalentes `metadata_json`, `reply_to_id`, `delivered_at`, `read_at`, et index `(room_id, created_at, id)`. La migration locale est versionnée dans `db/schema.ts`.

## 5. Contrat d'API

Tous les changements sont **additifs** ; les anciens clients ne sont pas affectés.

- `POST /messaging/conversations/:id/messages` accepte en plus `type`, `metadata` et `replyToId`. `localTempId` existe déjà.
- `GET /messaging/conversations/:id/messages?before=<createdAt,id>&limit=40` : pagination vers le haut.
- `POST /messaging/conversations/:id/receipts` avec `{ delivered: string[], read: string[] }` : accusés groupés, et diffusion `message:delivered` / `message:read`.
- `POST /messaging/sync` ajoute `type`, `metadata`, `reply_to_id` et les accusés dans `updated` (dépend de SYNC-U et S2).

## 6. Décisions à valider

| # | Question | Recommandation |
|---|---|---|
| D1 | Appel **vidéo** : la V1 ne gère que l'audio (LiveKit) | Masquer le bouton en V1. La vidéo est un lot séparé (LiveKit la gère, mais coût en données élevé sur le terrain) |
| D2 | Carte GPS ou parcelle **interactive** dans le fil (`react-native-maps`, clé Google Maps sur Android) ou **aperçu statique** | Aperçu statique et léger, puis ouverture dans l'application Cartes ou sur la fiche parcelle. La carte interactive est réservée à l'écran plein |
| D3 | Accusés `MessageReceipt` (migration) ou maintien de `readBy[]` seul (coches « lu » seulement, sans « reçu ») | `MessageReceipt` |
| D4 | Ordre de livraison (ci-dessous) | Lots 1 à 3 |
| D5 | Prérequis S2 et SYNC-U avant le lot 3 (coches fiables après une coupure) | Oui |

**Lots proposés :**
1. **Lot 1, sans migration :**
   - en-tête (retour, avatar, nom, profil, appel vocal) ;
   - `FlatList` inversée paginée, séparateurs de dates, bulles asymétriques, statuts locaux (en attente, envoyé, échec avec renvoi) ;
   - « en train d'écrire » ;
   - champ multilignes.
2. **Lot 2, sans migration :**
   - photo (caméra et galerie), PDF et note vocale, via `attachments` existant et type déduit de l'extension ;
   - nouvelles dépendances : `expo-audio`, `expo-image-picker`, `expo-document-picker`.
3. **Lot 3, avec migration autorisée :**
   - `type` et `metadata` : GPS (`expo-location`), parcelle, cartes d'appel ;
   - `MessageReceipt` : coches reçu et lu ;
   - présence et `lastSeenAt` ;
   - réponse structurée.

## 7. Vérifications prévues

- `timeline.ts` : séparateurs (fuseau local, minuit, « Hier »), regroupement, ordre stable entre l'état en attente et l'état envoyé, cartes d'appel. Tests unitaires sous Node.
- Hors ligne : envoi en mode avion, puis retour du réseau, sans doublon ni perte (file existante et idempotence `localTempId`).
- Pagination : ouverture d'une conversation de 5 000 messages en moins de 300 ms (lecture SQLite), puis défilement vers le haut.
- Temps réel : deux appareils, « en train d'écrire », accusés et carte d'appel après un appel réel.
- `tsc --noEmit` et la suite Mobile existante.
