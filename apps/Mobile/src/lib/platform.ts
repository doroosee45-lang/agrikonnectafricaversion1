import type { Ionicons } from '@expo/vector-icons';
import { tr } from '@/i18n';

/**
 * Catalogue des services de la plateforme.
 *
 * V1 : seuls les modules dont l'écran existe sont listés (cartographie, sol,
 * projets). Traçabilité, prix, météo, marché, transport et appels d'offres
 * (V2-V5) ont été retirés avec leurs écrans : leurs liens menaient à une page
 * introuvable.
 *
 * Source : le périmètre fonctionnel du cahier des charges (V1 → V5) et le
 * routage réel du backend. `requiresAuth` reflète la présence du middleware
 * `authenticate` sur la route correspondante — ce n'est pas une intention,
 * c'est l'état du serveur.
 */
export interface PlatformService {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  detail: string;
  href: string;
  requiresAuth: boolean;
  tone: 'forest' | 'gold' | 'living' | 'info';
  /** Exigences du cahier des charges couvertes par le service. */
  cdc: string[];
}

export const PLATFORM_SERVICES: PlatformService[] = [
  {
    id: 'mapping',
    icon: 'map-outline',
    get title() { return tr('ui.cartographieDesParcelles'); },
    get body() { return tr('ui.delimitationSurfaceEtHistoriqueCultural'); },
    get detail() { return tr('ui.lesParcellesSontCreeesParPoint'); },
    href: '/explore',
    requiresAuth: false,
    tone: 'living',
    cdc: ['MAP-01', 'MAP-02', 'MAP-03', 'MAP-04'],
  },
  {
    id: 'soil',
    icon: 'flask-outline',
    get title() { return tr('ui.diagnosticDeSol'); },
    get body() { return tr('ui.fusionPondereeDesAnalysesCapteursEt'); },
    get detail() { return tr('ui.leMoteurGeospatialPondereChaqueSource'); },
    href: '/farmer/soil',
    requiresAuth: true,
    tone: 'gold',
    cdc: ['SOIL-01', 'SOIL-15', 'SOIL-16', 'AI-10'],
  },
  {
    id: 'invest',
    icon: 'trending-up-outline',
    get title() { return tr('ui.investissementProjets'); },
    get body() { return tr('ui.dossiersDataroomDueDiligenceReporting'); },
    get detail() { return tr('ui.lesDossiersDeProjetSuiventUn'); },
    href: '/projets',
    requiresAuth: true,
    tone: 'living',
    cdc: ['INV-01', 'DDR-01', 'RPT-01'],
  },
];

/** Rôles ouvrables en libre-service (les rôles de gouvernance sont attribués). */
export const SELF_SERVICE_ROLES = [
  { id: 'FARMER', get label() { return tr('ui.producteur'); } },
  { id: 'COOPERATIVE_ADMIN', get label() { return tr('ui.cooperative'); } },
  { id: 'AGRICULTURAL_COMPANY', get label() { return tr('ui.societeAgricole'); } },
  { id: 'BUYER', get label() { return tr('ui.acheteur'); } },
  { id: 'SUPPLIER', get label() { return tr('ui.fournisseur'); } },
  { id: 'TRANSPORTER', get label() { return tr('ui.transporteur'); } },
  { id: 'INVESTOR', get label() { return tr('ui.investisseur'); } },
  // Agronome et agent d'appui : attribués par un administrateur (audit H-01).
] as const;

/** Calendrier fonctionnel V1 → V5 (périmètre livré). */
export const RELEASE_TRACK = [
  {
    tag: 'V1',
    name: 'FARM',
    get body() { return tr('ui.inscriptionDesProducteursExploitationsParcellesG'); },
  },
  {
    tag: 'V2',
    name: 'MARKET',
    get body() { return tr('ui.annoncesEtDemandesDAchatOffres'); },
  },
  {
    tag: 'V3',
    name: 'INTELLIGENCE',
    get body() { return tr('ui.prixDeMarcheSourcesMeteoPar_f0936'); },
  },
  {
    tag: 'V4',
    name: 'INVEST',
    get body() { return tr('ui.dossiersDeProjetDataroomAAcces'); },
  },
  {
    tag: 'V5',
    name: 'GLOBAL',
    get body() { return tr('ui.appelsDOffresInternationauxApiPublique_bde7c'); },
  },
] as const;
