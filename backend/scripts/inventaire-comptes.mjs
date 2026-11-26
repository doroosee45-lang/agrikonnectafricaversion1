/**
 * Inventaire LECTURE SEULE des comptes (aucune écriture) : préalable à toute
 * suppression. Usage : node scripts/inventaire-comptes.mjs <email-à-conserver>
 */
const garder = (process.argv[2] ?? '').toLowerCase();
const { prisma } = await import('../src/config/prisma.js');
const { supabaseAdmin } = await import('../src/config/supabase.js');

const profils = await prisma.profile.findMany({
  select: { id: true, email: true, status: true, memberships: { select: { organizationId: true, roles: true, status: true } } },
});
const cible = profils.find((p) => p.email.toLowerCase() === garder);
const autres = profils.filter((p) => p.email.toLowerCase() !== garder);
const idsAutres = autres.map((p) => p.id);

const authUsers = [];
for (let page = 1; page < 100; page += 1) {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw new Error(error.message);
  authUsers.push(...data.users);
  if (data.users.length < 1000) break;
}
const authCible = authUsers.find((u) => (u.email ?? '').toLowerCase() === garder);

// Organisations dont TOUS les membres seraient supprimés (orphelines après coup).
const orgsCible = new Set(cible?.memberships.map((m) => m.organizationId) ?? []);
const orgsAutres = [...new Set(autres.flatMap((p) => p.memberships.map((m) => m.organizationId)))];
const orgsOrphelines = orgsAutres.filter((o) => !orgsCible.has(o));

const compter = async (modele, where) => {
  try { return await prisma[modele].count({ where }); } catch { return 'n/a'; }
};
const parOrg = { organizationId: { in: orgsOrphelines } };

console.log(JSON.stringify({
  compteAConserver: cible
    ? { email: cible.email, id: cible.id, statut: cible.status, roles: cible.memberships.map((m) => ({ org: m.organizationId, roles: m.roles, statut: m.status })), presentDansAuth: Boolean(authCible) }
    : 'INTROUVABLE dans profiles',
  profils: { total: profils.length, aSupprimer: autres.length },
  supabaseAuth: { total: authUsers.length, aSupprimer: authUsers.filter((u) => (u.email ?? '').toLowerCase() !== garder).length, sansProfil: authUsers.filter((u) => !profils.some((p) => p.id === u.id)).length },
  organisations: { orphelinesApres: orgsOrphelines.length, partageesAvecLeCompteGarde: orgsAutres.length - orgsOrphelines.length },
  donneesDesOrganisationsOrphelines: {
    exploitations: await compter('farm', parOrg),
    parcelles: await compter('plot', parOrg),
    productions: await compter('production', parOrg),
    medias: await compter('media', parOrg),
  },
  donneesDesComptesASupprimer: {
    adhesions: await compter('membership', { userId: { in: idsAutres } }),
    messagesEnvoyes: await compter('message', { senderId: { in: idsAutres } }),
    appareilsPush: await compter('pushDevice', { userId: { in: idsAutres } }),
    notifications: await compter('notification', { userId: { in: idsAutres } }),
    participationsAppels: await compter('callParticipant', { userId: { in: idsAutres } }),
    appelsCrees: await compter('callSession', { createdBy: { in: idsAutres } }),
    journalAudit: await compter('auditLog', { actorId: { in: idsAutres } }),
  },
  conversations: { total: await compter('conversation', {}) },
}, null, 2));
await prisma.$disconnect();
