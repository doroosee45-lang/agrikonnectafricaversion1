# Dossier S2 : curseur de synchronisation stable (conception, NON implémentée)

**Branche :** `correction/backend-v1`. **Statut :** conception et mesures sur le banc. Aucune ligne de l'application n'est modifiée et aucune migration n'est créée ni appliquée.

**Niveaux de preuve :**
- **TESTÉ** : mesuré sur PostgreSQL 18.4 embarqué, sur des tables de démonstration `s2d_*` et `s2_demo`.
- **ANALYSÉ** : raisonnement sur la documentation et le code, sans mesure.
- **VALIDÉ** : aucun point ne l'est. Rien n'a été exécuté sur Supabase.

Tests : [tests/e2e/curseurStableS2.e2e.test.mjs](../tests/e2e/curseurStableS2.e2e.test.mjs) (S2-a, S2-b) et [tests/e2e/curseurStableS2Dossier.e2e.test.mjs](../tests/e2e/curseurStableS2Dossier.e2e.test.mjs) (S2-0 à S2-h).
Journaux :
- 35 : premier prototype ;
- 49 : premier passage du dossier, avec trois défauts du banc, voir §12 ;
- 50 : 11/11 ;
- 51 : trois répétitions des tests concurrents, toutes à 0 perte et 0 doublon.

---

## 1. Le défaut

`deltaSync` ([messaging.service.js:706](../src/modules/messaging/messaging.service.js#L706)) livre les messages `createdAt > lastPulledAt`.
- Quand la page n'est pas pleine, il renvoie `serverTimestamp = Date.now()`.
- Un message dont la transaction a commencé avant le tirage et s'est validée après porte un `createdAt` antérieur au curseur renvoyé. Il n'est donc **jamais livré**.

Test S2-a, TESTÉ : reçu=false avec le curseur temporel, reçu=true avec le curseur de transaction.

## 2. Version PostgreSQL requise

| Élément | Version minimale |
|---|---|
| Type `xid8`, `pg_current_xact_id()`, `pg_current_snapshot()`, `pg_snapshot_xmin()`, `pg_snapshot_xmax()` | **PostgreSQL 13** |
| « Valeur par défaut rapide » (`atthasmissing`, ajout de colonne sans réécriture) | PostgreSQL 11 |

- Banc : 18.4 (S2-0, TESTÉ).
- Supabase : **version non vérifiée**. La lecture `SHOW server_version;` demande une autorisation distincte.

## 3. Fonctionnement exact

- Chaque ligne porte `xid xid8 DEFAULT pg_current_xact_id()`, c'est-à-dire l'identifiant 64 bits de la transaction **principale** qui l'a insérée. Un SAVEPOINT ne change pas cette valeur.
- `xid8` est étendu par l'époque, donc il n'y a **pas de rebouclage**.
- Lecture : `borne = pg_snapshot_xmin(pg_current_snapshot())`, l'identifiant de la plus ancienne transaction encore en cours. Toute transaction dont l'identifiant est inférieur à `borne` est **terminée**.
- Le tirage livre `curseur ≤ xid < borne`, puis le curseur devient `borne`.
- Une ligne d'une transaction encore ouverte a `xid ≥ borne`. Elle est livrée au premier tirage qui suit sa validation.
- Les intervalles `[curseur, borne)` se suivent sans se chevaucher : ni perte ni doublon, et aucune fenêtre de temps arbitraire.
- Une transaction **en lecture seule** n'a pas d'identifiant. Elle ne retient pas la borne (S2-e, TESTÉ).

**Hors périmètre du défaut, mais à traiter avec S2 :** la valeur `xid` change à l'**insertion** seulement.
- Pour synchroniser des modifications (lu par, édition, suppression), il faudrait un déclencheur `BEFORE UPDATE … NEW.xid := pg_current_xact_id()`.
- `deltaSync` renvoie aujourd'hui `updated: []` et `deleted: []`. C'est une limite existante, que ce dossier ne corrige pas.

## 4. Comportement sous PgBouncer en mode transaction

- **Forme recommandée : une seule instruction**, où la borne vient du **même instantané** que la lecture (S2-f : 300 écritures concurrentes, 0 perte, 0 doublon, TESTÉ) :
  ```sql
  WITH s AS (SELECT pg_snapshot_xmin(pg_current_snapshot()) AS borne)
  SELECT t.*, s.borne::text AS borne_txt FROM s
  LEFT JOIN messages t ON t.xid >= $1::xid8 AND t.xid < s.borne AND t.conversation_id = ANY($2)
  ORDER BY t.xid, t.id LIMIT $3;
  ```
  - Le `LEFT JOIN` renvoie la borne même quand aucune ligne n'est livrée.
  - Il n'y a ni état de session ni instruction préparée nommée, ce qui est compatible avec `pgbouncer=true`.
- **Forme en deux instructions** (S2-b, TESTÉ) : elle est correcte aussi, à condition que la borne soit lue **avant** la lecture, même sur un autre serveur derrière PgBouncer.
  - Les identifiants de transaction valent pour tout le cluster, et une transaction est inscrite validée avant de quitter la table des transactions actives (ANALYSÉ).
- **Piège P2**, constaté au premier passage (journal 49) : une borne lue **après** la lecture fait sauter les lignes validées entre les deux.
- **Non mesuré :** aucun PgBouncer sur le banc. Le comportement sous PgBouncer est ANALYSÉ.

## 5. Migration des anciennes lignes

| Option | Mesure (200 000 lignes, 55 Mo) | Décision |
|---|---|---|
| **A**. `ADD COLUMN xid xid8 NOT NULL DEFAULT pg_current_xact_id()` | **3 ms**, aucune réécriture (même filenode), taille inchangée. `pg_current_xact_id` est **STABLE** (`provolatile = s`), donc la valeur est stockée une fois au catalogue (`atthasmissing = true`). Toutes les anciennes lignes portent le xid de la migration ; une nouvelle ligne porte un xid supérieur (S2-c1, TESTÉ). | **Recommandée** |
| B. Colonne nullable, `SET DEFAULT`, rattrapage par lots de 10 000, `CHECK NOT VALID`, `VALIDATE`, `SET NOT NULL` | 2 ms + 2 ms + **5,5 s** (20 lots) + 2 ms + 40 ms + 21 ms. Taille finale **119 Mo**, avec index et lignes mortes (S2-c2, TESTÉ). | Écartée : plus lente et plus volumineuse, sans bénéfice |

- **Hypothèse initiale réfutée :** le dossier supposait une réécriture complète de la table, parce que la fonction était supposée VOLATILE. La mesure (journal 49) a montré le contraire.
- **Toutes les anciennes lignes partagent un seul xid.** La pagination doit donc les départager par `id` (§7).
- **Verrou :** l'`ALTER` prend un verrou ACCESS EXCLUSIVE très bref. S'il attend derrière une transaction ouverte, toutes les lectures de la table font la queue derrière lui.
  - Il faut l'exécuter avec `SET lock_timeout = '500ms'` et le relancer en cas d'échec.
  - S2-c3, TESTÉ : abandon après 871 ms derrière une lecture ouverte, puis 4 ms relancé seul.
- **Index `(xid, id)` :** `CREATE INDEX CONCURRENTLY` prend 450 ms sur 200 000 lignes (S2-c2, TESTÉ).
  - Il ne peut pas s'exécuter dans un bloc de transaction.
  - **À vérifier sur le banc** avant toute migration : Prisma migrate accepte-t-il un fichier de migration contenant uniquement cette instruction ?
  - Le plan d'exécution réel (filtre `conversation_id = ANY(...)` combiné au tri `xid, id`) dépend de la répartition des données. Il est **à mesurer** sur des données représentatives, éventuellement avec un index `(conversation_id, xid, id)`.

## 6. Taille de la table et impact estimé

- Option A : coût **constant**, indépendant du nombre de lignes (aucune réécriture).
- Le seul coût proportionnel est l'index : environ 0,45 s pour 200 000 lignes sur le banc. Ce n'est qu'un ordre de grandeur, qui dépend de la machine.
- **Taille réelle de `messages` sur Supabase : inconnue.** La lecture suivante, non exécutée, demande une autorisation :
  ```sql
  SELECT count(*), pg_size_pretty(pg_total_relation_size('public.messages')) FROM public.messages;
  ```

## 7. Pagination composite

- Le curseur, opaque pour le client, vaut `{ xid, id, borne }`.
- La **borne est figée** à la première page d'un tirage. Les pages suivantes lisent `(xid, id) > (xid_c, id_c) AND xid < borne ORDER BY xid, id`.
- En fin de tirage, le curseur devient `{ xid: borne, id: '' }`.
- S2-d, TESTÉ : 1 000 lignes d'**une seule** transaction (le cas des anciennes lignes après la migration) et 200 lignes concurrentes, en pages de 37 → 1 200/1 200, 0 doublon. Résultat confirmé sur trois répétitions (journal 51).
- **Piège P1**, constaté au premier passage (journal 49) : `SELECT xid::text AS xid … ORDER BY xid` trie sur l'**alias texte** ('1036' < '877'), ce qui donne 86 à 123 pertes. Il faut toujours trier et comparer sur la colonne typée `t.xid`.

## 8. Transactions longues

- **Effet :** un **retard** de livraison égal à la durée de la transaction, sans **perte**. S2-e, TESTÉ : retenue environ 1,5 s, puis les deux lignes sont livrées.
- La borne est commune à **toute la base** : n'importe quelle transaction d'écriture longue la retient, même sur une autre table. Exemples : une migration, un rattrapage, une session `BEGIN` restée ouverte dans l'éditeur SQL.
- Les transactions de lecture seule ne la retiennent pas.
- La transaction des tâches (`runJob`, JOBS-1) n'écrit pas elle-même, donc elle n'a pas d'identifiant (ANALYSÉ).
- **Mesures prévues, non appliquées :**
  - `idle_in_transaction_session_timeout` ;
  - surveillance de `age(backend_xid)` dans `pg_stat_activity` ;
  - alerte si la borne n'avance pas pendant plus de T minutes.

## 9. Reprise après interruption

- Le client enregistre le curseur **après** avoir appliqué la page localement, dans la même transaction SQLite.
- En cas d'arrêt, la page en cours est relivrée et absorbée par l'insertion-ou-mise-à-jour par identifiant serveur (`appliquerMessageServeur` / `cleLocaleExistante` dans [apps/Mobile/src/db/deltaPlan.ts](../../apps/Mobile/src/db/deltaPlan.ts)).
- S2-g, TESTÉ : 115 livraisons, dont 15 relivrées, 100 lignes locales et 0 perte.

## 10. Compatibilité avec les anciens clients

- **Contrat additif :** la requête accepte un `cursor` facultatif ; la réponse ajoute `nextCursor`.
- `lastPulledAt` et `serverTimestamp` restent inchangés. Un ancien client continue comme aujourd'hui, et reste exposé à S2 jusqu'à sa mise à jour.
- **Transition d'un client** (première requête avec `lastPulledAt` et sans `cursor`) :
  1. le serveur lit la borne **avant** la lecture temporelle ;
  2. il renvoie `nextCursor = borne`.
  - Toute ligne avec un xid inférieur à la borne était validée avant cette lecture, donc elle est vue.
  - Les autres seront livrées par le curseur.
  - Les doublons éventuels sont absorbés (§9). ANALYSÉ.
  - Les messages déjà perdus avant la transition ne sont récupérables que par une **resynchronisation complète** (`cursor = 0`).
- Le Web n'utilise pas `/messaging/sync`. Seul le Mobile est concerné ([apps/Mobile/src/services/syncPull.ts](../../apps/Mobile/src/services/syncPull.ts)), et il faut publier une nouvelle version de l'application.

## 11. Stratégie de retour arrière

- **Application :** l'ancienne version ignore la colonne et `nextCursor`. Le client conserve `lastPulledAt` et `cursor`, et revient à `lastPulledAt` si le serveur ne renvoie plus `nextCursor`.
- **Base :**
  - `DROP INDEX CONCURRENTLY` ;
  - `ALTER TABLE messages DROP COLUMN xid`, opération de catalogue sous verrou bref, avec `lock_timeout`.
  - Aucune donnée existante n'est modifiée.
- **Curseur incohérent** (restauration logique, nouveau projet, restauration à un instant antérieur) : un curseur supérieur à `pg_snapshot_xmax` est détectable.
  - S2-h, TESTÉ : le serveur répond « resynchronisation complète ».
  - **Limite (ANALYSÉ) :** après une restauration à un instant antérieur, si assez de transactions passent avant la synchronisation suivante du client, la détection automatique échoue.
  - Une procédure d'exploitation est donc nécessaire : incrémenter une « génération de synchronisation » après toute restauration, ce qui force la resynchronisation.

## 12. Preuves reproductibles

```bash
cd backend
node --test --test-concurrency=1 tests/e2e/curseurStableS2Dossier.e2e.test.mjs tests/e2e/curseurStableS2.e2e.test.mjs
S2_LIGNES=1000000 node --test --test-concurrency=1 tests/e2e/curseurStableS2Dossier.e2e.test.mjs   # volume plus grand
```

**Premier passage (journal 49, conservé) : trois échecs, tous dus au banc ou à une hypothèse, aucun au mécanisme.**
1. Réécriture supposée et réfutée : le défaut est STABLE.
2. Piège P1 : tri sur l'alias texte.
3. Piège P2 : borne relue après une lecture vide.

Les deux pièges sont des erreurs plausibles dans une future implémentation. Ils doivent figurer dans ses tests.

## 13. Opérations soumises à autorisation

1. Lectures Supabase : version PostgreSQL et taille de `messages`.
2. Décision d'architecture : choix de l'option A, du contrat additif et de la procédure de « génération ».
3. Création, puis application, de la migration (hors banc).
4. Publication du client Mobile.
