# Rapport — migrations et intégrité des données (backend V1)

**Date :** 25 novembre 2026 · **Pour :** architecte et responsable du projet · **Statut : CONSTAT. Aucune migration créée ni appliquée, aucun accès à Supabase réel.**
Livrable §5 de la « Directive architecturale — consolidation du socle V1 ».

**Preuve principale :** `npm run check:migrations`, journal `preuves/logs/09-check-migrations.log`, code de sortie **1**.
**TESTÉ** sur un PostgreSQL embarqué vierge (port 55478). **VALIDÉ : rien.** L'état de la base Supabase réelle est inconnu (§5).

## 1. Synthèse

| Contrôle | Résultat | Statut |
|---|---|---|
| Application des 24 migrations sur base vierge | **Réussie**, sans erreur | TESTÉ |
| RLS : tables `public` protégées | **106 tables**, toutes protégées | TESTÉ |
| Privilèges `anon` / `authenticated` / `PUBLIC` | Aucun | TESTÉ |
| `prisma validate` | Schéma valide | TESTÉ |
| **Concordance schéma ↔ migrations** | **ÉCHEC : dérive** (§2) | TESTÉ |
| Instructions destructives dans la chaîne | 1 seule : `DROP INDEX` remplacé (`20261022000000_threshold_alerts:29`), aucune donnée touchée | Lecture |
| État de la base Supabase réelle | **Inconnu** | Non exécuté (autorisation requise) |

## 2. Dérive : fondations Academia déclarées dans le schéma, sans migration

`schema.prisma` déclare des objets qu'aucune des 24 migrations ne crée. Ils constituent **exactement les fondations Academia**, qui relèvent de la V1 (CDC V1 §3.11, V1-F12) :

| Objet | Détail |
|---|---|
| 5 énumérations | `AcademicInstitutionKind`, `AcademicUnitKind`, `AcademicAffiliationStatus`, `AcademicProfileVisibility`, `AcademicContactPolicy` |
| `OrgType` + 2 valeurs | `UNIVERSITY`, `RESEARCH_CENTER` |
| `Role` + 6 valeurs | `STUDENT`, `PROFESSOR`, `RESEARCHER`, `UNIVERSITY_ADMIN`, `LIBRARIAN`, **`ACADEMIA_ADMIN`** |
| 4 tables | `academic_institutions`, `academic_units`, `academic_profiles`, `academic_affiliations` |
| 11 index, 7 clés étrangères | Liste complète dans le journal 09, lignes 86 à 259 |

**Origine :** ces objets sont présents dans le schéma depuis le commit `e10e28c` (« backup : état complet avant isolation stricte V1 »). Aucune migration ne les a jamais accompagnés.

## 3. Conséquences

| # | Conséquence | Gravité | Preuve |
|---|---|---|---|
| 1 | **Vue sécurité Super Admin cassée (E8).** `GOVERNANCE_ROLES` (`shared/permissions.js`) contient `ACADEMIA_ADMIN`. Avec le client local, qui ignore cette valeur, Prisma rejette la requête : 422 « Requête base de données invalide » | Moyenne | `tests/e2e/adminSecurity.e2e.test.mjs` (2 échecs, journal 02) |
| 2 | **Le client de production diffère du client de test.** Render régénère le client à chaque construction (`render.yaml:27` : `npx prisma@5.22.0 generate`), donc **avec** Academia. Le client local du banc date du 18/11, le schéma du 23/11 : **les tests n'exercent pas le client de production** | **Haute** (validité des preuves) | Dates de `node_modules/.prisma/client/index.d.ts` et de `schema.prisma` |
| 3 | En production, si la base ne contient pas ces valeurs d'énumération, l'erreur E8 se déplace du client vers PostgreSQL (`invalid input value for enum "Role"`). Toute requête qui transmet un rôle ou un type Academia échoue | Moyenne | Déduction (non testée) |
| 4 | **CI probablement en échec.** `.github/workflows/backend-migrations.yml` exécute `check:migrations` à chaque demande de fusion et à chaque push sur `main` | Moyenne | Workflow lu ; historique CI non consulté |

## 4. Corrections possibles (aucune appliquée)

| Option | Contenu | Risque | Conformité CDC V1 |
|---|---|---|---|
| **M1 — Migration additive Academia (recommandée)** | Une migration `…_academia_foundations` générée par `prisma migrate diff`, à partir des instructions du journal 09, complétée de `ENABLE ROW LEVEL SECURITY` et de la révocation des privilèges `anon` / `authenticated` sur les 4 tables (sinon le contrôle RLS échoue) | Faible : création seule, aucune donnée modifiée. `ALTER TYPE … ADD VALUE` n'est pas annulable sans recréer le type | Conforme (fondations Academia = V1) |
| M2 — Retirer Academia du schéma | Revenir au schéma couvert par les migrations | Contraire à V1-F12 ; casse `permissions.js` | Non conforme |
| M3 — Retirer seulement `ACADEMIA_ADMIN` de `GOVERNANCE_ROLES` | Corrige E8 sans migration | Laisse la dérive et la CI en échec | Palliatif |

**Prérequis à M1 (lecture seule, sur Supabase réel, avec votre autorisation) :** savoir si les objets existent déjà en production, par exemple après un `prisma db push`. Selon la réponse, M1 doit être **appliquée**, ou **marquée comme déjà appliquée** (`prisma migrate resolve --applied`).

```sql
-- Migrations enregistrées
SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at;
-- Tables Academia présentes ?
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'academic_%';
-- Valeurs d'énumération présentes ?
SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname IN ('Role', 'OrgType') ORDER BY 1, e.enumsortorder;
```

**Préalable au banc (environnement local, aucun fichier du dépôt modifié) :** régénérer le client local (`npx prisma@5.22.0 generate`) pour qu'il corresponde à celui de la production, puis relancer les suites. Avant M1, cela fera **apparaître** l'échec réel de la production sur E8 au lieu de l'échec actuel du client : c'est attendu, et ce sera documenté.

## 5. Scripts SQL hors de la chaîne de migrations

| Fichier | Contenu | Couvert par une migration ? |
|---|---|---|
| `complement-indexes.sql` | `audit_logs_action_created_at_idx`, `memberships_roles_idx` | Oui (1 migration chacun) : script de rattrapage d'une base existante |
| `delta-baseline.sql` | Table `settings_revisions` et son index | Oui (`20261031000000_admin_governance`) |
| `bootstrap-super-admin.sql` | Création du premier Super Admin | Données, pas schéma : à exécuter une fois, sur décision |
| `fix-baseline.mjs`, `fix-schema-doublon.mjs` | Mise sous gestion Prisma d'une base existante (P3005) | Outils de reprise ; à conserver et documenter |

**Risque :** ces scripts ont visiblement servi à aligner la base Supabase sur la chaîne de migrations. **Rien ne prouve que l'alignement est complet** (voir les requêtes du §4).

## 6. Intégrité des données — règles constatées dans le code V1

| Règle | Où | Statut |
|---|---|---|
| Isolation par organisation (`resolveTenant`, `assertOwnership`) | Services exploitations, parcelles, productions, coopératives | TESTÉ (`req-v1`, `stabilisationV1`) |
| Suppression logique (`deletedAt`, statut `DELETED`) | Profils, organisations, exploitations, parcelles | Lecture |
| Transactions sur les opérations à écritures multiples | `deleteMe` (corrigé, E6), `postMessage`, création d'organisation | Partiel : inventaire exhaustif à faire (rapport transactions) |
| Idempotence des créations hors ligne | 4 créations | Partielle : I4b, I4c, I6b, I7 ouverts |
| Identifiants client (`resolveId`, `isClientId`) | Créations synchronisables | TESTÉ (D2, C3) |

## 7. Décisions attendues

1. Autoriser les **trois requêtes en lecture seule** sur Supabase réel (§4).
2. Option **M1**, M2 ou M3 ?
3. Autoriser la **régénération du client Prisma local** (banc uniquement) pour que les tests correspondent à la production.
