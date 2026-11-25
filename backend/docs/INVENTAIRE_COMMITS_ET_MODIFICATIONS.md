# Inventaire des commits et modifications — Backend V1 (lot R1)

**Date :** 25 novembre 2026 · **Établi par :** agent de développement · **Pour :** architecte et responsable du projet.

## 1. État Git

| Élément | Valeur |
|---|---|
| Branche | `main` |
| Commit de base (HEAD) | `d781d9e8b848de409f9e49f24593f222294361b5` — « fix(v1): ajout plugins expo-asset et expo-sqlite dans app.config.ts » |
| Commit final des lots de stabilisation | **Aucun.** Aucune correction n'a été commitée. Elles sont toutes dans l'arbre de travail, au-dessus de `d781d9e`. |

**Conséquence pour la demande R1-4.** `git diff HEAD~1..HEAD` montrerait le commit `d781d9e` (configuration mobile), qui **ne contient aucune** des corrections backend. Le diff qui correspond aux lots est celui de l'arbre de travail par rapport à `HEAD`. Il est exporté intégralement dans [`preuves/stabilisation-v1-modifies.patch`](preuves/stabilisation-v1-modifies.patch) : 2824 lignes, code et tests modifiés **et** fichiers nouveaux (les fichiers non suivis y sont ajoutés par `git diff --no-index /dev/null <fichier>`, car `git diff HEAD` les ignore).

**Archive mentionnée par la directive.** Aucune archive n'a été transmise à l'agent dans cette session. Aucune comparaison n'a donc pu être faite. Pour la réaliser : extraire l'archive dans un dossier séparé, puis `git diff --no-index <archive>/backend backend`.

**Commit.** L'agent n'a pas créé de commit, faute de demande explicite. Si vous le souhaitez, la marche proposée est : branche `stabilisation/backend-v1`, un commit par lot (lot 1, lot 2, revue R1-R3), sans fusion sur `main`.

## 2. `git status --short` (relevé du 25/11/2026, après la revue)

```
 M backend/package.json
 M backend/src/middleware/idempotency.js
 M backend/src/modules/auth/auth.service.js
 M backend/src/modules/cooperatives/cooperatives.service.js
 M backend/src/modules/farms/farms.routes.js
 M backend/src/modules/media/media.routes.js
 M backend/src/modules/media/media.schema.js
 M backend/src/modules/media/media.service.js
 M backend/src/modules/messaging/messaging.service.js
 M backend/src/modules/organizations/organizations.service.js
 M backend/src/modules/plots/plots.routes.js
 M backend/src/modules/productions/productions.routes.js
 M backend/src/modules/users/users.service.js
 M backend/src/modules/verification/verification.service.js
 M backend/src/realtime/bus.js
 M backend/src/realtime/index.js
 M backend/src/routes/index.js
 M backend/src/shared/permissions.js
 M backend/tests/jobs.integration.test.mjs
 M backend/tests/messaging.integration.test.mjs
 M backend/tests/req-v1.integration.test.mjs
?? backend/docs/  (rapports et preuves, voir §3)
?? backend/src/realtime/sendGuard.js
?? backend/tests/e2e/realtimeStabilisation.e2e.test.mjs
?? backend/tests/e2e/revueContradictoireV1.e2e.test.mjs
?? backend/tests/e2e/stabilisationV1.e2e.test.mjs
?? backend/tests/e2e/support/socketClient.mjs
?? backend/tests/stabilisationV1.test.mjs
```

`git diff HEAD --stat` (fichiers suivis) : **21 fichiers, 667 insertions, 131 suppressions**. Aucun fichier de `prisma/` (schéma, migrations) n'est modifié.

## 3. Liste exhaustive des fichiers

### Code source modifié (18)

| Fichier | Lot | Motif (renvoi au rapport de stabilisation) |
|---|---|---|
| `src/routes/index.js` | 1 | C1 — garde « compte vérifié » rétablie sur `/messaging` et `/calls` |
| `src/shared/permissions.js` | 1 | C2, C4 |
| `src/realtime/index.js` | 1, 2 | D1, D7, D8, D9 |
| `src/realtime/bus.js` | 1 | D4 |
| `src/modules/messaging/messaging.service.js` | 1, 2 | D2, D3, D4, synchronisation, `attachmentUrls`, E9, E10 |
| `src/modules/media/media.routes.js` · `media.schema.js` · `media.service.js` | 1 | C3, E3, E4, E5 |
| `src/modules/verification/verification.service.js` | 1 | D5 |
| `src/modules/organizations/organizations.service.js` | 1 | E1 |
| `src/modules/cooperatives/cooperatives.service.js` | 1 | E2 |
| `src/modules/auth/auth.service.js` | 1 | D6 |
| `src/modules/users/users.service.js` | 1, 2 | E6, E12 |
| `src/middleware/idempotency.js` | 2 | E11 — option `facultatif` |
| `src/modules/farms/farms.routes.js` · `plots/plots.routes.js` · `productions/productions.routes.js` | 2 | E11 |

### Code source créé (1)
`src/realtime/sendGuard.js` — lot 1, D1.

### Tests modifiés (3) et créés (5)
- Modifiés : `tests/jobs.integration.test.mjs`, `tests/messaging.integration.test.mjs`, `tests/req-v1.integration.test.mjs` (lot 1).
- Créés : `tests/stabilisationV1.test.mjs` (lot 1, 19 tests), `tests/e2e/stabilisationV1.e2e.test.mjs` (lot 1, 6), `tests/e2e/realtimeStabilisation.e2e.test.mjs` (lot 2, 7), `tests/e2e/revueContradictoireV1.e2e.test.mjs` (revue, 25), `tests/e2e/support/socketClient.mjs` (outil de test de la revue).

### Configuration (1)
`package.json` — les trois suites des lots 1 et 2 sont ajoutées aux scripts `test`, `test:unit`, `test:dbless` et `test:e2e`. La suite de revue n'a **pas** été ajoutée (consigne R1 : aucune modification avant examen).

### Documentation (créée)
`docs/RAPPORT-STABILISATION-BACKEND-V1.md`, les cinq documents de la revue (`REVUE_CONTRADICTOIRE_BACKEND_V1.md`, `PREUVES_SECURITE_WEBSOCKET.md`, `PREUVES_IDEMPOTENCE_SYNC.md`, ce fichier, `PLAN_RETRAIT_V2_V5.md`) et `docs/preuves/` (patch et journaux).

## 4. Contenu final des fichiers demandés

Le contenu intégral de chaque fichier figure dans le patch (§1) et dans l'arbre de travail. Empreintes SHA-256 au moment de la revue, pour vérifier qu'on examine bien la même version :

| Fichier | Lignes | SHA-256 |
|---|---|---|
| `src/realtime/sendGuard.js` | 71 | `753c67851c950d14f8cf79bbbc21e8ba4c1ec7d098e7da612885e1425f2512d7` |
| `src/realtime/index.js` | 289 | `5e1c9be92ec96dc7ce85f25acb5a09100c4c51ca816a913b869fc708601e38eb` |
| `src/middleware/idempotency.js` | 106 | `b5506e66a3038c55877be354193a4006fe320707ff52880b86ab6fde6493cb24` |
| `src/modules/messaging/messaging.service.js` | 780 | `e8ce4ee90887fca9e8819bd61aac8373ab89be64df6eb470c897868d6e8f64a8` |
| `tests/stabilisationV1.test.mjs` | 267 | `3704b054c0043526d82505fe4888a153429882891e4ba06079de19a3299dfa3b` |
| `tests/e2e/stabilisationV1.e2e.test.mjs` | 171 | `e099d1c3da2f807f38850cf52a85961544fc93ac29038c7f988996892152210d` |
| `tests/e2e/realtimeStabilisation.e2e.test.mjs` | 269 | `f10357a02202ea33fc19bff83646dabfd0cd17aceeab61129f79f0b7990c851c` |
| `tests/e2e/revueContradictoireV1.e2e.test.mjs` | 565 | `166899718c214238e5dfc678c97adeda781fef381927df3f2126c095448b4548` |

Vérification : `sha256sum <fichier>` depuis `backend/`. Les fins de ligne locales sont LF ; Git signale une conversion CRLF à la prochaine écriture (`core.autocrlf`), ce qui changerait l'empreinte d'un fichier récupéré depuis Git sans en changer le contenu.

## 5. Scripts npm réellement configurés

Relevés dans `backend/package.json` : `dev`, `start`, `seed`, `prisma:generate`, `prisma:migrate`, `prisma:deploy`, `prisma:studio`, `db:push`, `check`, `docs:openapi`, `check:fields`, `check:env`, `check:perms`, `test`, `test:dbless`, `check:trace`, `docs:traceability`, `docs:requirements`, `check:req`, `check:cdc`, `test:unit`, `check:migrations`, `sms:verifier-config`, `email:verifier-config`, `test:e2e`, `smoke`, `contre-epreuves`, `verify`, `check:mounts`, `geoai`, `test:geoai`, `check:models`.

**Il n'existe pas de script `test:hors-v1`.** Le rapport du lot 1 l'annonçait à tort ; ce point est rectifié dans le rapport de stabilisation.

## 6. Journaux d'exécution originaux

Tous dans [`preuves/logs/`](preuves/logs/). Journaux bruts, non filtrés.

| Fichier | Commande | Résultat |
|---|---|---|
| `01-npm-test-debut-lot2.log` | `npm test` | 637 réussis, 255 échecs. *Exécuté pendant les modifications du lot 2 : à ne pas utiliser comme référence de code stable.* |
| `02-npm-test-fin-lot2.log` | `npm test` | 642 réussis, 250 échecs (classés : rapport de stabilisation §H) |
| `03-revueContradictoireV1.log` | `node --test tests/e2e/revueContradictoireV1.e2e.test.mjs` | 17 réussis, 0 échec, 8 `todo` (anomalies confirmées) |
| `04-realtimeStabilisation.log` | `node --test tests/e2e/realtimeStabilisation.e2e.test.mjs` | 7/7 |
| `05-stabilisationV1-e2e.log` | `node --test tests/e2e/stabilisationV1.e2e.test.mjs` | 6/6 |
| `06-unitaires-messagerie.log` | `node --test tests/stabilisationV1.test.mjs tests/messaging.integration.test.mjs tests/messagingConfig.test.mjs tests/calls.test.mjs` | 78/78 |
| `07-contre-epreuve-code-origine.log` | même recette que 04, avec `realtime/index.js`, `messaging.service.js` et `farms.routes.js` de `HEAD` | 0/7 ; 3 `uncaughtException` |

**Journaux non conservés.** Les exécutions du lot 1 (tests unitaires « 505 → 522 », contre-épreuve `stabilisationV1` 0/6) et les premières exécutions du lot 2 (recettes `auditLot3`, `calls`, `push` 33/33 ; `completenessByRole` 12/12) n'ont été consultées que filtrées et n'ont pas été enregistrées. Ces résultats ne doivent pas être tenus pour prouvés tant qu'ils n'ont pas été relancés avec journal ; les journaux 04 à 07 en reprennent l'essentiel.

**Environnement de toutes les exécutions :** Windows 11, Node 26.13.0, **PostgreSQL embarqué jetable** (`embedded-postgres`, 24 migrations du dépôt appliquées), faux GoTrue local. **Jamais Supabase réel.**
