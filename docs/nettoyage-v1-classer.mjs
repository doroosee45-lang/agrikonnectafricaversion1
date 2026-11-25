import { execSync } from 'node:child_process';
import fs from 'node:fs';

const brut = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 1e8 }).split('\n').filter(Boolean);
const fichiers = [...brut('git -c core.quotepath=off ls-files'), ...brut('git -c core.quotepath=off ls-files --others --exclude-standard')];

const R = [];
const regle = (d, c, m, t) => R.push([d, c, m, t]);
const exact = (liste) => (f) => liste.includes(f);
const re = (x) => (f) => x.test(f);

// ── EXCEPTION messagerie / hors ligne : EXAMINER (décision explicite requise) ──
regle('EXAMINER-MSG', 'Exception messagerie/hors ligne', 'SMS, canaux et webhooks de remise : messagerie au sens large, décision explicite requise',
  re(/^backend\/(src\/integrations\/(twilio|twilioErrors|twilioSignature|sms)\.js|src\/modules\/smsDelivery\/.+|src\/shared\/(quietHours|senderId)\.js|tests\/(twilio[A-Za-z]*|quietHours|alertMessageGsm)\.test\.mjs|tests\/e2e\/(smsTwilio|smsVerification|twilioErrors|twilioWebhookUrl|channels|alertSmsJob)\.e2e\.test\.mjs|docs\/(SMS-TWILIO|SMS-OTP-TEST-REEL)\.md)$/));
regle('EXAMINER-MSG', 'Exception messagerie/hors ligne', 'Hors ligne : écran coquille sans appel d’API', exact(['apps/Mobile/src/app/admin/sync.tsx']));
regle('EXAMINER-MSG', 'Exception messagerie/hors ligne', 'Consigne de mission messagerie (source de la phase 1)', exact(['backend/mess.md']));

// ── CONSERVER : messagerie / hors ligne ──
regle('CONSERVER-MSG', 'Messagerie/hors ligne', 'Messagerie, appels, temps réel, push, notifications, idempotence',
  re(/^backend\/src\/(modules\/(messaging|calls|push|notifications)\/.+|realtime\/.+|shared\/(conversations|events)\.js|integrations\/(livekit|push)\.js|config\/messagingConfig\.js|middleware\/idempotency\.js)$/));
regle('CONSERVER-MSG', 'Messagerie/hors ligne', 'Tests messagerie, appels, push, temps réel, idempotence et synchronisation',
  re(/^backend\/tests\/((messaging\.integration|messagingConfig|calls|push|stabilisationV1)\.test\.mjs|e2e\/(calls|push|stabilisationV1|realtimeStabilisation|revueContradictoireV1)\.e2e\.test\.mjs|e2e\/support\/socketClient\.mjs)$/));
regle('CONSERVER-MSG', 'Messagerie/hors ligne', 'Documentation messagerie, appels et preuves',
  re(/^backend\/docs\/(APPELS_AUDIO|PLAN_MIGRATION_STAGING_APPELS|PREUVES_SECURITE_WEBSOCKET|PREUVES_IDEMPOTENCE_SYNC)\.md$/));
regle('CONSERVER-MSG', 'Messagerie/hors ligne', 'Mobile : base locale, moteur hors ligne, temps réel, messages, appels, notifications',
  re(/^apps\/Mobile\/(src\/(db\/.+|services\/(OfflineSyncEngine|realtime)\.ts|features\/calls\/.+|app\/(messages|notifications)\/.+|app\/admin\/messages\.tsx)|tests\/(calls-machine|push-plan)\.test\.mts)$/));
regle('CONSERVER-MSG', 'Messagerie/hors ligne', 'Web : messagerie, appels, temps réel, notifications',
  re(/^apps\/web\/(src\/(features\/calls\/.+|services\/realtime\.ts|pages\/app\/(Messages|Conversation|Notifications|NotificationPreferences|SmsConsent)\.tsx)|tests\/calls-machine\.test\.ts)$/));

// ── SUPPRIMER : générés / temporaires ──
regle('SUPPRIMER', 'Cache généré', 'Cache du bundler Metro versionné par erreur', re(/^apps\/Mobile\/\.metro-cache\//));
regle('SUPPRIMER', 'Temporaire', 'Journal de test local', exact(['test-run.log']));
regle('SUPPRIMER', 'Temporaire', 'Sondes et sorties d’exécution ponctuelles à la racine',
  exact(['openapi-sonde.json', 'diag-derive-redirects.txt', 'sortie-surface.txt', 'user-paste-surface.txt', 'probe-mounts.mjs', 'sonde-env.mjs', 'repar-fix.mjs', 'tr.md']));
regle('SUPPRIMER', 'Temporaire', 'Script de correction ponctuel déjà appliqué (historique Git conservé)',
  re(/^(flux\/fix-[^/]+\.mjs|scripts\/fix-p[^/]+\.(mjs|b64)|scripts\/captures-p1\.mjs|scripts\/p1-avant\/.+|backend\/(debug-delta|fix-e2e-residus|fix-m2-tests|test-doublon-sandbox|test-baseline-sandbox|check-super-admin)\.mjs|backend\/tmp\/.+|backend\/tests\/.+\.stray\.bak|apps\/Mobile\/fiche\.md)$/));

// ── EXAMINER : intégrité base, sauvegardes, sources citées par le CDC V1 ──
regle('EXAMINER', 'Base de données', 'Mise sous gestion Prisma de la base existante, index : intégrité de la base',
  exact(['backend/fix-baseline.mjs', 'backend/fix-schema-doublon.mjs', 'backend/complement-indexes.sql', 'backend/delta-baseline.sql', 'backend/bootstrap-super-admin.sql', 'flux/sql unique.md', 'maj-cle.mjs']));
regle('EXAMINER', 'Sauvegarde', 'CDC V1 §17 : « les sauvegardes existantes doivent être préservées »', re(/^apps\/Mobile_src_backup_20261031_1901\//));
regle('EXAMINER', 'Source citée par le CDC V1 §1.2', 'Source obligatoire selon le CDC V1, contenu mêlant V1 et V2+',
  exact(['flux/LISEZ-MOI.md', 'flux/RAPPORT-AUDIT-FINAL.md', 'docs/COHERENCE-3-PARTIES.md', 'backend/docs/PERIMETRE-BACKEND.md', 'docs/PAGES-PROJET.md']));

// ── MODIFIER : fichiers mixtes ──
regle('MODIFIER', 'Test mixte', 'Tests V1 qui ne tournent plus (import d’un module retiré) : retirer la partie V2+, réparer la partie V1',
  exact(['backend/tests/auditLot1.test.mjs', 'backend/tests/families-v1.integration.test.mjs']));
regle('MODIFIER', 'Test mixte', 'Cas V1 et V2-V5 mêlés : retirer les cas V2-V5 (SYNC-01/02 de journeys : hors ligne, à examiner)',
  exact(['backend/tests/e2e/journeys.e2e.test.mjs', 'backend/tests/adminOperations.test.mjs', 'backend/tests/e2e/adminOperations.e2e.test.mjs', 'backend/tests/jobs.integration.test.mjs', 'backend/tests/webLinks.test.mjs', 'backend/tests/e2e/surfacePublique.e2e.test.mjs', 'backend/tests/e2e/fixtures/surface-anonyme.json', 'backend/tests/startupReport.test.mjs']));
regle('MODIFIER', 'Code mixte', 'Sections V2-V5 à retirer (client d’API, navigation, ancrages V2+)',
  exact(['apps/Mobile/src/services/api/endpoints.ts', 'apps/web/src/services/endpoints.ts', 'apps/Mobile/src/app/farmer/plots/[id].tsx', 'apps/Mobile/src/app/admin/dashboard.tsx', 'apps/Mobile/src/app/farmer/(tabs)/index.tsx',
    'backend/src/jobs/index.js', 'backend/src/server.js', 'backend/src/app.js', 'backend/src/config/env.js', 'backend/src/shared/startup/degradedServices.js', 'backend/src/shared/permissions.js',
    'backend/src/modules/admin/admin.service.js', 'backend/src/modules/admin/admin.security.service.js', 'backend/src/modules/admin/admin.monitoring.service.js', 'backend/src/modules/admin/admin.operations.service.js',
    'backend/src/modules/users/users.service.js', 'backend/src/modules/cooperatives/cooperatives.routes.js', 'backend/src/modules/soil/soil.routes.js', 'backend/src/modules/countries/countries.routes.js',
    'backend/package.json', 'backend/prisma/seed.js', 'backend/src/docs/openapi.json', '.gitignore']));
regle('MODIFIER', 'Contenu public et navigation', 'Présente des services V2-V5 comme disponibles : retirer, ou marquer « à venir » (décision de contenu)',
  exact(['apps/web/src/lib/service-catalog.ts', 'apps/Mobile/src/lib/service-catalog.ts', 'apps/web/src/pages/public/homeSlides.ts', 'apps/web/src/lib/faq.ts', 'apps/Mobile/src/lib/faq.ts', 'apps/web/src/lib/space-nav.ts', 'apps/Mobile/src/components/public-site/home/ServicesSection.tsx', 'apps/web/src/assets/hero/investissement-projet.jpg', 'apps/web/src/assets/hero/tracabilite-lot.jpg']));
regle('MODIFIER', 'Documentation V1→V5 à réécrire', 'Réécrite dans la documentation V1 unique',
  exact(['backend/README.md', 'backend/MANIFEST.md', 'backend/docs/API.md', 'backend/docs/DEPLOYMENT.md', 'apps/Mobile/README.md', 'apps/web/README.md']));

// ── SUPPRIMER : exclusivement V2-V5 ──
regle('SUPPRIMER', 'Backend code V2-V5', 'Jamais chargé, ou exclusivement V2-V5',
  exact(['backend/src/config/satellite.js', 'backend/src/integrations/satellite.js', 'backend/src/integrations/geospatial.js', 'backend/src/integrations/s3.js', 'backend/src/integrations/storage.js', 'backend/src/middleware/apiKey.js',
    'backend/src/modules/soil/rulesets.routes.js', 'backend/src/shared/dataMode.js', 'backend/src/shared/fileMagic.js', 'backend/src/shared/fileParsers.js', 'backend/src/shared/multipart.js', 'backend/src/shared/matching.js',
    'backend/src/shared/money.js', 'backend/src/shared/orderStateMachine.js', 'backend/src/shared/pdf.js', 'backend/src/shared/quota.js', 'backend/src/shared/resource.js', 'backend/src/config/hardware.js',
    'backend/src/modules/cooperatives/groupoffers.service.js', 'backend/src/modules/soil/intelligence.service.js', 'backend/src/modules/soil/intelligence.schema.js', 'backend/src/modules/countries/fx.service.js']));
regle('SUPPRIMER', 'Backend moteur V3', 'Moteur Python GeoAI (télédétection, interpolation, capteurs)', re(/^backend\/geoai\//));
regle('SUPPRIMER', 'Backend stockage V3', 'Dépôts géospatiaux locaux', re(/^backend\/storage\//));
regle('SUPPRIMER', 'Backend scripts V3', 'Documentation du matériel IoT', exact(['backend/scripts/check-hardware-doc.mjs', 'backend/scripts/recalibrate-hardware-doc.mjs']));
regle('SUPPRIMER', 'Tests V2-V5', 'Teste exclusivement des modules V2-V5 retirés',
  re(/^backend\/tests\/(agronomicRangesCsv|alertLabels|alerts|anomalies\.integration|anomalies|apiQuota|apiUsageWrite|dataMode|families\.integration|fileMagic|fileParsers|forecast\.integration|forecastAdjustment|geospatial\.integration|geospatialImport|hardware|intelligence\.integration|interpolation\.integration|listings\.integration|multipartS3|orderStateMachine|orders\.integration|policies\.integration|recommendation|recommendationLabels|recommendationScoring|req-v[2-5]\.integration|req-extra\.integration|reviews\.integration|satellite|seasons)\.test\.mjs$/));
regle('SUPPRIMER', 'Tests V2-V5', 'Recette e2e exclusivement V2-V5',
  re(/^backend\/tests\/e2e\/(agronomicRanges|alertEscalation|alerts|anomalies|forecastPipeline|geospatialImport|geospatialQuota|geospatialUpload|intelligence|interpolation|satellite|scoringEngine|seasons)\.e2e\.test\.mjs$/));
regle('SUPPRIMER', 'Docs V2-V5', 'Documentation exclusivement V2-V5',
  re(/^backend\/docs\/(AGRONOMIC-RANGES|ECOCROP-AUDIT|GEOSPATIAL|GEOSPATIAL-IMPORT|GEOSPATIAL_BACKEND_CONFIGURATION|GEOSPATIAL_WRITE_AUDIT|SCORING-ENGINE|SEASONS|COMPTE-RENDU-ECRAN2-LIVRAISON|COMPTE-RENDU-ECRAN3-ALERTES|COMPTE-RENDU-SEASONS-APIUSAGE|ACCEPTANCE|ROUTES-SANS-APPELANT|ROUTES-SANS-ECRAN)\.md$/));
regle('SUPPRIMER', 'Docs V1→V5 remplacées', 'Inventaire ou matrice V1→V5, ou doublon : remplacé par la documentation V1 unique (après sa création)',
  re(/^(backend\/docs\/(CDC-INVENTAIRE|NFR|REQUIREMENTS|TRACEABILITY|DOC-TECH-1)\.md|docs\/(DOC-TECH-1|DOC-TECH-2|DOC-TECH-3|DOCUMENTATION_TECHNIQUE|docs)\.md|apps\/web\/AGRIKONNECT AFRICA — Spécification fonctionnelle et technique\.md)$/));
regle('SUPPRIMER', 'Mobile écrans V2-V5', 'Écran V2-V5 : appelle des routes absentes en V1, ou coquille vide',
  re(/^apps\/Mobile\/src\/app\/(admin\/(agronomic-ranges|ai-usage|api-clients|data-products|devices|investors|lots|marketplace|orders|partners|prices|projects|rules)|farmer\/alerts|farmer\/plots\/\[id\]\/(plan|precision-report|recommendations|rotation|satellite|sensors|zones)|projets)\.tsx$/));
regle('SUPPRIMER', 'Web V3', 'Page non routée : méthode de recommandation V3', exact(['apps/web/src/pages/farmer/Plots/RecommendationMethod.tsx']));
regle('SUPPRIMER', 'Mobile composant V3', 'Méthode de recommandation V3', exact(['apps/Mobile/src/components/farmer/RecommendationMethod.tsx']));

// ── EXAMINER : à confirmer ──
regle('EXAMINER', 'À confirmer', 'Aucun CDC ne tranche (blog, actualités, statistiques de sols publiques, coquilles admin)',
  re(/^(backend\/src\/modules\/blog\/.+|apps\/web\/src\/pages\/(admin\/BlogPosts|public\/(Blog|BlogPost|BlogNewsSection))\.tsx|apps\/Mobile\/src\/app\/(actualites|actualites\/\[id\]|public-site\/actualites|public-site\/actualites\/\[id\]|public-site\/sols|admin\/compliance|admin\/moderation)\.tsx)$/));
regle('EXAMINER', 'À confirmer', 'Rapport ou consigne historique : archiver ou supprimer ?',
  re(/^(flux\/(LISEZMOI-DEMARRAGE|RAPPORT-CONFORMITE-SUPER-ADMIN|RAPPORT-PARCOURS-AUTHENTIFICATION)\.md|flux\/AGRIKONNECT AFRICA.*|flux\/design-tokens\.json|backend\/har\.md|apps\/web\/HARMONISATION-[^/]+\.md|backend\/docs\/(ACADEMIA-01-AUDIT-ET-PLAN|COMPTE-RENDU-MFA-EMAIL)\.md|scripts\/(construire-livraison\.sh|verifier-livraison\.py))$/));

const lignes = [];
const resume = new Map();
let cache = 0;
for (const f of [...new Set(fichiers)].sort()) {
  const r = R.find(([, , , t]) => t(f));
  const [d, c, m] = r ?? ['CONSERVER', 'V1 / socle', 'Aucune règle V2-V5 ne s’applique'];
  if (c === 'Cache généré') { cache += 1; continue; }
  lignes.push(`${d}\t${c}\t${f}\t${m}`);
  resume.set(`${d} | ${c}`, (resume.get(`${d} | ${c}`) ?? 0) + 1);
}
resume.set('SUPPRIMER | Cache généré', cache);
const entete = ['décision\tcatégorie\tchemin\tmotif', `SUPPRIMER\tCache généré\tapps/Mobile/.metro-cache/ (${cache} fichiers)\tCache du bundler Metro versionné par erreur`];
fs.writeFileSync(process.argv[2], [...entete, ...lignes].join('\n') + '\n');
for (const [k, n] of [...resume].sort()) console.log(String(n).padStart(6), k);
console.log('total fichiers inventoriés :', new Set(fichiers).size);
