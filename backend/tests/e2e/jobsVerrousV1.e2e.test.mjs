import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness } from './support/harness.mjs';

/**
 * JOBS-1 — verrou d'exclusion des tâches planifiées (`runJob`).
 *
 * Défaut visé : verrou de SESSION (`pg_try_advisory_lock`) pris dans une
 * transaction interactive et libéré dans un `finally`. Si la transaction est
 * déjà close (délai Prisma dépassé, connexion coupée), `pg_advisory_unlock`
 * échoue et le verrou reste attaché à la connexion rendue au pool (ou au
 * serveur PgBouncer partagé) : la tâche est alors refusée « déjà en cours sur
 * un autre processus » sans limite de durée.
 *
 * TESTÉ sur PostgreSQL embarqué, sans PgBouncer. Le comportement sous
 * PgBouncer (mode transaction) est ANALYSÉ, pas mesuré.
 */

let h;
let jobs;
const NOM = 'test.verrou.jobs';
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const verrousConsultatifs = async () => {
  const [r] = await h.prisma.$queryRaw`
    SELECT count(*)::int AS n FROM pg_locks
    WHERE locktype = 'advisory' AND granted`;
  return r.n;
};

/** Force un délai de transaction court pour reproduire l'expiration. */
const avecDelaiTransaction = async (timeout, fn) => {
  const original = h.prisma.$transaction;
  h.prisma.$transaction = (cb, o) => original.call(h.prisma, cb, typeof cb === 'function' ? { ...o, timeout } : o);
  try { return await fn(); } finally { h.prisma.$transaction = original; }
};

before(async () => {
  h = await startHarness();
  jobs = await import('../../src/jobs/index.js');
}, { timeout: 240_000 });

after(async () => {
  delete jobs?.JOBS[NOM];
  await h?.stop?.();
});

test('JOBS-1a — transaction expirée pendant la tâche : aucun verrou ne survit, la tâche suivante s’exécute', async (t) => {
  jobs.JOBS[NOM] = { run: async () => { await attendre(700); return { lent: true }; } };
  const premier = await avecDelaiTransaction(200, () => jobs.runJob(NOM).then((r) => ({ ok: r }), (e) => ({ erreur: e.message })));
  await attendre(100);
  const restants = await verrousConsultatifs();

  jobs.JOBS[NOM] = { run: async () => ({ rapide: true }) };
  const suivants = [];
  for (let i = 0; i < 6; i += 1) suivants.push(await jobs.runJob(NOM));
  const refuses = suivants.filter((r) => r?.skipped).length;
  t.diagnostic(`JOBS-1a : 1re exécution ${JSON.stringify(premier).slice(0, 160)} ; verrous consultatifs restants=${restants} ; exécutions suivantes refusées=${refuses}/6`);

  assert.ok(premier.erreur, 'l’expiration de la transaction est signalée (échec de la tâche)');
  assert.equal(restants, 0, 'aucun verrou consultatif ne survit à la transaction');
  assert.equal(refuses, 0, 'aucune exécution suivante refusée à tort');
});

test('JOBS-1b — tâche en erreur : verrou libéré', async () => {
  jobs.JOBS[NOM] = { run: async () => { throw new Error('panne tâche'); } };
  await assert.rejects(jobs.runJob(NOM), /panne tâche/);
  assert.equal(await verrousConsultatifs(), 0);
  jobs.JOBS[NOM] = { run: async () => ({ ok: 1 }) };
  assert.equal((await jobs.runJob(NOM))?.ok, true);
});

test('JOBS-1c — autre processus détenteur du verrou : exécution refusée, puis acceptée après sa fin', async () => {
  jobs.JOBS[NOM] = { run: async () => ({ ok: 1 }) };
  let liberer;
  const fin = new Promise((r) => { liberer = r; });
  let pris;
  const prisLe = new Promise((r) => { pris = r; });
  // « Autre processus » : une autre connexion tient le même verrou (même espace de clés).
  const detenteur = h.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${NOM}))`;
    pris();
    await fin;
  }, { timeout: 20_000 });
  await prisLe;
  const pendant = await jobs.runJob(NOM);
  liberer();
  await detenteur;
  const apres = await jobs.runJob(NOM);
  assert.equal(pendant?.skipped, true);
  assert.match(pendant.reason, /autre processus/);
  assert.equal(apres?.ok, true);
  assert.equal(await verrousConsultatifs(), 0);
});
