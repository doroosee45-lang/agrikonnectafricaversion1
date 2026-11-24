# ACADEMIA-01 — Audit d'intégration et plan de conception

> Référence : **CDC-ACADEMIA-01 v1.0** (19 novembre 2026).
> Statut : **étapes 1 (audit) et 2 (conception) — en attente de validation (étape 3)**.
> Aucun code, aucune migration ni aucune table n'ont été modifiés pour produire ce document.

Chaque constat ci-dessous a été vérifié dans le code (fichier cité). Ce qui n'a pas pu être vérifié est signalé comme tel.

---

## Partie A — Audit de l'existant

### A.1 Architecture constatée

| Couche | Constat | Source |
|---|---|---|
| Backend | Express, 56 modules métier sous `src/modules/<domaine>/` (routes · controller · schema · service) | `backend/src/modules/` |
| ORM / base | Prisma sur Supabase PostgreSQL + PostGIS ; 178 modèles et énumérations | `backend/prisma/schema.prisma` |
| Migrations | Prisma versionnées, contrôlées en CI | `prisma/migrations/`, `scripts/check-migrations.mjs`, `.github/workflows/backend-migrations.yml` |
| Authentification | Supabase Auth + MFA TOTP avec preuve de session | `middleware/auth.js`, `middleware/authorize.js` (`requireMfa`) |
| Web | React + Vite ; espaces déclarés dans un registre unique | `apps/web/src/lib/space-nav.ts` |
| Mobile | Expo / expo-router ; un dossier de routes par espace | `apps/Mobile/src/app/` |

### A.2 Ce qui existe et peut être réutilisé tel quel

| Besoin ACADEMIA | Mécanisme existant | Source | Verdict |
|---|---|---|---|
| Compte unique | `Profile` (1 compte = 1 personne) | `schema.prisma` | **Réutiliser** — aucun compte séparé |
| Rôles **contextualisés par organisation** (CDC annexe A) | `Membership.roles: Role[]` par organisation ; `resolveTenant` calcule les rôles **de l'organisation active** + rôles de plateforme | `middleware/tenant.js` (`rolesEffectifs`, H-03) | **Réutiliser** — c'est exactement le modèle demandé |
| Permissions | Matrice RBAC `ressource.action` + `authorize()` | `shared/permissions.js`, `middleware/authorize.js` | **Étendre** (nouvelles permissions `academia.*`) |
| Isolation | `assertOwnership` → 404 sur ressource d'un autre tenant | `middleware/tenant.js` | **Réutiliser** |
| Journal d'audit | `audit()` → table `audit_logs` (acteur, action, ressource, ancienne/nouvelle valeur, IP) | `shared/audit.js` | **Réutiliser** |
| Notifications | `notify()` / `notifyMany()` (in-app, push, e-mail, SMS selon préférences) | `shared/events.js` | **Réutiliser** |
| Messagerie | Conversations entre organisations, rattachées à un objet métier ; blocage et signalement | `shared/conversations.js`, `modules/messaging` | **Étendre** (nouveau type de sujet) |
| Stockage privé | Bucket `private-documents`, URL d'envoi signées, URL de lecture signées (TTL `SIGNED_URL_TTL_SECONDS`, 300 s) | `modules/media/media.service.js`, `config/env.js` | **Réutiliser le mécanisme**, bucket dédié |
| Contrôle des fichiers | Vérification par signature binaire (magic bytes) | `shared/fileMagic.js` | **Réutiliser** |
| Interrupteurs de modules | `modules.market`, `modules.investissement`… réglables en administration | `modules/admin/admin.settings.schema.js` | **Étendre** (`modules.academia`) |
| Modèle d'extension 1-1 d'une organisation | `Cooperative` ↔ `Organization` | `schema.prisma` | **Précédent à suivre** pour les universités |
| Demande de contact | `ProjectContactRequest` (statuts `PENDING/ACCEPTED/DECLINED/EXPIRED`) | `schema.prisma` | **Modèle à reproduire** (table dédiée) |
| PostGIS | Géométries des parcelles, imports géospatiaux | `modules/geospatial*`, `plots` | **Réutiliser** (position des établissements) |

### A.3 Sécurité de la base : posture réelle

- La migration `20261031020000_revoke_anon_authenticated_grants` **active RLS sur toutes les tables** et **retire tous les droits** à `anon` et `authenticated`.
- **Aucune politique RLS** n'est définie. C'est voulu : refus par défaut pour tout accès direct, et seule l'API (rôle propriétaire) accède aux données.
- La convention est répétée dans chaque nouvelle migration (exemple : `20261116000000_audio_calls`) et **contrôlée en CI**.
- Web et mobile n'interrogent **jamais** Supabase directement : tout passe par l'API.

### A.4 Ce qui n'existe pas

| Besoin | Constat |
|---|---|
| Type d'organisation universitaire | `OrgType` = `INDIVIDUAL`, `COOPERATIVE`, `COMPANY` uniquement |
| Rôles académiques | `Role` ne contient ni `STUDENT`, ni `PROFESSOR`, ni `RESEARCHER`, ni `UNIVERSITY_ADMIN`, ni `LIBRARIAN` |
| Statuts d'affiliation | `MembershipStatus` = `INVITED`, `ACTIVE`, `REMOVED` (pas de `PENDING/VERIFIED/REJECTED/SUSPENDED/ENDED`) |
| Hiérarchie facultés / départements | `Organization` n'a pas de parent |
| Recherche plein texte | **Aucune** (ni `tsvector`, ni `pg_trgm`) dans le code ni dans les migrations |
| Inscription « étudiant / chercheur » | `SELF_SERVICE_ACCOUNT_TYPES` = types agricoles, commerciaux et investisseur uniquement (`modules/auth/auth.schema.js`) |
| Blocage entre personnes | Le blocage existant porte sur une conversation (modération), pas sur un utilisateur |

### A.5 Ce qui ne doit pas être réutilisé

| Élément | Raison |
|---|---|
| Modèle `Project` | Ce sont les **projets d'investissement** (V4 : data room, due diligence, financement). Les mélanger aux projets scientifiques casserait leurs règles. → table distincte `AcademicProject`. |
| Modèle `Document` | Pièces justificatives d'une organisation (vérifications KYC). Il n'a ni auteurs, ni licence, ni workflow de publication, ni versions. → tables documentaires dédiées. |
| `MembershipStatus` | Le modifier toucherait toute l'autorisation existante. → table d'affiliation distincte. |

### A.6 Risques et dépendances

| # | Risque | Gravité | Mesure proposée |
|---|---|---|---|
| R1 | Ajouter des valeurs aux énumérations centrales `Role` et `OrgType` | Moyenne | Ajout pur (`ALTER TYPE … ADD VALUE`), aucune valeur supprimée ni renommée ; vérifier les `switch` web et mobile sur le type d'organisation (15 usages backend) |
| R2 | Un étudiant vérifié devient membre de l'organisation université et peut la choisir comme organisation active | Moyenne | Les permissions `'*'` ne couvrent que des données publiques ou personnelles (vérifié) ; **test de non-régression obligatoire** : aucun accès aux exploitations, commandes, messages de l'université |
| R3 | Usurpation d'un établissement (fausse université) | Haute | Création des universités réservée à l'administration ACADEMIA, ou demande soumise à vérification |
| R4 | Fuite d'un document privé par URL | Haute | Bucket privé, URL signées courtes émises **après** contrôle d'accès côté API ; jamais d'URL permanente en base |
| R5 | Travail non commité en cours (migration `20261118100000_profile_settings`, `schema.prisma` modifié) | Moyenne | Les migrations ACADEMIA viendront **après** ; à fusionner d'abord ou à isoler |
| R6 | Branche de travail en avance de 8 commits sur `main` | Moyenne | Choisir la base de la branche ACADEMIA (question de validation n° 5) |
| R7 | Tests web non exécutables sur le poste actuel (Vitest abandonne les workers après 60 s ; `jsdom` met 53 s à se charger) | Moyenne | Exécuter les tests en CI ou sur un poste moins chargé |
| R8 | Tests backend `[db]` nécessitant une base | — | **Non vérifié** : disponibilité d'une base de test locale ou de staging |

---

## Partie B — Conception proposée

### B.1 Principes
1. **Aucune table utilisateur ni organisation en double.** Une université est une `Organization`, une personne est un `Profile`.
2. **L'autorisation reste celle du projet** : `Membership.roles` par organisation et `authorize('academia.*')`. Pas de système parallèle.
3. **L'affiliation pilote le Membership** : seule une affiliation `VERIFIED` crée ou complète le `Membership` et accorde le rôle académique. Un étudiant non vérifié ne reçoit **aucun** privilège de membre.
4. **Ajouts uniquement** dans le cœur : nouvelles valeurs d'énumération, nouvelles permissions, nouvel interrupteur. Aucun contrat d'API existant n'est modifié.
5. **Module activable** : `modules.academia`, désactivé par défaut tant que la recette n'est pas faite.

### B.2 Modifications du cœur (soumises à validation)

| Élément | Modification | Nature |
|---|---|---|
| `OrgType` | `+ UNIVERSITY`, `+ RESEARCH_CENTER` | Ajout |
| `Role` | `+ STUDENT`, `+ PROFESSOR`, `+ RESEARCHER`, `+ UNIVERSITY_ADMIN`, `+ LIBRARIAN` (contextuels, portés par le Membership de l'établissement) ; `+ ACADEMIA_ADMIN` (rôle de plateforme, **sans** les droits SUPER_ADMIN) | Ajout |
| `PLATFORM_ROLES` | `+ ACADEMIA_ADMIN` | Ajout |
| `PERMISSIONS` | `academia.*` (voir B.5) | Ajout |
| `SELF_SERVICE_ACCOUNT_TYPES` | `+ ACADEMIC` → organisation INDIVIDUELLE avec le rôle existant `PUBLIC_USER` (aucun privilège nouveau) | Ajout |
| `SUBJECT_TYPES` (conversations) | `+ ACADEMIC_CONTACT` | Ajout |
| Réglages | `modules.academia` (défaut `false`) | Ajout |

### B.3 Modèle de données (nouvelles tables, préfixe `academic_`)

```
organizations (existant) 1──1 academic_institutions
      │                          kind: UNIVERSITY | INSTITUTE | SCHOOL | RESEARCH_CENTER
      │                          short_name, website, address, city, location (PostGIS Point)
      │                          verification_status, verified_at, verified_by
      │
      ├──< academic_units          FACULTY | DEPARTMENT | LABORATORY (parent_id → hiérarchie)
      │
profiles (existant) 1──1 academic_profiles     headline, bio, disciplines[], research_areas[],
      │                                         visibility (PUBLIC | MEMBERS | PRIVATE), contact_policy
      │
      ├──< academic_affiliations   profile ↔ organisation (+ unité), requested_role,
      │        status: PENDING | VERIFIED | REJECTED | SUSPENDED | ENDED,
      │        study_level, program, academic_year, decided_by, decided_at, reason
      │        └─ VERIFIED ⇒ upsert memberships (rôle académique ajouté)
      │
academic_disciplines (référentiel : agronomie, géomatique, SIG, télédétection…)

academic_publications  type (BOOK | THESIS | DISSERTATION | ARTICLE | JOURNAL | REPORT | COURSE | GUIDE | DATASET)
      │  title, abstract, keywords[], language, year, license, discipline_id,
      │  institution_id, unit_id, status (DRAFT … ARCHIVED), access_level, embargo_until,
      │  search_vector (tsvector généré + index GIN)
      ├──< academic_publication_authors   (profil interne OU nom externe, ordre, rôle)
      ├──< academic_publication_versions  storage_key, mime, size, sha256, version, created_by
      ├──< academic_access_rules          (PUBLIC | AUTHENTICATED | INSTITUTION | GROUP | RESTRICTED)
      └──< academic_publication_reviews   historique du workflow (qui, quand, décision, motif)

academic_library_items / academic_collections   bibliothèque personnelle (références, pas de copie)
academic_contact_requests                       PENDING | ACCEPTED | DECLINED | EXPIRED
academic_blocks                                 blocage entre personnes
academic_groups ──< academic_group_members
academic_projects ──< academic_project_participants (profil OU organisation, rôle)
                  ──< academic_project_publications
```

Conventions des migrations : identifiants via `resolveId()`, horodatages, `deleted_at` pour les retraits, **RLS activée sans politique et droits retirés à `anon` et `authenticated`** (convention CI), index sur les clés de recherche.

### B.4 Workflow documentaire
`DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED → PUBLISHED`, avec `REJECTED`, `WITHDRAWN` et `ARCHIVED`. Machine d'états testée, sur le modèle de `shared/orderStateMachine.js`.

- Chaque transition est enregistrée dans `academic_publication_reviews` et `audit_logs`.
- Le statut `APPROVED` signifie une **vérification administrative**. Il est affiché comme tel, jamais comme une validation scientifique (annexe B du CDC).

### B.5 Permissions (extrait)

| Permission | Rôles |
|---|---|
| `academia.read` | `*` (contenu public), filtré ensuite par niveau d'accès |
| `academia.profile.write` | `*` (son propre profil uniquement) |
| `academia.affiliation.request` | `*` |
| `academia.affiliation.review` | `UNIVERSITY_ADMIN` (dans **son** établissement), `ACADEMIA_ADMIN` |
| `academia.publication.write` | `STUDENT`, `PROFESSOR`, `RESEARCHER`, `LIBRARIAN` (affiliation vérifiée) |
| `academia.publication.review` | `UNIVERSITY_ADMIN`, `LIBRARIAN`, `ACADEMIA_ADMIN` |
| `academia.institution.write` | `UNIVERSITY_ADMIN` (son établissement), `ACADEMIA_ADMIN` |
| `academia.institution.create` | `ACADEMIA_ADMIN` |
| `academia.admin` | `ACADEMIA_ADMIN`, `ADMIN`, `SUPER_ADMIN` |

Le contrôle d'accès à un document se fait **toujours côté API** (niveau d'accès, embargo, affiliation, groupe), avant l'émission d'une URL signée.

### B.6 Stockage
- Nouveau bucket **privé** `academia-documents`, déclaré en configuration (`SUPABASE_BUCKET_ACADEMIA`).
- Même les documents publics sont servis par URL signée courte : un retrait ou un embargo prend effet immédiatement.
- Contrôles : liste blanche de types (PDF, EPUB, DOCX, CSV, GeoJSON, ZIP de données), taille maximale configurable, signature binaire (`fileMagic.js`), empreinte SHA-256, une version par nouveau dépôt.

### B.7 Recherche
- PostgreSQL plein texte : colonne `tsvector` générée (titre, résumé, mots-clés, auteurs) et index GIN.
- Filtres : discipline, type, année, langue, établissement, pays.
- Pagination existante (`shared/pagination.js`).
- Le filtre d'accès est appliqué **dans la requête**, jamais après : un document inaccessible n'apparaît pas, même dans le nombre de résultats.

### B.8 Interfaces
- **Web** : nouvel espace `academia` dans `space-nav.ts`, sous `/academia/...` (tableau de bord étudiant, espace enseignant-chercheur, établissement, bibliothèque, recherche, réseau, projets). L'administration ACADEMIA s'ajoute dans l'espace `admin` existant.
- **Mobile** : dossier `src/app/academia/` dans l'application existante (pas de seconde application), compatible Expo Go.
- Composants réutilisés : `AppLayout`, `Sidebar`, `HorizonShell`, i18n FR/EN.

### B.9 Découpage proposé (aligné sur l'annexe C du CDC)

| Lot | Contenu | Livrable testable |
|---|---|---|
| **L1 — Fondations (P0)** | Énumérations, `academic_institutions`, `academic_units`, `academic_profiles`, `academic_affiliations`, permissions, interrupteur, API établissements et affiliations, audit | Scénarios 1 à 4 et 14 du §19, non-régression R2 |
| **L2 — Bibliothèque (P0)** | Publications, auteurs, versions, règles d'accès, workflow, bucket, URL signées | Scénarios 6, 11, 12 et 13 |
| **L3 — Espaces (P1)** | Tableaux de bord web étudiant, enseignant-chercheur et établissement ; bibliothèque personnelle | Scénarios 4, 5 et 10 |
| **L4 — Recherche et réseau (P1)** | Plein texte, annuaire, demandes de contact, blocage, signalement | Scénarios 7, 8 et 9 |
| **L5 — Groupes et projets (P2)** | Groupes, projets, participants, partenaires | Scénarios 15 et 16 |
| **L6 — Mobile** | Écrans ACADEMIA dans l'application Expo | Parité des fonctions principales |
| **L7 — Intégrations (P2)** | Liens vers les données géospatiales autorisées, les projets agricoles, les entreprises | Selon validation |

Chaque lot comprend ses tests (unitaires, intégration, permissions), sa documentation d'API et un rapport de non-régression. **Aucun lot ne sera déclaré terminé sans exécution de ses tests.**

---

## Partie C — Écarts entre le CDC et l'architecture réelle

| # | Exigence du CDC | Réalité | Proposition compatible |
|---|---|---|---|
| E1 | « Politiques RLS dans Supabase » (§13.2) | RLS active **sans politique** sur toutes les tables ; aucun client n'interroge Supabase directement ; convention contrôlée en CI | Conserver la convention : RLS active, refus par défaut, autorisation dans l'API. Écrire des politiques par utilisateur serait sans effet (le backend utilise le rôle propriétaire) et contredirait la CI. |
| E2 | Statuts d'affiliation sur l'appartenance | `MembershipStatus` partagé par toute la plateforme | Table `academic_affiliations` qui pilote le `Membership` |
| E3 | Facultés et départements comme organisations | `Organization` sans hiérarchie | Table `academic_units` rattachée à l'établissement ; un centre de recherche indépendant reste une `Organization` (`RESEARCH_CENTER`) |
| E4 | « Projets » scientifiques | `Project` désigne déjà les projets d'investissement | Table distincte `academic_projects` |
| E5 | Recherche documentaire optimisée | Aucune recherche plein texte dans le projet | Introduire `tsvector` + GIN (aucune extension requise) |
| E6 | Inscription étudiante | Aucun type de compte adapté | Type `ACADEMIC` → rôle existant `PUBLIC_USER` ; les rôles académiques ne viennent que d'une affiliation vérifiée |

---

## Partie D — Décisions à valider avant le lot L1

1. Ajouter les valeurs aux énumérations centrales `Role` et `OrgType` (B.2).
2. Conserver la posture RLS du projet (E1).
3. Qui crée les universités : l'administration ACADEMIA uniquement, ou une demande publique soumise à vérification ?
4. Nouveau type d'inscription `ACADEMIC` (E6).
5. Base de la branche de développement : `main`, ou la branche courante avec ses 8 commits non fusionnés et le travail « paramètres de profil » en cours (R5, R6) ?
6. Module désactivé par défaut en production (`modules.academia = false`) jusqu'à la recette.
