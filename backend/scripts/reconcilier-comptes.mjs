/**
 * Réconciliation des comptes Supabase Auth ↔ profils applicatifs (TX-1).
 *
 * LECTURE SEULE : aucune suppression, aucune modification. Produit un rapport :
 *  - `orphelinsAuth`        : utilisateurs Supabase sans profil applicatif
 *                             (compensation échouée, arrêt du serveur entre la
 *                             création Auth et la transaction PostgreSQL) ;
 *                             récupérables à la connexion (`/auth/sync-profile`) ;
 *  - `orphelinsApplicatifs` : profils sans utilisateur Supabase (ancien défaut
 *                             TX-1, ou suppression faite dans la console) ;
 *  - `compensationsEchouees`: échecs de compensation journalisés à l'inscription
 *                             (audit `auth.register.compensation_failed`).
 *
 * Usage (après AUTORISATION, sur l'environnement visé par backend/.env) :
 *   node scripts/reconcilier-comptes.mjs > rapport-comptes.json
 */
import { pathToFileURL } from 'node:url';

/** Liste paginée de tous les utilisateurs Supabase (admin.listUsers). */
export const listerTousLesUtilisateursAuth = async (supabaseAdmin, parPage = 1000) => {
  const tous = [];
  for (let page = 1; page < 10_000; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: parPage });
    if (error) throw new Error(`listUsers : ${error.message}`);
    const lot = data?.users ?? [];
    tous.push(...lot);
    if (lot.length < parPage) break;
  }
  return tous;
};

/**
 * @param {{ utilisateursAuth: {id: string, email?: string, created_at?: string}[], prisma: any }} p
 */
export const reconcilierComptes = async ({ utilisateursAuth, prisma }) => {
  const idsAuth = new Set(utilisateursAuth.map((u) => u.id));
  const profils = await prisma.profile.findMany({ select: { id: true, email: true, status: true, createdAt: true } });
  const idsProfils = new Set(profils.map((p) => p.id));
  const compensations = await prisma.auditLog.findMany({
    where: { action: 'auth.register.compensation_failed' },
    select: { resourceId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return {
    genereLe: new Date().toISOString(),
    totaux: { utilisateursAuth: idsAuth.size, profils: idsProfils.size },
    orphelinsAuth: utilisateursAuth
      .filter((u) => !idsProfils.has(u.id))
      .map((u) => ({ id: u.id, email: u.email ?? null, creeLe: u.created_at ?? null })),
    orphelinsApplicatifs: profils
      .filter((p) => !idsAuth.has(p.id) && p.status !== 'DELETED')
      .map((p) => ({ id: p.id, email: p.email, statut: p.status, creeLe: p.createdAt })),
    compensationsEchouees: compensations.map((c) => ({
      id: c.resourceId,
      le: c.createdAt,
      toujoursOrphelin: idsAuth.has(c.resourceId) && !idsProfils.has(c.resourceId),
    })),
  };
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { supabaseAdmin } = await import('../src/config/supabase.js');
  const { prisma } = await import('../src/config/prisma.js');
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY absente : réconciliation impossible');
  const utilisateursAuth = await listerTousLesUtilisateursAuth(supabaseAdmin);
  process.stdout.write(`${JSON.stringify(await reconcilierComptes({ utilisateursAuth, prisma }), null, 2)}\n`);
  await prisma.$disconnect();
}
