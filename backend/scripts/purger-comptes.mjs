/**
 * Suppression de TOUS les comptes sauf un (portée « comptes seulement »).
 *
 *   node scripts/purger-comptes.mjs <email-à-conserver>                 → SIMULATION (aucune écriture)
 *   node scripts/purger-comptes.mjs <email-à-conserver> --executer      → sauvegarde JSON PUIS suppression
 *
 * Supprimé : profils (→ CASCADE : adhésions, appareils push, participations
 * aux appels, bibliothèque, profils/affiliations académiques), notifications
 * des comptes (pas de clé étrangère), appels CRÉÉS par ces comptes (RESTRICT :
 * sinon le profil ne peut pas être supprimé), utilisateurs Supabase Auth.
 * Conservé : organisations, conversations, messages ; journal d'audit (auteur
 * mis à NULL par la base). Arrêt si une ligne académique en RESTRICT bloque.
 * La sauvegarde est écrite HORS du dépôt (données personnelles).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const garder = (process.argv[2] ?? '').trim().toLowerCase();
const executer = process.argv.includes('--executer');
if (!garder.includes('@')) {
  console.error('Usage : node scripts/purger-comptes.mjs <email-à-conserver> [--executer]');
  process.exit(1);
}

const { prisma } = await import('../src/config/prisma.js');
const { supabaseAdmin } = await import('../src/config/supabase.js');

/* ───── périmètre ───── */
const profils = await prisma.profile.findMany();
const cible = profils.find((p) => p.email.toLowerCase() === garder);
if (!cible) throw new Error(`Compte à conserver introuvable : ${garder}`);
const roleCible = await prisma.membership.findMany({ where: { userId: cible.id, status: 'ACTIVE' } });
if (!roleCible.some((m) => m.roles.includes('SUPER_ADMIN'))) throw new Error('Le compte conservé n’est pas SUPER_ADMIN : arrêt.');

const authUsers = [];
for (let page = 1; page < 100; page += 1) {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw new Error(error.message);
  authUsers.push(...data.users);
  if (data.users.length < 1000) break;
}
if (!authUsers.some((u) => u.id === cible.id)) throw new Error('Le compte conservé est absent de Supabase Auth : arrêt.');

const ids = profils.filter((p) => p.id !== cible.id).map((p) => p.id);
const authASupprimer = authUsers.filter((u) => u.id !== cible.id);

/* ───── blocages RESTRICT (académique) ───── */
const restrict = await prisma.$queryRaw`
  SELECT
    (SELECT count(*)::int FROM academic_works WHERE created_by = ANY(${ids}::uuid[])) AS works,
    (SELECT count(*)::int FROM academic_review_events WHERE actor_id = ANY(${ids}::uuid[])) AS reviews,
    (SELECT count(*)::int FROM academic_work_file_versions WHERE uploaded_by = ANY(${ids}::uuid[])) AS versions`;
const bloquant = restrict[0];

const appels = await prisma.callSession.findMany({ where: { createdBy: { in: ids } }, include: { participants: true, events: true } });
const resume = {
  base: process.env.SUPABASE_URL ?? '(SUPABASE_URL)',
  compteConserve: { email: cible.email, id: cible.id, roles: roleCible.map((m) => m.roles) },
  profilsASupprimer: ids.length,
  utilisateursAuthASupprimer: authASupprimer.length,
  notificationsASupprimer: await prisma.notification.count({ where: { userId: { in: ids } } }),
  appelsCreesASupprimer: appels.length,
  cascadeAttendue: {
    adhesions: await prisma.membership.count({ where: { userId: { in: ids } } }),
    appareilsPush: await prisma.pushDevice.count({ where: { userId: { in: ids } } }),
    participationsAppels: await prisma.callParticipant.count({ where: { userId: { in: ids } } }),
  },
  conserves: {
    organisations: await prisma.organization.count(),
    conversations: await prisma.conversation.count(),
    messages: await prisma.message.count(),
    journalAudit: await prisma.auditLog.count({ where: { actorId: { in: ids } } }) + ' lignes (auteur → NULL)',
  },
  blocagesAcademiques: bloquant,
};
console.log(JSON.stringify(resume, null, 2));

if (bloquant.works + bloquant.reviews + bloquant.versions > 0) {
  console.error('ARRÊT : des données académiques (RESTRICT) appartiennent à ces comptes.');
  process.exit(2);
}
if (!executer) {
  console.log('\nSIMULATION : aucune écriture. Relancer avec --executer pour supprimer.');
  await prisma.$disconnect();
  process.exit(0);
}

/* ───── sauvegarde HORS dépôt ───── */
const racineDepot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dossier = path.resolve(racineDepot, '..', 'sauvegardes-agrikonnect');
fs.mkdirSync(dossier, { recursive: true });
const horodatage = new Date().toISOString().replace(/[:.]/g, '-');
const fichier = path.join(dossier, `purge-comptes-${horodatage}.json`);
const sauvegarde = {
  creeLe: new Date().toISOString(),
  compteConserve: cible.email,
  profils: profils.filter((p) => ids.includes(p.id)),
  adhesions: await prisma.membership.findMany({ where: { userId: { in: ids } } }),
  appareilsPush: await prisma.pushDevice.findMany({ where: { userId: { in: ids } } }),
  notifications: await prisma.notification.findMany({ where: { userId: { in: ids } } }),
  appels,
  participationsAppels: await prisma.callParticipant.findMany({ where: { userId: { in: ids } } }),
  utilisateursAuth: authASupprimer.map((u) => ({
    id: u.id, email: u.email, phone: u.phone, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at,
    email_confirmed_at: u.email_confirmed_at, user_metadata: u.user_metadata, app_metadata: u.app_metadata,
  })),
};
fs.writeFileSync(fichier, JSON.stringify(sauvegarde, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
console.log(`\nSauvegarde : ${fichier}`);

/* ───── suppression base (une transaction) ───── */
const resultat = await prisma.$transaction(async (tx) => {
  const notifications = await tx.notification.deleteMany({ where: { userId: { in: ids } } });
  const appelsSup = await tx.callSession.deleteMany({ where: { createdBy: { in: ids } } });
  const profilsSup = await tx.profile.deleteMany({ where: { id: { in: ids } } });
  return { notifications: notifications.count, appels: appelsSup.count, profils: profilsSup.count };
}, { timeout: 60_000, maxWait: 20_000 });
console.log('Base :', JSON.stringify(resultat));

/* ───── Supabase Auth ───── */
const echecs = [];
for (const u of authASupprimer) {
  // eslint-disable-next-line no-await-in-loop
  const { error } = await supabaseAdmin.auth.admin.deleteUser(u.id);
  if (error) echecs.push({ email: u.email, erreur: error.message });
}
console.log(`Auth : ${authASupprimer.length - echecs.length}/${authASupprimer.length} supprimés`, echecs.length ? JSON.stringify(echecs) : '');

/* ───── vérification ───── */
const restants = await prisma.profile.findMany({ select: { email: true } });
const { data: authRestants } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
console.log('Après : profils =', JSON.stringify(restants.map((p) => p.email)), '; Auth =', JSON.stringify(authRestants.users.map((u) => u.email)));
await prisma.$disconnect();
