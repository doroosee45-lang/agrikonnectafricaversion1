import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startHarness } from './support/harness.mjs';

/**
 * S2 — CONCEPTION d'un curseur stable, démontrée AVANT toute correction.
 *
 * Aucune migration, aucune modification de l'application : la démonstration
 * crée sa propre table `s2_demo` dans la base EMBARQUÉE jetable du banc.
 *
 * Principe : chaque ligne porte l'identifiant de la transaction qui l'a écrite
 * (`xid8 DEFAULT pg_current_xact_id()`). Le lecteur prend `x = pg_snapshot_xmin
 * (pg_current_snapshot())` : toute transaction d'identifiant < x est TERMINÉE.
 * Il livre les lignes dont `curseur ≤ xid < x`, puis passe le curseur à x.
 * Une ligne d'une transaction encore en cours a un xid ≥ x : elle est livrée au
 * tirage où elle sera terminée. Chaque ligne appartient à un seul intervalle :
 * ni perte, ni doublon — sans fenêtre de temps arbitraire.
 */

let h;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  h = await startHarness();
  await h.prisma.$executeRawUnsafe(`CREATE TABLE s2_demo (
    id text PRIMARY KEY,
    xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    body text NOT NULL
  )`);
}, { timeout: 240_000 });

after(async () => {
  await h?.stop?.();
});

/** Lecture par curseur de transaction : renvoie { lignes, curseur }. */
const tirerXid = async (curseur) => {
  const [{ xmin }] = await h.prisma.$queryRaw`SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS xmin`;
  const lignes = await h.prisma.$queryRawUnsafe(
    'SELECT id FROM s2_demo WHERE xid >= $1::xid8 AND xid < $2::xid8 ORDER BY xid, id',
    curseur,
    xmin,
  );
  return { lignes: lignes.map((l) => l.id), curseur: xmin };
};

/** Lecture par curseur temporel (comportement actuel de deltaSync, page non pleine). */
const tirerTemps = async (depuis) => {
  const maintenant = new Date();
  const lignes = await h.prisma.$queryRaw`SELECT id FROM s2_demo WHERE created_at > ${depuis}`;
  return { lignes: lignes.map((l) => l.id), curseur: maintenant };
};

test('S2-a — transaction en cours pendant la lecture : PERDUE avec le curseur temporel, LIVRÉE avec le curseur de transaction', async (t) => {
  const xid0 = (await tirerXid('0')).curseur;
  const t0 = new Date();
  const tardif = `tardif-${randomUUID()}`;
  let liberer;
  const verrou = new Promise((r) => { liberer = r; });
  const ecriture = h.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO s2_demo (id, body) VALUES (${tardif}, 'tardif')`;
    await verrou;
  }, { timeout: 30_000 });
  await pause(200);
  const tempsPendant = await tirerTemps(t0);
  const xidPendant = await tirerXid(xid0);
  liberer();
  await ecriture;
  const tempsApres = await tirerTemps(tempsPendant.curseur);
  const xidApres = await tirerXid(xidPendant.curseur);
  const recuTemps = [...tempsPendant.lignes, ...tempsApres.lignes].includes(tardif);
  const recuXid = [...xidPendant.lignes, ...xidApres.lignes].includes(tardif);
  t.diagnostic(`S2-a : curseur temporel → reçu=${recuTemps} ; curseur de transaction → reçu=${recuXid} (pendant : ${xidPendant.lignes.includes(tardif)}, après : ${xidApres.lignes.includes(tardif)})`);
  assert.equal(recuTemps, false, 'reproduit S2 : le curseur temporel perd la ligne');
  assert.equal(recuXid, true, 'le curseur de transaction la livre');
  assert.equal(xidPendant.lignes.includes(tardif), false, 'jamais livrée tant que sa transaction est en cours');
});

test('S2-b — 300 écritures concurrentes (durées aléatoires) pendant des tirages répétés : 0 perte, 0 doublon', async (t) => {
  let curseur = (await tirerXid('0')).curseur;
  const ecrites = [];
  const recues = [];
  let actif = true;
  const lecteur = (async () => {
    while (actif) {
      const r = await tirerXid(curseur);
      recues.push(...r.lignes);
      curseur = r.curseur;
      await pause(5);
    }
  })();
  let graine = 11;
  const alea = () => { graine = (graine * 1103515245 + 12345) % 2 ** 31; return graine / 2 ** 31; };
  await Promise.all(Array.from({ length: 300 }, async (_, i) => {
    await pause(Math.floor(alea() * 400));
    const id = `c-${i}-${randomUUID()}`;
    const duree = Math.floor(alea() * 60);
    await h.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO s2_demo (id, body) VALUES (${id}, 'concurrent')`;
      await pause(duree);
    }, { timeout: 30_000, maxWait: 30_000 });
    ecrites.push(id);
  }));
  await pause(100);
  actif = false;
  await lecteur;
  const final = await tirerXid(curseur);
  recues.push(...final.lignes);
  const concurrentes = new Set(ecrites);
  const recuesConcurrentes = recues.filter((id) => concurrentes.has(id));
  const doublons = recuesConcurrentes.length - new Set(recuesConcurrentes).size;
  const perdues = ecrites.filter((id) => !recuesConcurrentes.includes(id)).length;
  t.diagnostic(`S2-b : écrites ${ecrites.length} ; reçues ${new Set(recuesConcurrentes).size} ; perdues ${perdues} ; doublons ${doublons}`);
  assert.equal(perdues, 0);
  assert.equal(doublons, 0);
});
