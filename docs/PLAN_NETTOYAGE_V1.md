# Plan de nettoyage du dépôt — AGRIKONNECT AFRICA V1

**Date :** 25 novembre 2026 · **Pour :** responsable du projet (autorisation) et architecte.
**Statut : INVENTAIRE ET PLAN. AUCUNE SUPPRESSION EFFECTUÉE.** Chaque lot du §9 attend votre autorisation explicite.
**Liste exacte, fichier par fichier :** [`NETTOYAGE_V1_LISTE_EXACTE.tsv`](NETTOYAGE_V1_LISTE_EXACTE.tsv), produite par [`nettoyage-v1-classer.mjs`](nettoyage-v1-classer.mjs) (règles explicites, reproductible : `node docs/nettoyage-v1-classer.mjs docs/NETTOYAGE_V1_LISTE_EXACTE.tsv` depuis la racine).
**Remplace** le plan backend [`backend/docs/PLAN_RETRAIT_V2_V5.md`](../backend/docs/PLAN_RETRAIT_V2_V5.md) là où ils diffèrent : la nouvelle exception messagerie et hors ligne l'emporte (§3).

## 1. Méthode

| Étape de la directive | Réalisation |
|---|---|
| 1. Inventorier tous les fichiers | `git ls-files` + fichiers non suivis non ignorés : **11 241 fichiers** |
| 2. Appartenance V1 / futur | Règles explicites (CDC V1 §3 et §15, feuille de route V1-V5 §4 à §8), graphe d'imports du backend depuis `server.js`, routes Express réellement montées (181), liens de navigation et appels d'API des écrans Web et Mobile |
| 3. Messagerie et hors ligne | Catégories distinctes `CONSERVER-MSG` et `EXAMINER-MSG` (§3) |
| 4-5. Dépendances, impacts | §6 et §7 |
| 6-7. Listes et risques | §2, §4, §5, §8 |
| 8. Autorisation | §10 |

## 2. Résultat

| Décision | Fichiers | Contenu |
|---|---|---|
| **CONSERVER** — V1 et socle | 632 | Code V1, migrations (toutes), schéma, tests V1, configuration, ressources |
| **CONSERVER-MSG** — messagerie et hors ligne | 76 | §3.1 |
| **EXAMINER-MSG** — exception, décision explicite requise | 23 | §3.2 |
| **EXAMINER** — base de données, sauvegarde, sources du CDC, à confirmer | 316 | §6 |
| **MODIFIER** — fichiers mixtes V1 + V2-V5 | 48 | §5 |
| **SUPPRIMER** | **10 146**, dont **9 916** de cache généré | §4 |

Les cahiers des charges maîtres (CDC général, feuille de route V1-V5, CDC V1) **ne sont pas dans le dépôt**. Ils n'existent que dans les documents transmis par le responsable du projet. Le nettoyage ne peut donc pas les toucher. Je recommande de les verser dans `docs/reference/`.

## 3. Exception messagerie et hors ligne

### 3.1 Conservés sans condition (76 fichiers)

| Couche | Éléments |
|---|---|
| Backend | `modules/messaging`, `modules/calls` (webhook LiveKit compris), `modules/push`, `modules/notifications`, `realtime/` (`index.js`, `bus.js`, `sendGuard.js`), `shared/conversations.js`, `shared/events.js`, `integrations/livekit.js`, `integrations/push.js`, `config/messagingConfig.js`, `middleware/idempotency.js` |
| Backend — base | Modèles et tables Conversation, Message, CallSession, CallParticipant, CallEvent, PushDevice, Notification, NotificationPreference, IdempotencyKey, **SyncOperation**, ChannelSession, ChannelMessage, SmsConsent, SmsMessage, SmsBatchLog : **aucun modèle ni aucune table n'est retiré** (option B1) |
| Backend — tests | `messaging.integration`, `messagingConfig`, `calls`, `push`, `stabilisationV1` (unitaires et e2e), e2e `calls`, `push`, `realtimeStabilisation`, `revueContradictoireV1`, `support/socketClient.mjs` |
| Backend — docs | `APPELS_AUDIO.md`, `PLAN_MIGRATION_STAGING_APPELS.md`, `PREUVES_SECURITE_WEBSOCKET.md`, `PREUVES_IDEMPOTENCE_SYNC.md` |
| Mobile | `src/db/` (base SQLite locale), `services/OfflineSyncEngine.ts`, `services/realtime.ts`, `features/calls/`, `app/messages/`, `app/notifications/` (préférences et consentement SMS compris), `app/admin/messages.tsx`, tests `calls-machine`, `push-plan` |
| Web | `pages/app/Messages`, `Conversation`, `Notifications`, `NotificationPreferences`, `SmsConsent`, `features/calls/`, `services/realtime.ts`, test `calls-machine` |
| Sections de code dans des fichiers mixtes | Sections « Messaging & notifications », « Consentement SMS », « Médias », « Synchronisation hors-ligne » et `syncApi` des deux `endpoints.ts` ; permissions `messages.*`, `sync.write`, `channels.read` ; tâches `calls.expireRinging`, `notifications.purge` ; cas `SYNC-01/02` de `journeys.e2e` |

### 3.2 À examiner au titre de l'exception (23 fichiers) — aucune action sans votre autorisation

| Élément | Pourquoi il est à examiner | Proposition |
|---|---|---|
| SMS : `integrations/sms.js`, `twilio*.js`, `modules/smsDelivery/`, `shared/quietHours.js`, `senderId.js`, docs `SMS-TWILIO.md`, `SMS-OTP-TEST-REEL.md`, 10 tests SMS/Twilio | Communication par SMS. Le service sert à l'**OTP V1** (`auth.service.js` → `sendOtpSms`) **et** aux alertes et accusés de remise V3 | Conserver en entier (classement : communication) |
| `e2e/channels.e2e` | Canaux WhatsApp/USSD (V3 au calendrier, mais messagerie) | Conserver ; rétablir plus tard si le module canaux est réintégré |
| `e2e/alertSmsJob.e2e`, `alertMessageGsm.test` | Alertes V3 envoyées par SMS | À trancher : alerte (V3) ou messagerie ? |
| `apps/Mobile/src/app/admin/sync.tsx` | Écran hors ligne réduit à une coquille (27 lignes, aucun appel) | Conserver ; à compléter en phase Mobile |
| `backend/mess.md` | Consigne de mission messagerie | Conserver dans la traçabilité |
| Sujets de conversation `LISTING`, `ORDER`, `TRANSPORT`, `DISPUTE`, `PROJECT` (`messaging.service.js`) | Messagerie, mais attachée à des objets V2-V4 absents | **Ne pas modifier** (contrairement à ce que proposait `PLAN_RETRAIT_V2_V5.md` §3.2) |

### 3.3 Anomalies hors ligne relevées pendant l'inventaire — signalées, non corrigées

| ID | Constat | Preuve | Effet |
|---|---|---|---|
| OFF-1 | `OfflineSyncEngine` tire les messages par **`POST /chat/sync`**, une route qui **n'existe pas** dans le backend (qui expose `POST /messaging/sync`) | `apps/Mobile/src/services/OfflineSyncEngine.ts:272` ; 181 routes montées, aucune `/chat` ; introduit par `a7a27e5` | Le tirage hors ligne des messages échoue probablement en 404. **Non vérifié sur appareil.** |
| OFF-2 | Client `syncApi` (`/sync/collections`, `/sync/push`, `/sync/pull`, `/sync/conflicts`) : aucun appelant, et backend `/sync` absent en V1 (module `sync` présent jusqu'à `e10e28c`) | `apps/Mobile/src/services/api/endpoints.ts:1017` | Synchronisation générique des données (exploitations, parcelles) inexistante en V1 |
| OFF-3 | Anomalies de la revue contradictoire : S2 (perte en synchronisation concurrente), W11/W12 (réception après révocation), I4c (doublon) | `backend/docs/REVUE_CONTRADICTOIRE_BACKEND_V1.md` | Inchangé |

## 4. Suppressions proposées (10 146 fichiers)

| Lot | Catégorie | Fichiers | Éléments |
|---|---|---|---|
| S1 | Cache généré | 9 916 | `apps/Mobile/.metro-cache/`, versionné par erreur ; ajout à `.gitignore` |
| S2 | Temporaires | 87 | 45 scripts `flux/fix-*.mjs` ; 15 `scripts/fix-p*.mjs` / `.b64` / `captures-p1.mjs` ; `scripts/p1-avant/` (10 copies de pages V2+) ; racine : `openapi-sonde.json`, `diag-derive-redirects.txt`, `sortie-surface.txt`, `user-paste-surface.txt`, `probe-mounts.mjs`, `sonde-env.mjs`, `repar-fix.mjs`, `tr.md` ; `backend/` : `debug-delta.mjs`, `fix-e2e-residus.mjs`, `fix-m2-tests.mjs`, `test-doublon-sandbox.mjs`, `test-baseline-sandbox.mjs`, `check-super-admin.mjs` ; `backend/tests/*.stray.bak` (2) ; `apps/Mobile/fiche.md` |
| S3 | Backend : code V2-V5 | 22 | 19 fichiers jamais chargés (hors `twilioSignature.js` et `smsDelivery.routes.js`, passés en §3.2), plus `config/hardware.js`, `groupoffers.service.js`, `soil/intelligence.service.js` et `intelligence.schema.js`, `countries/fx.service.js` (avec leurs points d'appel, §5) |
| S4 | Backend : moteur et scripts V3 | 25 | `backend/geoai/` (23), `scripts/check-hardware-doc.mjs`, `recalibrate-hardware-doc.mjs` |
| S5 | Backend : tests V2-V5 | 47 | 34 unitaires et d'intégration (`alerts`, `anomalies`, `forecast*`, `geospatial*`, `intelligence`, `interpolation`, `listings`, `orders`, `orderStateMachine`, `policies`, `recommendation*`, `req-v2` à `req-v5`, `req-extra`, `reviews`, `satellite`, `seasons`, `dataMode`, `hardware`, `fileMagic`, `fileParsers`, `multipartS3`, `apiQuota`, `apiUsageWrite`, `agronomicRangesCsv`, `alertLabels`, `families.integration`) et 13 e2e (`agronomicRanges`, `alertEscalation`, `alerts`, `anomalies`, `forecastPipeline`, `geospatialImport`, `geospatialQuota`, `geospatialUpload`, `intelligence`, `interpolation`, `satellite`, `scoringEngine`, `seasons`) |
| S6 | Documentation V2-V5 et V1→V5 remplacée | 25 | 14 exclusivement V2-V5 (`AGRONOMIC-RANGES`, `ECOCROP-AUDIT`, `GEOSPATIAL*` ×4, `SCORING-ENGINE`, `SEASONS`, `COMPTE-RENDU-ECRAN2/ECRAN3/SEASONS-APIUSAGE`, `ACCEPTANCE`, `ROUTES-SANS-APPELANT`, `ROUTES-SANS-ECRAN`) ; 11 inventaires V1→V5 ou doublons (`CDC-INVENTAIRE`, `NFR`, `REQUIREMENTS`, `TRACEABILITY`, `DOC-TECH-1` ×2, `DOC-TECH-2`, `DOC-TECH-3`, `DOCUMENTATION_TECHNIQUE`, `docs/docs.md`, spécification Web V1→V5) — **supprimés seulement après création de la documentation V1 unique** |
| S7 | Mobile et Web : écrans V2-V5 | 24 | Mobile : `admin/` agronomic-ranges, ai-usage, api-clients, data-products, devices, investors, lots, marketplace, orders, partners, prices, projects, rules ; `farmer/alerts` ; `farmer/plots/[id]/` plan, precision-report, recommendations, rotation, satellite, sensors, zones ; `projets` ; composant `RecommendationMethod` ; Web : `pages/farmer/Plots/RecommendationMethod.tsx` (non routée) |

**Aucune migration, aucun modèle, aucune table ne sont supprimés** (§7). Tout reste récupérable dans l'historique Git.

## 5. Modifications nécessaires (48 fichiers)

Une suppression laisse des références : ces fichiers doivent être modifiés **dans le même lot** pour que tout compile.

| Groupe | Fichiers | Modification |
|---|---|---|
| Backend : points d'appel | `server.js` (garde matériel), `app.js` (dépôt géospatial, l. 86-164), `config/env.js`, `shared/startup/degradedServices.js`, `jobs/index.js` (10 tâches V2-V5), `cooperatives.routes.js` (offres groupées), `soil.routes.js` (10 routes V3), `countries.routes.js` (`fx-rates`), `admin.service.js` / `admin.security.service.js` / `admin.monitoring.service.js` / `admin.operations.service.js` (compteurs et entités V2-V4), `users.service.js` (profil investisseur), `shared/permissions.js` (clés V2-V5, sauf §3.1), `prisma/seed.js` (`dataProduct`), `package.json` (scripts `geoai`, `test:geoai`, listes de tests ; dépendance `pdfkit`), `src/docs/openapi.json` (régénéré) |
| Backend : tests mixtes | `auditLot1`, `families-v1.integration` (**tests V1 qui ne tournent plus** : un import de module retiré empêche le chargement du fichier entier ; à réparer), `journeys.e2e` (cas V2-V5 retirés, `SYNC-01/02` conservés en §3), `adminOperations` (unitaire et e2e), `jobs.integration`, `webLinks`, `surfacePublique.e2e` et sa référence `surface-anonyme.json`, `startupReport` |
| Mobile et Web : navigation et clients | `apps/Mobile/src/app/admin/dashboard.tsx`, `farmer/(tabs)/index.tsx`, `farmer/plots/[id].tsx` (liens vers les écrans S7) ; sections V2-V5 des deux `endpoints.ts` (MARKET, INTELLIGENCE, INVEST, V5, Retours de saison, Capteurs, IA, Développeurs, Transport, Export, Satellite, Recommandation, Alertes, Anomalies, Référentiel agronomique), **sections messagerie et hors ligne conservées** |
| Contenu public | Catalogues de services, FAQ, diapositives d'accueil, navigation Web (`space-nav.ts`) et 2 visuels : ils présentent des services V2-V5 comme disponibles. **Décision de contenu** : retirer, ou afficher « à venir » |
| Documentation à réécrire | `backend/README.md`, `MANIFEST.md`, `docs/API.md`, `DEPLOYMENT.md`, `apps/Mobile/README.md`, `apps/web/README.md` |
| Configuration | `.gitignore` (`.metro-cache/`) |

## 6. À examiner — décisions requises (316 fichiers)

| Groupe | Fichiers | Constat | Proposition |
|---|---|---|---|
| Base de données | 7 | `fix-baseline.mjs`, `fix-schema-doublon.mjs`, `complement-indexes.sql`, `delta-baseline.sql`, `bootstrap-super-admin.sql`, `flux/sql unique.md`, `maj-cle.mjs` : mise sous gestion Prisma de la base Supabase existante, index, installation de la clé de service. Aucun secret en clair relevé | **Conserver**, regroupés dans `backend/scripts/base/` et documentés |
| Sauvegarde Mobile | 279 | `apps/Mobile_src_backup_20261031_1901/`, référencée par aucune configuration. Le CDC V1 §17 impose de préserver les sauvegardes | Conserver, ou sortir du dépôt de travail (archive externe) : **décision** |
| Sources citées par le CDC V1 §1.2 | 5 | `LISEZ-MOI.md`, `RAPPORT-AUDIT-FINAL.md`, `COHERENCE-3-PARTIES.md`, `PERIMETRE-BACKEND.md`, `PAGES-PROJET.md` : sources obligatoires, mais contenu V1→V5. `docs/SPEC-SUPER-ADMIN.md`, cité lui aussi, **est absent du dépôt** | Archiver dans `docs/archive-historique/`, puis les remplacer par la documentation V1 |
| À confirmer | 25 | Blog et actualités (aucun CDC) ; `public-site/sols` (statistiques publiques des sols) ; coquilles `admin/compliance` et `admin/moderation` ; rapports historiques (`flux/`, `HARMONISATION-*`, `ACADEMIA-01`, `COMPTE-RENDU-MFA-EMAIL`, `har.md`) ; scripts de livraison | Décision au cas par cas |

## 7. Dépendances et impacts

| Couche | Impact | Contrôle |
|---|---|---|
| Backend | 18 routes retirées (offres groupées 5, intelligence 10, `fx-rates` 3) ; 10 tâches ; permissions V2-V5 ; garde matériel au démarrage | `check`, `check:fields`, `check:perms` (0 manquante), `check:mounts`, suites V1 |
| API / contrat | Ces 18 routes répondront 404. Contrat OpenAPI régénéré : retrait des 260 opérations documentées sans implémentation (`check:mounts`) | Relevé des appelants Web et Mobile joint au lot |
| Web | Aucune page routée supprimée ; sections V2-V5 de `endpoints.ts` retirées, ainsi que la navigation | `tsc`, `vite build`, `vitest` |
| Mobile | 22 écrans retirés ; 3 fichiers de navigation modifiés | `tsc`, export du bundle, `node --test` (tests mobiles) |
| Base de données | **Aucun** (option B1) : tables, migrations et `schema.prisma` intacts | `check:migrations` |
| Services externes | Satellite, GeoAI, stockage géospatial : configuration retirée. SMS, e-mail, LiveKit, Supabase : inchangés | Rapport de démarrage |
| Messagerie / hors ligne | **Aucun** : rien n'est supprimé ni modifié | `realtimeStabilisation`, `revueContradictoireV1`, `stabilisationV1`, `calls`, `push`, tests mobiles et Web d'appels |

## 8. Risques

| # | Risque | Mesure |
|---|---|---|
| 1 | Un client appelle encore une route retirée (écran oublié, lien) | Relevé `grep` des appelants avant chaque lot ; `tsc` Web et Mobile |
| 2 | Tests mixtes : la réparation de `auditLot1` et `families-v1` peut révéler des **échecs V1 aujourd'hui invisibles** | Ils seront présentés tels quels, pas masqués (§4 de la directive) |
| 3 | `.metro-cache` : premier démarrage Mobile plus lent après la suppression (cache reconstruit) | Aucun effet fonctionnel |
| 4 | Documentation : supprimer avant d'avoir la documentation V1 ferait perdre de l'information | S6 seulement après validation de la documentation V1 |
| 5 | Taille de l'historique Git : la suppression ne réduit pas la taille du dépôt (cache toujours dans l'historique) | Réécriture d'historique **exclue** sans décision séparée |
| 6 | Erreur de classement | Liste exacte relisible (TSV) ; un commit par lot, annulable par `git revert` |

## 9. Exécution, après autorisation

Branche `nettoyage/v1`, un commit par lot, aucune fusion sans votre accord. Journaux de chaque contrôle conservés dans `docs/preuves/nettoyage/`.

| Ordre | Lot | Dépend de |
|---|---|---|
| 1 | S1 (cache) + `.gitignore` | — |
| 2 | S2 (temporaires) | — |
| 3 | S3 + S4 + modifications backend (§5) + S5 + tests mixtes | décisions §6 « À confirmer » sur blog et `fx-rates` |
| 4 | S7 + modifications Mobile et Web (§5) | décision de contenu public |
| 5 | Documentation V1 unique (§10), puis S6 et archivage des sources | lots 1 à 4 |

Après chaque lot : contrôles du §7 et rapport réel (réussites, échecs, non vérifié).

## 10. Documentation V1 unique (à produire au lot 5)

`docs/V1/` : 1. Vue d'ensemble et périmètre ; 2. Architecture ; 3. Modules backend ; 4. API (OpenAPI régénéré) ; 5. Modèle de données (avec les tables historiques V2-V5 conservées et non exposées) ; 6. Rôles et permissions ; 7. **Messagerie, appels et temps réel** ; 8. **Fonctionnement hors ligne et synchronisation** (avec OFF-1 à OFF-3) ; 9. Web ; 10. Mobile ; 11. Tests et preuves, avec deux colonnes distinctes : **TESTÉ** (exécuté sur banc local, journal) et **VALIDÉ** (accepté par le responsable du projet ; aujourd'hui : rien) ; 12. Anomalies ouvertes et décisions. Les preuves historiques (`backend/docs/preuves/`, rapports de stabilisation et de revue) sont conservées.

## 11. Autorisations demandées

1. Lots S1 et S2 (cache, temporaires) : sans risque fonctionnel. **Autoriser ?**
2. Lots S3 à S5 et S7 avec les modifications du §5 : **autoriser ?**
3. Exception §3.2 : conserver SMS, canaux et `admin/sync` en entier ? Classement de `alertSmsJob` / `alertMessageGsm` ?
4. §6 : scripts de base, sauvegarde Mobile, sources du CDC, liste « À confirmer ».
5. Contenu public : retirer les services V2-V5, ou les afficher « à venir » ?
6. OFF-1 (`/chat/sync`) : autoriser la correction (hors ligne, donc soumise à votre accord explicite) ?
7. Verser les cahiers des charges maîtres dans `docs/reference/` ?
