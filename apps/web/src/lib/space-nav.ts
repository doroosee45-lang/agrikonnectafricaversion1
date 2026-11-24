import { tr } from '@/i18n';

export interface LienEspace {
  to: string;
  label: string;
  icone?: string;
  badge?: string | number;
  children?: LienEspace[];
}

export interface GroupeEspace {
  titre: string;
  items: LienEspace[];
}

export interface CtaEspace {
  label: string;
  to: string;
}

export interface EspaceDef {
  id: string;
  titre: string;
  cta?: CtaEspace;
  groupes: GroupeEspace[];
}

export const ESPACES: EspaceDef[] = [
  {
    id: 'admin',
    get titre() { return tr('ui.administration'); },
    cta: { get label() { return tr('ui.gererLesComptes'); }, to: '/admin/users' },
    groupes: [
      {
        get titre() { return tr('ui.menuPrincipal'); },
        items: [
          { to: '/admin/dashboard', get label() { return tr('ui.tableauDeBord'); }, icone: 'graphe' },
          {
            to: '/admin/farms',
            get label() { return tr('ui.reseauAgricole'); },
            icone: 'feuille',
            children: [
              { to: '/admin/farms', get label() { return tr('ui.exploitations'); } },
              { to: '/admin/plots', get label() { return tr('ui.parcelles'); } },
              { to: '/admin/productions', get label() { return tr('ui.productions'); } },
              { to: '/admin/farmers', get label() { return tr('ui.agriculteurs'); } },
              { to: '/admin/producers', get label() { return tr('ui.organisations'); } },
              { to: '/admin/cooperatives', get label() { return tr('ui.cooperatives'); } },
              { to: '/admin/crops', get label() { return tr('ui.cultures'); } },
            ],
          },
        ],
      },
      {
        get titre() { return tr('ui.gouvernanceSecurite'); },
        items: [
          {
            to: '/admin/users',
            get label() { return tr('ui.comptesRoles'); },
            icone: 'utilisateurs',
            children: [
              { to: '/admin/users', get label() { return tr('ui.tousLesUtilisateurs'); } },
              { to: '/admin/roles', get label() { return tr('ui.matriceDesRoles_bd794'); } },
              { to: '/admin/verifications', get label() { return tr('ui.fileDeVerification'); } },
              { to: '/admin/reports', get label() { return tr('ui.signalements'); } },
            ],
          },
          {
            to: '/admin/security',
            get label() { return tr('ui.securiteAudit'); },
            icone: 'clef',
            children: [
              { to: '/admin/security', get label() { return tr('ui.politiqueDeSecurite'); } },
              { to: '/admin/audit', get label() { return tr('ui.journalDAudit_52309'); } },
              { to: '/admin/compliance', get label() { return tr('ui.conformitePays'); } },
            ],
          },
          { to: '/admin/notifications', get label() { return tr('ui.diffusionsAlertes'); }, icone: 'cloche' },
          { to: '/admin/settings', get label() { return tr('ui.parametresSysteme'); }, icone: 'reglages' },
        ],
      },
    ],
  },
  {
    id: 'farmer',
    get titre() { return tr('ui.monExploitation'); },
    cta: { get label() { return tr('ui.nouvelleParcelle'); }, to: '/farmer/plots/create' },
    groupes: [
      {
        get titre() { return tr('ui.menuPrincipal'); },
        items: [
          { to: '/farmer', get label() { return tr('ui.tableauDeBord'); }, icone: 'graphe' },
          {
            to: '/farmer/farms',
            get label() { return tr('ui.parcellaireRecoltes'); },
            icone: 'feuille',
            children: [
              { to: '/farmer/farms', get label() { return tr('ui.mesExploitations'); } },
              { to: '/farmer/plots', get label() { return tr('ui.mesParcelles'); } },
              { to: '/farmer/productions', get label() { return tr('ui.productionsDeclarees'); } },
              { to: '/farmer/soil', get label() { return tr('ui.analysesDeSol'); } },
            ],
          },
        ],
      },
      {
        get titre() { return tr('ui.compteConformite'); },
        items: [
          { to: '/app/messages', get label() { return 'Messages'; }, icone: 'message' },
          { to: '/farmer/profile', get label() { return tr('ui.monProfil'); }, icone: 'personne' },
          { to: '/farmer/public-profile', get label() { return tr('ui.fichePublique'); }, icone: 'globe' },
          { to: '/farmer/verification', get label() { return tr('ui.verificationKyc'); }, icone: 'verification' },
          { to: '/farmer/settings', get label() { return tr('ui.parametres_ef8f0'); }, icone: 'reglages' },
        ],
      },
    ],
  },
  {
    id: 'organization',
    get titre() { return tr('ui.monOrganisation'); },
    cta: { get label() { return tr('ui.inviterUnMembre'); }, to: '/organization/invitations' },
    groupes: [
      {
        get titre() { return tr('ui.menuPrincipal'); },
        items: [
          { to: '/organization', get label() { return tr('ui.tableauDeBord'); }, icone: 'graphe' },
          { to: '/organization/overview', get label() { return tr('ui.agregatsConsolides'); }, icone: 'couches' },
          {
            to: '/organization/members',
            get label() { return tr('ui.gestionDesMembres'); },
            icone: 'utilisateurs',
            children: [
              { to: '/organization/members', get label() { return tr('ui.repertoireMembres'); } },
              { to: '/organization/invitations', get label() { return tr('ui.invitationsEnCours'); } },
              { to: '/organization/import', get label() { return tr('ui.importCsvLot'); } },
            ],
          },
          { to: '/organization/farms', get label() { return tr('ui.reseauProduction'); }, icone: 'feuille' },
          { to: '/organization/production', get label() { return tr('ui.productionsDeclarees'); }, icone: 'graphe' },
        ],
      },
      {
        get titre() { return tr('ui.compteConformite'); },
        items: [
          { to: '/app/messages', get label() { return 'Messages'; }, icone: 'message' },
          { to: '/organization/profile', get label() { return tr('ui.monProfil'); }, icone: 'personne' },
          { to: '/organization/verification', get label() { return tr('ui.verificationKyc'); }, icone: 'verification' },
          { to: '/organization/settings', get label() { return tr('ui.parametres_ef8f0'); }, icone: 'reglages' },
        ],
      },
    ],
  },
  {
    id: 'app',
    get titre() { return tr('ui.monProfil'); },
    groupes: [
      {
        get titre() { return tr('ui.menuPrincipal'); },
        items: [
          { to: '/app', get label() { return tr('ui.tableauDeBord'); }, icone: 'graphe' },
          { to: '/app/profile', get label() { return tr('ui.monProfil'); }, icone: 'personne' },
          { to: '/app/messages', get label() { return 'Messages'; }, icone: 'message' },
          { to: '/app/notifications', get label() { return tr('ui.notifications'); }, icone: 'cloche' },
        ],
      },
    ],
  },
];

export function resolveEspace(pathname: string): EspaceDef | null {
  if (pathname.startsWith('/admin')) return ESPACES.find((e) => e.id === 'admin') ?? null;
  if (pathname.startsWith('/farmer')) return ESPACES.find((e) => e.id === 'farmer') ?? null;
  if (pathname.startsWith('/organization')) return ESPACES.find((e) => e.id === 'organization') ?? null;
  if (pathname.startsWith('/app') || pathname.startsWith('/notifications')) {
    return ESPACES.find((e) => e.id === 'app') ?? null;
  }
  return null;
}
