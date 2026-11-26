/**
 * MIROIR MOBILE de la barre latérale Web (apps/web/src/lib/space-nav.ts) —
 * données PURES (testées sous Node : tests/space-nav-parity.test.mts).
 *
 * Chaque espace Web (admin, farmer, organization, app) a ici les MÊMES
 * entrées, avec la route Mobile équivalente. L'espace producteur garde aussi
 * son menu dédié (FarmerHeader), aligné par le même test.
 */

export type IdEspace = 'admin' | 'farmer' | 'organization' | 'app';

export interface Libelle {
  fr: string;
  en: string;
}

export interface LienEspaceMobile {
  route: string;
  libelle: Libelle;
  icone?: string;
  enfants?: LienEspaceMobile[];
}

export interface EspaceMobile {
  id: IdEspace;
  titre: Libelle;
  groupes: Array<{ titre: Libelle; items: LienEspaceMobile[] }>;
}

/** Route Web → route Mobile quand elles diffèrent (même écran, autre chemin). */
export const EQUIVALENTS_WEB: Readonly<Record<string, string>> = {
  '/app': '/profil',
  '/app/profile': '/profil',
  '/app/messages': '/messages',
  '/app/notifications': '/notifications',
  '/organization/import': '/organization/member-import',
  '/organization/production': '/organization/production-summary',
};

const l = (fr: string, en: string): Libelle => ({ fr, en });

export const ESPACES_MOBILE: EspaceMobile[] = [
  {
    id: 'admin',
    titre: l('Administration', 'Administration'),
    groupes: [
      {
        titre: l('Menu principal', 'Main menu'),
        items: [
          { route: '/admin/dashboard', libelle: l('Tableau de bord', 'Dashboard'), icone: 'grid-outline' },
          {
            route: '/admin/farms',
            libelle: l('Réseau agricole', 'Farming network'),
            icone: 'leaf-outline',
            enfants: [
              { route: '/admin/farms', libelle: l('Exploitations', 'Farms') },
              { route: '/admin/plots', libelle: l('Parcelles', 'Plots') },
              { route: '/admin/productions', libelle: l('Productions', 'Productions') },
              { route: '/admin/farmers', libelle: l('Agriculteurs', 'Farmers') },
              { route: '/admin/producers', libelle: l('Organisations', 'Organizations') },
              { route: '/admin/cooperatives', libelle: l('Coopératives', 'Cooperatives') },
              { route: '/admin/crops', libelle: l('Cultures', 'Crops') },
            ],
          },
        ],
      },
      {
        titre: l('Gouvernance et sécurité', 'Governance & security'),
        items: [
          {
            route: '/admin/users',
            libelle: l('Comptes et rôles', 'Accounts & roles'),
            icone: 'people-outline',
            enfants: [
              { route: '/admin/users', libelle: l('Tous les utilisateurs', 'All users') },
              { route: '/admin/roles', libelle: l('Matrice des rôles', 'Role matrix') },
              { route: '/admin/verifications', libelle: l('File de vérification', 'Verification queue') },
              { route: '/admin/reports', libelle: l('Signalements', 'Reports') },
            ],
          },
          {
            route: '/admin/security',
            libelle: l('Sécurité et audit', 'Security & audit'),
            icone: 'key-outline',
            enfants: [
              { route: '/admin/security', libelle: l('Politique de sécurité', 'Security policy') },
              { route: '/admin/audit', libelle: l('Journal d’audit', 'Audit log') },
              { route: '/admin/compliance', libelle: l('Conformité pays', 'Country compliance') },
            ],
          },
          { route: '/admin/notifications', libelle: l('Diffusions et alertes', 'Broadcasts & alerts'), icone: 'notifications-outline' },
          { route: '/admin/settings', libelle: l('Paramètres système', 'System settings'), icone: 'settings-outline' },
        ],
      },
    ],
  },
  {
    id: 'farmer',
    titre: l('Mon exploitation', 'My farm'),
    groupes: [
      {
        titre: l('Menu principal', 'Main menu'),
        items: [
          { route: '/farmer', libelle: l('Tableau de bord', 'Dashboard'), icone: 'grid-outline' },
          {
            route: '/farmer/farms',
            libelle: l('Parcellaire et récoltes', 'Plots & harvests'),
            icone: 'leaf-outline',
            enfants: [
              { route: '/farmer/farms', libelle: l('Mes exploitations', 'My farms') },
              { route: '/farmer/plots', libelle: l('Mes parcelles', 'My plots') },
              { route: '/farmer/productions', libelle: l('Productions déclarées', 'Declared productions') },
              { route: '/farmer/soil', libelle: l('Analyses de sol', 'Soil analyses') },
            ],
          },
          { route: '/farmer/plots/create', libelle: l('Nouvelle parcelle', 'New plot'), icone: 'add-circle-outline' },
        ],
      },
      {
        titre: l('Compte et conformité', 'Account & compliance'),
        items: [
          { route: '/messages', libelle: l('Messages', 'Messages'), icone: 'chatbubbles-outline' },
          { route: '/farmer/profile', libelle: l('Mon profil', 'My profile'), icone: 'person-outline' },
          { route: '/farmer/public-profile', libelle: l('Fiche publique', 'Public profile'), icone: 'globe-outline' },
          { route: '/farmer/verification', libelle: l('Vérification KYC', 'KYC verification'), icone: 'shield-checkmark-outline' },
          { route: '/farmer/settings', libelle: l('Paramètres', 'Settings'), icone: 'settings-outline' },
        ],
      },
    ],
  },
  {
    id: 'organization',
    titre: l('Mon organisation', 'My organization'),
    groupes: [
      {
        titre: l('Menu principal', 'Main menu'),
        items: [
          { route: '/organization', libelle: l('Tableau de bord', 'Dashboard'), icone: 'grid-outline' },
          { route: '/organization/overview', libelle: l('Agrégats consolidés', 'Consolidated figures'), icone: 'layers-outline' },
          {
            route: '/organization/members',
            libelle: l('Gestion des membres', 'Members'),
            icone: 'people-outline',
            enfants: [
              { route: '/organization/members', libelle: l('Répertoire des membres', 'Member directory') },
              { route: '/organization/invitations', libelle: l('Invitations en cours', 'Pending invitations') },
              { route: '/organization/member-import', libelle: l('Import CSV en lot', 'CSV import') },
            ],
          },
          { route: '/organization/farms', libelle: l('Réseau de production', 'Production network'), icone: 'leaf-outline' },
          { route: '/organization/production-summary', libelle: l('Productions déclarées', 'Declared productions'), icone: 'stats-chart-outline' },
        ],
      },
      {
        titre: l('Compte et conformité', 'Account & compliance'),
        items: [
          { route: '/messages', libelle: l('Messages', 'Messages'), icone: 'chatbubbles-outline' },
          { route: '/organization/profile', libelle: l('Mon profil', 'My profile'), icone: 'person-outline' },
          { route: '/organization/verification', libelle: l('Vérification KYC', 'KYC verification'), icone: 'shield-checkmark-outline' },
          { route: '/organization/settings', libelle: l('Paramètres', 'Settings'), icone: 'settings-outline' },
        ],
      },
    ],
  },
  {
    id: 'app',
    titre: l('Mon espace', 'My space'),
    groupes: [
      {
        titre: l('Menu principal', 'Main menu'),
        items: [
          { route: '/profil', libelle: l('Tableau de bord et profil', 'Dashboard & profile'), icone: 'grid-outline' },
          { route: '/messages', libelle: l('Messages', 'Messages'), icone: 'chatbubbles-outline' },
          { route: '/notifications', libelle: l('Notifications', 'Notifications'), icone: 'notifications-outline' },
        ],
      },
    ],
  },
];

/** Espace affiché : d'après l'écran courant (comme `resolveEspace` du Web), sinon d'après le rôle. */
export function espaceCourant(chemin: string, espaceDuRole: IdEspace): IdEspace {
  if (chemin.startsWith('/admin')) return 'admin';
  if (chemin.startsWith('/farmer')) return 'farmer';
  if (chemin.startsWith('/organization')) return 'organization';
  return espaceDuRole;
}

/** Toutes les routes d'un espace (entrées et sous-entrées). */
export const routesEspace = (espace: EspaceMobile): string[] =>
  espace.groupes.flatMap((g) => g.items.flatMap((i) => [i.route, ...(i.enfants ?? []).map((e) => e.route)]));
