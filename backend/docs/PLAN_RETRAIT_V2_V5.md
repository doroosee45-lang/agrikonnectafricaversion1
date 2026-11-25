# Inventaire V2-V5 et plan de retrait — Backend

**Date :** 25 novembre 2026 · **Statut : PROPOSITION. Rien n'a été supprimé.** Exécution soumise à la validation du responsable du projet et de l'architecte (directive architecturale V1 : « Attends la validation de ce plan avant les modifications destructrices »).
> **Remplacé en partie par [`docs/PLAN_NETTOYAGE_V1.md`](../../docs/PLAN_NETTOYAGE_V1.md) (25/11/2026)** : la directive de nettoyage protège la **messagerie et le hors ligne**. Les propositions de ce document qui y touchent sont annulées, notamment la restriction des sujets de conversation (§3.2) et le retrait des modèles et permissions SMS, canaux et `sync`.

**Périmètre :** `backend/` uniquement. Le Web et le Mobile feront l'objet d'un inventaire distinct.

## 1. Méthode (reproductible)

| Mesure | Outil | Résultat |
|---|---|---|
| Code chargé par le serveur | Graphe des imports statiques et dynamiques depuis `src/server.js` | 169 fichiers dans `src/` : **150 chargés, 19 jamais chargés** |
| Routes réellement montées | Parcours de la pile Express (`createApp()._router.stack`, même méthode que `npm run check:mounts`) | **181 routes** |
| Modèles utilisés | Recherche des délégués Prisma et des noms de table dans les 150 fichiers chargés | 110 modèles : **55 utilisés, 55 jamais utilisés** |
| Tâches planifiées | `src/jobs/index.js` | 12 tâches, dont 10 V2-V5 |
| Permissions | `npm run check:perms` | 101 clés définies mais utilisées par aucune route |
| Classement V1 / V2+ | CDC V1 §3, §15 ; feuille de route V1-V5 §4.3 à §8.3 | Voir colonnes « Version » ; « À confirmer » quand les documents ne tranchent pas |

## 2. Contradictions entre directives — arbitrage préalable obligatoire

| # | Point | Directive architecturale V1 | Autre source | Proposition |
|---|---|---|---|---|
| X1 | **Fondations Academia** (rôles `ACADEMIA_*`, permissions `academia.*`, `affiliations.*`, `institutions.*`, modèles `Academic*`) | Retirer tout ce qui est futur | **CDC V1 §3.11, V1-F12 et feuille de route §4.3 F** : les fondations d'Academia **font partie de la V1** | **Conserver.** Ce n'est pas du V2+. |
| X2 | **Tables et modèles V2-V5 en base** | « Retirer les modèles exclusivement liés aux versions futures » ; point 6 : « ne pas supprimer aveuglément l'historique des migrations » | Revue contradictoire §6 : « Ne pas supprimer les fonctionnalités V2-V5 de la base historique » ; directive Phase 1 §9 : aucune migration destructive | **Conserver tables, migrations et `schema.prisma` intacts** (option B1, §4). Retirer uniquement le code applicatif. |
| X3 | **Module de communication** (messagerie, appels, push) | Hors CDC V1 | Directive Phase 1 §7 : préserver, interdiction de supprimer | **Conserver.** Retirer seulement les sujets de conversation V2+ (§3.2). |
| X4 | **Code dormant de la feuille de route** (« préparation » V1 de la marketplace, du transport, de la traçabilité) | Aucun module dormant | Feuille de route §9 : colonne V1 = « Préparation » pour plusieurs piliers | « Préparation » interprétée comme **documentaire** : aucun code V2+ conservé à ce titre. À confirmer. |

## 3. Inventaire

### 3.1 Code jamais chargé (19 fichiers) — retrait sans effet d'exécution

| Fichier | Version | Dépendances entrantes |
|---|---|---|
| `src/config/satellite.js` · `src/integrations/satellite.js` | V3 | aucune |
| `src/integrations/geospatial.js` | V3 | aucune |
| `src/integrations/s3.js` · `src/integrations/storage.js` | V3 (dépôts géospatiaux) | aucune |
| `src/integrations/twilioSignature.js` | V3 (webhook d'accusés SMS) | aucune |
| `src/middleware/apiKey.js` | V4 (API partenaires) | aucune |
| `src/modules/smsDelivery/smsDelivery.routes.js` | V3 (consentement et alertes SMS) | aucune (le service reste chargé, §3.4) |
| `src/modules/soil/rulesets.routes.js` | V3 (règles agronomiques) | aucune |
| `src/shared/dataMode.js` | V3 (mode simulation IoT) | aucune |
| `src/shared/fileMagic.js` · `fileParsers.js` · `multipart.js` | V3 (imports géospatiaux) | aucune |
| `src/shared/matching.js` | V2 (appariement offre/demande) | aucune |
| `src/shared/money.js` · `orderStateMachine.js` · `pdf.js` | V2 (commandes, factures) | aucune |
| `src/shared/quota.js` · `resource.js` | V4 (quotas API) | aucune |

Dépendance npm alors inutilisée : **`pdfkit`** (seul import dans `shared/pdf.js`).

### 3.2 Routes montées relevant de V2-V5 (dans des modules V1)

| Routes | Nombre | Fichiers | Version | Proposition |
|---|---|---|---|---|
| `/cooperatives/:id/group-offers` (+ `preview`, `confirm`, `cancel`) | 5 | `cooperatives.routes.js`, `groupoffers.service.js` | **V2** (CDC V1 §3.10 : relève des fonctions commerciales) | Retirer |
| `/plots/:id/suitability` (×3), `/rotation-plans` (×3), `/farming-plans` (×2), `/yield-estimates` (×2) | 10 | `soil.routes.js`, `intelligence.service.js`, `intelligence.schema.js` | **V3** (feuille de route §6.3 A-B : plans, rotation, rendements, adéquation culture-sol) | Retirer |
| `/plots/:id/soil-assessments` (×4), `/soil-profile` | 5 | `soil.routes.js`, `soil.service.js` | **V1** (§4.3 D : « informations relatives aux sols, premiers diagnostics ») | Conserver |
| `/countries/fx-rates` (×3) | 3 | `countries.routes.js`, `fx.service.js` | **V5** (devises, feuille de route §8.3 C) | Retirer (à confirmer) |
| `/countries`, `/countries/:code` | 3 | `countries.routes.js` | V1 (§4.3 A : pays et paramètres territoriaux) | Conserver |
| `/admin/operations/:entity` pour `listing` et `review` | partie de 3 | `admin.operations.service.js:25-50` (bouchons « V2 désactivé ») | **V2** | Retirer les entités `listing` et `review`, garder `verification` |
| Conversations sur `LISTING`, `ORDER`, `TRANSPORT`, `DISPUTE`, `PROJECT` | (même route) | `messaging.service.js` (`SUBJECT_MODEL`, `contactAboutListing`), schéma de `messaging.routes.js` | **V2/V4** | Restreindre `subjectType` à `DIRECT` et `GROUP` (422 pour les autres) |
| `/public/blog-posts` (×2), `/admin/blog-posts` (×4) | 6 | `blog.*` | **Aucun CDC** | À confirmer (site public) |
| `/public/map`, `/public/soil-stats` | 2 | `public.*` | À confirmer (cartographie publique : V3 ?) | À confirmer |
| `/public/farms/:slug/qr.:format` | 1 | `public.*` | À confirmer (QR de profil V1, ou traçabilité V3 ?) | À confirmer |

Les **154 autres routes** sont V1 ou relèvent du module de communication conservé (X3).

### 3.3 Tâches planifiées (`src/jobs/index.js`)

| Tâche | Version | État actuel | Proposition |
|---|---|---|---|
| `calls.expireRinging`, `notifications.purge` | V1 / communication | Réelles | Conserver |
| `listings.expire`, `orders.expirePending`, `disputes.sla` | V2 | Lisent des tables V2 vides | Retirer |
| `dataroom.expireAccess`, `apikeys.expire` | V4 | Idem | Retirer |
| `iot.markSilent`, `recommendations.monitor`, `alerts.escalate`, `satellite.acquire`, `sensors.detectAnomalies` | V3 | **Bouchons** renvoyant des compteurs à zéro (affichés comme exécutions réussies dans l'administration, E7) | Retirer |

### 3.4 Code chargé contenant du V2-V5

| Élément | Emplacement | Version | Proposition |
|---|---|---|---|
| Garde de démarrage « matériel » (IoT) | `src/server.js` → `src/config/hardware.js` | V3 | Retirer l'appel et le fichier ; `tests/hardware.test.mjs`, `scripts/check-hardware-doc.mjs`, `recalibrate-hardware-doc.mjs` avec |
| Rapport des services dégradés : satellite, GeoAI, stockage géospatial | `src/shared/startup/degradedServices.js`, appel dans `server.js` | V3 | Retirer ces entrées ; garder SMS, e-mail, MFA |
| Variables d'environnement V2+ (`SATELLITE_*`, `GEOAI_URL`, `GEOSPATIAL_*`, `IOT`/`HARDWARE_*`…) | `src/config/env.js` | V3-V4 | Retirer de la validation, après relevé exact |
| Pré-traitement du dépôt géospatial (`/geospatial/imports`) | `src/app.js:86-164` (gardes `gardeDepot`, `gardeDepotMultipart`) | V3 | Retirer (route absente en V1) |
| Statistiques admin : annonces, commandes, litiges | `admin.service.js:133-135` | V2 | Retirer ces compteurs (toujours 0) |
| Vue sécurité : clés d'API | `admin.security.service.js:160-169` | V4 | Retirer |
| Supervision : `ApiUsage` | `admin.monitoring.service.js` | V4 | Retirer |
| Profil investisseur dans `GET /me` | `users.service.js:182` | V4 | Retirer |
| Service SMS : OTP (V1) **et** consentement et alertes (V3) | `smsDelivery.service.js` | mixte | Garder l'OTP (`sendOtpSms`, appelé par `auth.service.js`) ; retirer le reste après lecture détaillée |
| Rôle `GOVERNANCE_ROLES` → `ACADEMIA_ADMIN` absent des migrations (E8) | `admin.security.service.js` | V1 (Academia fondations) | Hors retrait : décision E8 |

### 3.5 Permissions (`src/shared/permissions.js`)

101 clés ne sont utilisées par aucune route. Proposition :
- **retirer (V2-V5)** : `listings.*`, `requests.*`, `offers.*`, `orders.*`, `inventory.*`, `transport.*`, `invoices.*`, `reviews.*`, `disputes.*`, `sync.write`, `ai.*`, `weather.read`, `prices.*`, `lots.*`, `certifications.*`, `iot.*`, `geodata.*`, `channels.read`, `lab.*`, `projects.*`, `investors.*`, `dataroom.*`, `duediligence.*`, `reporting.*`, `funding.*`, `precision.*`, `geospatial.*`, `tenders.*`, `export.*`, `apiclients.*`, `insights.read`, `dataproducts.manage`, `data.read`, `recommendation.*`, `seasons.*`, `ranges.*`, `alerts.*`, `forecast.*`, `models.*`, `satellite.*`, `anomaly.*` ;
- **conserver** : `academia.*`, `affiliations.*`, `institutions.*` (X1) ; `admin.roles`, `admin.security`, `admin.flags`, `admin.maintenance` (gouvernance V1, routes protégées par `requireSuperAdmin`, à rebrancher ou documenter).

**Rôles :** les 19 rôles de l'énumération sont conservés. `INVESTOR`, `LAB_PARTNER`, `API_CLIENT`… font partie du modèle de rôles V1 (CDC V1 §3.4 : « la liste décrit les rôles du système, pas leurs fonctionnalités en V1 »).

### 3.6 Base de données

| Groupe | Modèles |
|---|---|
| V1 et communication, utilisés | Profile, Organization, Membership, Country, Crop, Setting, SettingRevision, Farm, FarmCrop, Plot, PlotCropHistory, Production, Cooperative, CooperativeMember, Media, Document, Verification, Report, AuditLog, OtpCode, Token, SoilAssessment, SoilParameter, IdempotencyKey, Conversation, Message, Notification, NotificationPreference, MfaSecret, CallSession, CallParticipant, CallEvent, PushDevice, ResourceUsage, BlogPost (à confirmer) |
| V1 non encore utilisés | VerificationDocument ; fondations Academia : AcademicInstitution, AcademicUnit, AcademicProfile, AcademicAffiliation (X1) |
| V2-V5 utilisés par du code à retirer | Listing, Order, OrderEvent, Dispute, GroupOffer, InvestorProfile, DataRoomAccessRequest, DataRoomAccessLog, ApiKey, ApiUsage, AgronomicRuleSet, ZoneFeatureFlag, CropSuitability, RotationPlan, FarmingPlan, YieldEstimate, FxRate, SmsConsent, SmsMessage, SmsBatchLog (SMS : à confirmer, partie OTP) |
| V2-V5 jamais utilisés | 50 modèles : PurchaseRequest, Offer, InventoryItem, InventoryMovement, TransportRequest, TransportOffer, Invoice, Review, SyncOperation, AiAnalysis, WeatherData, MarketPrice, TraceabilityLot, LotEvent, Certification, IotDevice, SensorReading, SatelliteObservation, DroneSurvey, LabResult, Project, ProjectDocument, ProjectFollow, ProjectContactRequest, DueDiligenceItem, ProgressReport, ImpactReport, FundingRequest, ManagementZone, PrecisionReport, Tender, TenderResponse, ExportOrder, ExportDocument, ApiClient, ChannelSession, ChannelMessage, DataProduct, DataContract, Aggregate, SoilDiagnostic, CropRecommendation, ThresholdAlert, SoilPrediction, InterpolatedMap, SensorAnomaly, SeasonFeedback, AiModelVersion, GeospatialImport, CropAgronomicRange |

Le seed (`prisma/seed.js`) écrit dans `dataProduct` (V4) : à retirer de la graine.

### 3.7 Tests, scripts, documentation, outils

| Élément | Contenu V2-V5 | Proposition |
|---|---|---|
| Tests | 56 fichiers (relevé par nom ; `tests/` et `tests/e2e/`) qui ne chargent pas (modules retirés) ou testent des routes absentes : `alerts*`, `anomalies*`, `agronomicRanges*`, `forecast*`, `interpolation*`, `satellite*`, `seasons*`, `geospatial*`, `intelligence*`, `recommendation*`, `listings`, `orders`, `orderStateMachine`, `reviews`, `policies`, `families*`, `req-v2` à `req-v5`, `req-extra`, `dataMode`, `hardware`, `auditLot1`, `apiQuota`, `apiUsageWrite`, `multipartS3`, `fileMagic`, `fileParsers`, `smsTwilio`, `smsVerification`, `alertSmsJob`, `alertEscalation`, `twilioErrors`, `twilioWebhookUrl`, `channels`, `scoringEngine`, `seedDemo` | Retirer ou archiver hors de `tests/`. Liste exacte à figer fichier par fichier avant exécution (certains mêlent V1 et V2+ : `journeys`, `adminOperations`, `surfacePublique`, `webLinks`, `jobs`) |
| Références de tests | `tests/e2e/fixtures/surface-anonyme.json`, seuils de `surfacePublique` (≥ 340 routes) et de `webLinks` | Régénérer sur le routeur V1 |
| Scripts | `check-hardware-doc`, `recalibrate-hardware-doc`, `check-requirements` / `check-cdc` / `check-traceability` (exigences V1-V5) | Retirer ou restreindre à la V1 |
| Scripts npm | `geoai`, `test:geoai` ; `verify` (inclut `test:geoai`) | Retirer |
| Moteur Python | `backend/geoai/` (télédétection, interpolation, capteurs) | V3 : retirer du dépôt V1 (conservé dans l'historique Git) |
| Contrat OpenAPI | `src/docs/openapi.json` : 260 opérations sans implémentation ; version 5.0.0 | Régénérer (`npm run docs:openapi`) sur le routeur V1 |
| Documentation | `docs/` : `AGRONOMIC-RANGES`, `ECOCROP-AUDIT`, `GEOSPATIAL*` (×4), `SCORING-ENGINE`, `SEASONS`, `REQUIREMENTS` (V1-V5), `PERIMETRE-BACKEND` (385 routes) | Archiver dans `docs/archive-v2-v5/` ou retirer ; mettre `PERIMETRE-BACKEND` à jour |
| Fichiers de travail à la racine de `backend/` | `debug-delta.mjs`, `fix-*.mjs`, `test-*-sandbox.mjs`, `har.md`, `mess.md`, `tmp/`, `tests/*.stray.bak` | Hors directive V2-V5 ; nettoyage à décider séparément |

## 4. Stratégie pour la base de données

| Option | Contenu | Risque | Recommandation |
|---|---|---|---|
| **B1** | Schéma, migrations et tables **inchangés**. Retrait du code applicatif seulement. | Nul pour les données. Tables V2+ vides et non exposées. | **Recommandée** (conforme à X2) |
| B2 | Retrait des modèles V2+ de `schema.prisma`, tables conservées en base | **Dangereux** : le prochain `prisma migrate dev` générerait des `DROP TABLE` ; `check:migrations` signalerait une dérive | Déconseillée |
| B3 | Migration de suppression des tables V2+ | Destructif, irréversible sans sauvegarde ; contraire à la revue §6 | Exclue sans décision écrite et sauvegarde vérifiée |

Les migrations déjà appliquées ne sont jamais modifiées ni supprimées, quelle que soit l'option.

## 5. Plan d'exécution proposé (après validation)

Branche dédiée `retrait/v2-v5-backend`, un commit par lot, aucune fusion sans votre accord. Après chaque lot : `npm run check`, `check:fields`, `check:perms`, `check:mounts`, suites V1 (`stabilisationV1`, `realtimeStabilisation`, `revueContradictoireV1`, `req-v1`, `journeys` partie V1, `mfaLogin`, `verifyEmail`, `otpVerification`, `admin*`), avec journaux archivés.

| Lot | Contenu | Pré-requis | Retour arrière |
|---|---|---|---|
| P1 | Code mort (§3.1) et `pdfkit` | — | `git revert` |
| P2 | Tâches V2-V5 (§3.3) | P1 | `git revert` |
| P3 | Routes V2-V5 dans les modules V1 (§3.2, lignes « Retirer ») et services associés | Décisions sur les lignes « À confirmer » | `git revert` |
| P4 | Ancrages V2-V5 dans le code chargé (§3.4) | P3 | `git revert` |
| P5 | Permissions (§3.5) | P3 ; `check:perms` = 0 manquante | `git revert` |
| P6 | Tests, références, scripts, OpenAPI, documentation, `geoai/` (§3.7) | P1-P5 | `git revert` |
| P7 | Base de données selon l'option retenue (§4) | Décision X2 | B1 : rien à faire |

**Contrats exposés au Web et au Mobile :** P3 retire 18 routes et restreint `subjectType`. Tout appel restant des clients vers ces routes recevra 404 ou 422. Un relevé des appelants (`apps/web`, `apps/Mobile`) sera joint au lot P3.

## 6. Décisions attendues

1. X1 : conserver les fondations Academia en V1 ?
2. X2 : option B1 pour la base de données ?
3. X4 : « préparation » V1 = documentaire uniquement ?
4. Lignes « À confirmer » : `fx-rates`, blog, `/public/map`, `/public/soil-stats`, QR de profil, modèles SMS (consentement).
5. Archivage (`docs/archive-v2-v5/`) ou suppression pour la documentation et `geoai/` ?
6. Ordre : appliquer d'abord les correctifs de la revue contradictoire (W11, W12, A3, I4c…), ou d'abord le retrait V2-V5 ?
