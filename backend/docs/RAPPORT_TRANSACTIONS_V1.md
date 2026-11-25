# Rapport — transactions et atomicité (backend V1)

**Date :** 25 novembre 2026 · **Pour :** architecte · **Statut : CONSTAT. Aucune modification du code applicatif.**
Livrable §5 (« transactions et idempotence ») de la « Directive architecturale — consolidation du socle V1 ». L'idempotence est traitée dans [`PREUVES_IDEMPOTENCE_SYNC.md`](PREUVES_IDEMPOTENCE_SYNC.md) et [`ANALYSE_COMPLEMENTAIRE_V1.md`](ANALYSE_COMPLEMENTAIRE_V1.md) §3.

**Preuves :** `tests/e2e/transactionsV1.e2e.test.mjs`, journal `preuves/logs/10-transactionsV1.log` : **2 anomalies confirmées** (`todo`). TESTÉ sur PostgreSQL embarqué et faux GoTrue ; **rien de VALIDÉ** sur Supabase réel.

## 1. Méthode
Les 150 fichiers chargés par le serveur ont été balayés, fonction exportée par fonction exportée, à la recherche d'écritures Prisma multiples hors `$transaction`. Les cas signalés ont ensuite été relus un à un, puisque le balayage compte aussi les écritures passées en tableau à `$transaction([...])` et les branches `if/else` exclusives. Deux défauts ont été démontrés par injection de panne ou par concurrence, sans toucher au code.

## 2. Anomalies démontrées

### TX-1 — inscription : profil orphelin, adresse bloquée définitivement
| Rubrique | Contenu |
|---|---|
| Fichier | `src/modules/auth/auth.service.js`, `register` : transaction (profil, organisation, adhésion) **validée**, puis `token.create` (inscription assistée), `audit`, envoi d'e-mail, `profile.updateMany` (adresse déjà confirmée) **hors transaction**. Le `catch` supprime l'utilisateur Supabase, mais pas les lignes déjà validées |
| Risque | **Haut.** Un incident de base de données passager pendant l'inscription laisse un profil sans utilisateur Supabase. L'e-mail étant unique (`profiles.email @unique`), **toute nouvelle inscription avec cette adresse échoue** |
| Attendu | Aucune trace après l'échec ; réinscription possible |
| Observé | `1re inscription 500 ; profils en base après échec : 1 ; réinscription 500 (Inscription impossible, réessaie dans un instant)` |
| Correctif proposé | Placer `token.create` dans la transaction ; dans le `catch`, si la transaction est déjà validée, supprimer aussi profil, adhésion et organisation (dans une transaction) ; ou, plus simple, rendre non bloquant ce qui vient après la validation, comme le fait déjà `audit`. **Non appliqué.** |

### TX-2 — ouverture de fil : doublons sous concurrence
| Rubrique | Contenu |
|---|---|
| Fichier | `src/shared/conversations.js`, `ensureBusinessConversation` : `findFirst` puis `create`, **sans contrainte d'unicité** sur `conversations` (`schema.prisma`, modèle `Conversation`). Le commentaire « deux appels simultanés ne créent pas deux fils » est inexact |
| Risque | Moyen : fils DIRECT en double entre les mêmes organisations, et messages dispersés. **Messagerie : exception protégée, correction soumise à votre autorisation explicite** |
| Observé | 5 requêtes simultanées : non reproduit (1 fil). **30 requêtes simultanées : 11, 9, puis 21 fils** selon l'exécution |
| Correctif proposé | Verrou consultatif transactionnel (`pg_advisory_xact_lock(hash(sujet, participants))`) autour de la lecture et de la création, **sans migration** ; ou index unique (nécessite une migration et une clé de participants normalisée). Même défaut probable dans `createGroup` (lot 2 : rejeu par `findMany` puis `create`) |

## 3. Opérations relues, sans anomalie

| Opération | Constat |
|---|---|
| `deleteMe` | Transaction unique (corrigé, E6) |
| `verifyPhone` | Consommation de l'OTP et vérification dans `$transaction([...])` ; l'incrément de tentatives est volontairement hors transaction (il doit persister après un échec) |
| `mfa.confirm`, `mfa.disable` | `$transaction` |
| `postMessage` | Message et horodatage du fil dans une transaction ; rejeu `localTempId` géré (D2) |
| `createGroup` (lot 2) | Fil et premier message dans une transaction ; concurrence : voir TX-2 |
| `markVerified`, `mfa.setup`, `updateZoneFlags`, `login` | Écritures exclusives (`if/else`) ou compteurs indépendants : pas de besoin d'atomicité |
| `audit()` | Erreurs capturées et journalisées (`shared/audit.js`) : un audit raté n'annule pas l'opération, et ne crée pas d'incohérence métier |
| `ensureBusinessConversation` (atomicité) | Fil puis premier message, hors transaction : un fil sans premier message est possible en cas de panne. Gravité faible ; à traiter avec TX-2 |

## 4. Recommandations pour le socle
1. **Règle de conception :** toute opération qui écrit plusieurs lignes liées le fait dans une seule transaction. Les effets de bord (e-mail, SMS, temps réel, appels à Supabase Auth) passent après la validation et ne peuvent pas annuler l'opération, ou bien ils déclenchent une compensation complète et testée.
2. **Unicité des créations concurrentes :** contrainte en base, ou verrou consultatif, jamais `findFirst` puis `create` seuls.
3. **Tests :** toute correction s'accompagne d'une injection de panne (comme TX-1) ou d'un test de concurrence (30 requêtes ou plus, comme TX-2). Un test à 5 requêtes n'a pas suffi à révéler TX-2.
