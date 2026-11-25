import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { startHarness } from './support/harness.mjs';

/**
 * S2 — DOSSIER DE CONCEPTION : mesures reproductibles (complète
 * curseurStableS2.e2e.test.mjs, S2-a / S2-b).
 *
 * AUCUNE implémentation, AUCUNE migration : uniquement des tables de
 * démonstration (`s2d_*`) créées dans la base EMBARQUÉE jetable du banc
 * (PostgreSQL 18.4). Les durées dépendent de la machine : elles servent
 * d'ordre de grandeur et de méthode, pas de garantie pour Supabase.
 *
 * Volume : S2_LIGNES (défaut 200 000 lignes, corps de 180 caractères).
 */

let h;
const N = Number(process.env.S2_LIGNES ?? 200_000);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql, ...p) => h.prisma.$queryRawUnsafe(sql, ...p);
const x = (sql, ...p) => h.prisma.$executeRawUnsafe(sql, ...p);
const chrono = async (fn) => { const t = performance.now(); const r = await fn(); return [Math.round(performance.now() - t), r]; };
const fichier = async (t) => (await q(`SELECT pg_relation_filenode('${t}')::text AS f`))[0].f;
const taille = async (t) => (await q(`SELECT pg_size_pretty(pg_total_relation_size('${t}')) AS s`))[0].s;

/** Table au gabarit de `messages` (colonnes utiles au tirage), remplie de N lignes. */
const creerTable = async (nom) => {
  await x(`CREATE TABLE ${nom} (
    id text PRIMARY KEY, conversation_id text NOT NULL, body text NOT NULL,
    attachments text[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now())`);
  await x(`INSERT INTO ${nom} (id, conversation_id, body, created_at)
    SELECT 'm' || lpad(g::text, 9, '0'), 'c' || (g % 500), repeat('x', 180), now() - (g || ' seconds')::interval
    FROM generate_series(1, ${N}) g`);
  await x(`ANALYZE ${nom}`);
};

/** Tirage par curseur de transaction, en UNE instruction (compatible PgBouncer mode transaction). */
/*
 * Piège P2 (constaté au premier passage, journal 49) : la borne doit venir du
 * MÊME instantané que la lecture (ou d'un instantané ANTÉRIEUR). L'ancienne
 * version relisait la borne par une 2e requête quand le résultat était vide :
 * borne postérieure à la lecture → lignes validées entre les deux sautées.
 * Le LEFT JOIN garantit au moins une ligne portant la borne.
 */
const tirerUneInstruction = async (table, curseur) => {
  const lignes = await q(
    `WITH s AS (SELECT pg_snapshot_xmin(pg_current_snapshot()) AS borne)
     SELECT t.id, s.borne::text AS borne_txt FROM s
     LEFT JOIN ${table} t ON t.xid >= $1::xid8 AND t.xid < s.borne
     ORDER BY t.xid, t.id`,
    curseur,
  );
  return { lignes: lignes.filter((l) => l.id !== null).map((l) => l.id), curseur: lignes[0].borne_txt };
};

/**
 * Pagination composite : borne haute FIGÉE au début du tirage (première page),
 * position (xid, id) dans l'intervalle [début, borne). Fin du tirage → curseur = borne.
 */
const tirerPage = async (table, c, taillePage) => {
  const borne = c.borne ?? (await q('SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS b'))[0].b;
  /*
   * Piège P1 (constaté au premier passage, journal 49) : `SELECT xid::text AS xid
   * … ORDER BY xid` trie sur l'ALIAS texte ('1036' < '877') et non sur la colonne
   * xid8 : pages sautées. Tri et comparaison toujours sur la colonne typée.
   */
  const lignes = await q(
    `SELECT t.id, t.xid::text AS xid_txt FROM ${table} t
     WHERE (t.xid, t.id) > ($1::xid8, $2::text) AND t.xid < $3::xid8
     ORDER BY t.xid, t.id LIMIT ${taillePage + 1}`,
    c.xid, c.id, borne,
  );
  const page = lignes.slice(0, taillePage);
  const encore = lignes.length > taillePage;
  const dernier = page[page.length - 1];
  return {
    lignes: page.map((l) => l.id),
    suivant: encore ? { xid: dernier.xid_txt, id: dernier.id, borne } : { xid: borne, id: '', borne: null },
    encore,
  };
};
const curseurInitial = (xid = '0') => ({ xid, id: '', borne: null });

before(async () => {
  h = await startHarness();
}, { timeout: 240_000 });

after(async () => {
  await h?.stop?.();
});

test('S2-0 — version PostgreSQL du banc et disponibilité des fonctions (PostgreSQL ≥ 13)', async (t) => {
  const [v] = await q(`SELECT current_setting('server_version') AS v, current_setting('server_version_num')::int AS n,
    pg_typeof(pg_current_xact_id())::text AS type_xid, pg_typeof(pg_current_snapshot())::text AS type_snap`);
  t.diagnostic(`S2-0 : PostgreSQL ${v.v} (${v.n}) ; pg_current_xact_id → ${v.type_xid} ; pg_current_snapshot → ${v.type_snap}`);
  assert.ok(v.n >= 130000);
  assert.equal(v.type_xid, 'xid8');
});

/*
 * Hypothèse initiale du dossier : « défaut volatil → réécriture complète ».
 * RÉFUTÉE au premier passage (journal 49) : pg_current_xact_id() est STABLE ;
 * PostgreSQL ≥ 11 l'évalue UNE fois et la stocke comme valeur manquante
 * (attmissingval) : pas de réécriture, toutes les anciennes lignes portent le
 * xid de la migration, les nouvelles leur propre xid.
 */
test(`S2-c1 — ADD COLUMN xid8 NOT NULL DEFAULT pg_current_xact_id() sur ${N} lignes : PAS de réécriture (défaut STABLE)`, async (t) => {
  await creerTable('s2d_reecriture');
  const avant = await fichier('s2d_reecriture');
  const tailleAvant = await taille('s2d_reecriture');
  let lectureBloqueeMs = null;
  const alter = chrono(() => x(`ALTER TABLE s2d_reecriture ADD COLUMN xid xid8 NOT NULL DEFAULT pg_current_xact_id()`));
  await pause(30);
  // Lecture concurrente pendant l'ALTER : combien de temps attend-elle ?
  const lecture = chrono(() => q(`SELECT count(*)::int AS n FROM s2d_reecriture WHERE conversation_id = 'c1'`)).then(([ms]) => { lectureBloqueeMs = ms; });
  const [ms] = await alter;
  await lecture;
  const apres = await fichier('s2d_reecriture');
  const [{ distincts }] = await q(`SELECT count(DISTINCT xid)::int AS distincts FROM s2d_reecriture`);
  const [{ volatilite }] = await q(`SELECT provolatile::text AS volatilite FROM pg_proc WHERE proname = 'pg_current_xact_id'`);
  const [{ manquante }] = await q(`SELECT atthasmissing AS manquante FROM pg_attribute
    WHERE attrelid = 's2d_reecriture'::regclass AND attname = 'xid'`);
  await x(`INSERT INTO s2d_reecriture (id, conversation_id, body) VALUES ('apres-migration', 'c1', 'n')`);
  const [{ plusgrand }] = await q(`SELECT (SELECT xid FROM s2d_reecriture WHERE id = 'apres-migration')
    > (SELECT xid FROM s2d_reecriture WHERE id = 'm000000001') AS plusgrand`);
  t.diagnostic(`S2-c1 : provolatile(pg_current_xact_id)=${volatilite} ; atthasmissing=${manquante} ; nouvelle ligne xid > xid de migration=${plusgrand}`);
  t.diagnostic(`S2-c1 : ALTER ${ms} ms ; réécriture=${avant !== apres} (filenode ${avant} → ${apres}) ; taille ${tailleAvant} → ${await taille('s2d_reecriture')} ; lecture concurrente attendue ${lectureBloqueeMs} ms ; xid distincts des anciennes lignes=${distincts} (toutes = xid de la migration)`);
  assert.equal(avant, apres, 'aucune réécriture (même filenode)');
  assert.equal(volatilite, 's', 'fonction STABLE');
  assert.equal(manquante, true, 'valeur par défaut stockée au catalogue');
  assert.equal(distincts, 1, 'toutes les anciennes lignes portent le xid de la migration');
  assert.equal(plusgrand, true);
});

test('S2-c3 — ALTER (ACCESS EXCLUSIVE) derrière une transaction ouverte : lock_timeout borne l’attente', async (t) => {
  await x(`CREATE TABLE s2d_verrou (id text PRIMARY KEY, body text NOT NULL)`);
  await x(`INSERT INTO s2d_verrou SELECT 'v' || g, 'x' FROM generate_series(1, 1000) g`);
  let fin;
  const lecteurLong = h.prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(`SELECT count(*)::int FROM s2d_verrou`);
    await new Promise((r) => { fin = r; });
  }, { timeout: 20_000 });
  await pause(50);
  const [ms, erreur] = await chrono(() => h.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '500ms'`);
    await tx.$executeRawUnsafe(`ALTER TABLE s2d_verrou ADD COLUMN xid xid8 NOT NULL DEFAULT pg_current_xact_id()`);
  }).then(() => null, (e) => String(e?.meta?.message ?? e?.message ?? e)));
  fin();
  await lecteurLong;
  const [msApres] = await chrono(() => x(`ALTER TABLE s2d_verrou ADD COLUMN xid xid8 NOT NULL DEFAULT pg_current_xact_id()`));
  t.diagnostic(`S2-c3 : ALTER derrière une lecture ouverte → abandon après ${ms} ms (${(erreur ?? 'aucune erreur').replace(/\s+/g, ' ').slice(-140)}) ; relancé seul : ${msApres} ms`);
  assert.match(erreur ?? '', /lock timeout|verrou|55P03/i);
});

test(`S2-c2 — variante SANS réécriture : colonne nullable, SET DEFAULT, rattrapage par lots, NOT NULL validé (${N} lignes)`, async (t) => {
  await creerTable('s2d_lots');
  const avant = await fichier('s2d_lots');
  const [msAjout] = await chrono(() => x(`ALTER TABLE s2d_lots ADD COLUMN xid xid8`));
  const [msDefaut] = await chrono(() => x(`ALTER TABLE s2d_lots ALTER COLUMN xid SET DEFAULT pg_current_xact_id()`));
  const sansReecriture = avant === (await fichier('s2d_lots'));
  await x(`INSERT INTO s2d_lots (id, conversation_id, body) VALUES ('nouveau', 'c1', 'n')`);
  const [{ nouveau }] = await q(`SELECT (xid IS NOT NULL) AS nouveau FROM s2d_lots WHERE id = 'nouveau'`);
  // Rattrapage : lots de 10 000, une transaction par lot (verrous de ligne courts).
  let lots = 0;
  const [msRattrapage] = await chrono(async () => {
    for (;;) {
      const n = await x(`UPDATE s2d_lots SET xid = pg_current_xact_id()
        WHERE id IN (SELECT id FROM s2d_lots WHERE xid IS NULL ORDER BY id LIMIT 10000)`);
      if (n === 0) break;
      lots += 1;
    }
  });
  // NOT NULL sans parcours sous verrou exclusif : CHECK NOT VALID puis VALIDATE (verrou faible).
  const [msCheck] = await chrono(() => x(`ALTER TABLE s2d_lots ADD CONSTRAINT s2d_lots_xid_nn CHECK (xid IS NOT NULL) NOT VALID`));
  const [msValidate] = await chrono(() => x(`ALTER TABLE s2d_lots VALIDATE CONSTRAINT s2d_lots_xid_nn`));
  const [msNotNull] = await chrono(() => x(`ALTER TABLE s2d_lots ALTER COLUMN xid SET NOT NULL`));
  const [msIndex] = await chrono(() => x(`CREATE INDEX CONCURRENTLY s2d_lots_xid_id ON s2d_lots (xid, id)`));
  const [{ nuls }] = await q(`SELECT count(*)::int AS nuls FROM s2d_lots WHERE xid IS NULL`);
  t.diagnostic(`S2-c2 : ADD COLUMN ${msAjout} ms, SET DEFAULT ${msDefaut} ms, réécriture=${!sansReecriture} ; nouvelle ligne marquée=${nouveau} ; rattrapage ${lots} lots en ${msRattrapage} ms ; CHECK NOT VALID ${msCheck} ms, VALIDATE ${msValidate} ms, SET NOT NULL (s'appuie sur le CHECK validé) ${msNotNull} ms ; CREATE INDEX CONCURRENTLY (xid,id) ${msIndex} ms ; taille ${await taille('s2d_lots')} ; nuls restants ${nuls}`);
  assert.equal(sansReecriture, true);
  assert.equal(nouveau, true);
  assert.equal(nuls, 0);
});

test('S2-d — pagination composite (xid, id), borne figée : 1 000 lignes d’UNE transaction + 200 concurrentes, pages de 37 → 0 perte, 0 doublon', async (t) => {
  await x(`CREATE TABLE s2d_pages (id text PRIMARY KEY, xid xid8 NOT NULL DEFAULT pg_current_xact_id(), body text NOT NULL)`);
  const debut = (await q('SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS b'))[0].b;
  // Cas du rattrapage : beaucoup de lignes partagent le MÊME xid — seul `id` les départage.
  await x(`INSERT INTO s2d_pages (id, body) SELECT 'bloc-' || lpad(g::text, 5, '0'), 'b' FROM generate_series(1, 1000) g`);
  const ecrites = Array.from({ length: 1000 }, (_, i) => `bloc-${String(i + 1).padStart(5, '0')}`);
  const recues = [];
  let actif = true;
  let pages = 0;
  const lecteur = (async () => {
    let c = curseurInitial(debut);
    while (actif) {
      const r = await tirerPage('s2d_pages', c, 37);
      recues.push(...r.lignes);
      pages += 1;
      c = r.suivant;
      if (!r.encore) await pause(5);
    }
    return c;
  })();
  await Promise.all(Array.from({ length: 200 }, async (_, i) => {
    await pause(Math.floor(Math.random() * 300));
    const id = `conc-${i}-${randomUUID()}`;
    await h.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO s2d_pages (id, body) VALUES ($1, 'c')`, id);
      await pause(Math.floor(Math.random() * 40));
    }, { timeout: 30_000, maxWait: 30_000 });
    ecrites.push(id);
  }));
  await pause(50);
  actif = false;
  let c = await lecteur;
  for (let r = await tirerPage('s2d_pages', c, 37); ; r = await tirerPage('s2d_pages', c, 37)) {
    recues.push(...r.lignes); c = r.suivant; if (!r.encore) break;
  }
  const doublons = recues.length - new Set(recues).size;
  const perdues = ecrites.filter((id) => !recues.includes(id)).length;
  t.diagnostic(`S2-d : écrites ${ecrites.length} ; pages ${pages} ; reçues ${new Set(recues).size} ; perdues ${perdues} ; doublons ${doublons}`);
  assert.equal(perdues, 0);
  assert.equal(doublons, 0);
});

test('S2-e — transaction longue : RETARD de livraison (pas de perte) ; une transaction en lecture seule ne retarde rien', async (t) => {
  await x(`CREATE TABLE s2d_longue (id text PRIMARY KEY, xid xid8 NOT NULL DEFAULT pg_current_xact_id(), body text NOT NULL)`);
  const c0 = (await tirerUneInstruction('s2d_longue', '0')).curseur;
  // 1) Lecture seule longue (aucun xid attribué) pendant une écriture courte.
  let finLecture;
  const lectureSeule = h.prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT 1');
    await new Promise((r) => { finLecture = r; });
  }, { timeout: 20_000 });
  await pause(50);
  await x(`INSERT INTO s2d_longue (id, body) VALUES ('pendant-lecture', 'x')`);
  const r1 = await tirerUneInstruction('s2d_longue', c0);
  finLecture();
  await lectureSeule;
  // 2) Écriture longue (xid attribué) : bloque l'avancée de la borne.
  let finEcriture;
  const t0 = performance.now();
  const ecritureLongue = h.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`INSERT INTO s2d_longue (id, body) VALUES ('longue', 'x')`);
    await new Promise((r) => { finEcriture = r; });
  }, { timeout: 20_000 });
  await pause(50);
  await x(`INSERT INTO s2d_longue (id, body) VALUES ('apres-longue', 'x')`);
  const r2 = await tirerUneInstruction('s2d_longue', r1.curseur);
  await pause(1500);
  const r3 = await tirerUneInstruction('s2d_longue', r2.curseur);
  finEcriture();
  await ecritureLongue;
  const r4 = await tirerUneInstruction('s2d_longue', r3.curseur);
  const retardMs = Math.round(performance.now() - t0);
  t.diagnostic(`S2-e : lecture seule longue → ligne livrée immédiatement=${r1.lignes.includes('pendant-lecture')} ; écriture longue ouverte → 'apres-longue' livrée pendant=${[...r2.lignes, ...r3.lignes].includes('apres-longue')} ; après fin de la transaction longue (~${retardMs} ms) → livrées ${JSON.stringify(r4.lignes)}`);
  assert.equal(r1.lignes.includes('pendant-lecture'), true);
  assert.equal([...r2.lignes, ...r3.lignes].includes('apres-longue'), false, 'retenue tant que la transaction longue est ouverte');
  assert.deepEqual([...r4.lignes].sort(), ['apres-longue', 'longue']);
});

test('S2-f — lecture en UNE instruction (CTE) : 300 écritures concurrentes, 0 perte, 0 doublon', async (t) => {
  await x(`CREATE TABLE s2d_cte (id text PRIMARY KEY, xid xid8 NOT NULL DEFAULT pg_current_xact_id(), body text NOT NULL)`);
  let curseur = (await tirerUneInstruction('s2d_cte', '0')).curseur;
  const ecrites = [];
  const recues = [];
  let actif = true;
  const lecteur = (async () => {
    while (actif) {
      const r = await tirerUneInstruction('s2d_cte', curseur);
      recues.push(...r.lignes);
      curseur = r.curseur;
      await pause(3);
    }
  })();
  await Promise.all(Array.from({ length: 300 }, async (_, i) => {
    await pause(Math.floor(Math.random() * 300));
    const id = `f-${i}-${randomUUID()}`;
    await h.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO s2d_cte (id, body) VALUES ($1, 'c')`, id);
      await pause(Math.floor(Math.random() * 50));
    }, { timeout: 30_000, maxWait: 30_000 });
    ecrites.push(id);
  }));
  await pause(50);
  actif = false;
  await lecteur;
  recues.push(...(await tirerUneInstruction('s2d_cte', curseur)).lignes);
  const doublons = recues.length - new Set(recues).size;
  const perdues = ecrites.filter((id) => !recues.includes(id)).length;
  t.diagnostic(`S2-f : écrites ${ecrites.length} ; reçues ${new Set(recues).size} ; perdues ${perdues} ; doublons ${doublons}`);
  assert.equal(perdues, 0);
  assert.equal(doublons, 0);
});

test('S2-g — reprise après interruption : curseur non enregistré → page relivrée, absorbée par l’upsert local (0 perte)', async (t) => {
  await x(`CREATE TABLE s2d_reprise (id text PRIMARY KEY, xid xid8 NOT NULL DEFAULT pg_current_xact_id(), body text NOT NULL)`);
  for (let i = 0; i < 5; i += 1) {
    await x(`INSERT INTO s2d_reprise (id, body) SELECT 'r' || $1 || '-' || g, 'r' FROM generate_series(1, 20) g`, String(i));
  }
  const local = new Map(); // base locale : upsert par identifiant serveur
  let livraisons = 0;
  let enregistre = curseurInitial(); // curseur ENREGISTRÉ (après application locale)
  // Premier passage : interruption après la 3e page, AVANT l'enregistrement du curseur.
  let c = enregistre;
  for (let page = 1; ; page += 1) {
    const r = await tirerPage('s2d_reprise', c, 15);
    r.lignes.forEach((id) => { local.set(id, true); livraisons += 1; });
    if (page === 3) break; // arrêt brutal : r.suivant perdu
    enregistre = r.suivant;
    c = r.suivant;
  }
  // Reprise depuis le dernier curseur enregistré.
  c = enregistre;
  for (;;) {
    const r = await tirerPage('s2d_reprise', c, 15);
    r.lignes.forEach((id) => { local.set(id, true); livraisons += 1; });
    enregistre = r.suivant;
    c = r.suivant;
    if (!r.encore) break;
  }
  t.diagnostic(`S2-g : 100 lignes ; livraisons ${livraisons} (dont ${livraisons - local.size} relivrées) ; base locale ${local.size}`);
  assert.equal(local.size, 100);
  assert.ok(livraisons > 100, 'la page interrompue est relivrée');
});

test('S2-h — curseur incohérent (restauration logique, autre base) : détectable, déclenche une resynchronisation complète', async (t) => {
  const [{ xmax }] = await q('SELECT pg_snapshot_xmax(pg_current_snapshot())::text AS xmax');
  const futur = (BigInt(xmax) + 1_000_000n).toString();
  const [{ incoherent }] = await q(`SELECT ($1::xid8 > pg_snapshot_xmax(pg_current_snapshot())) AS incoherent`, futur);
  const [{ valide }] = await q(`SELECT ($1::xid8 > pg_snapshot_xmax(pg_current_snapshot())) AS valide`, xmax);
  t.diagnostic(`S2-h : xmax actuel ${xmax} ; curseur ${futur} → incohérent=${incoherent} ; curseur ${xmax} → incohérent=${valide}`);
  assert.equal(incoherent, true);
  assert.equal(valide, false);
});
