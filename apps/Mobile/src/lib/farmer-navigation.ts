const PRODUCER_ROLES = ['FARMER', 'COOPERATIVE_ADMIN', 'COOPERATIVE_MEMBER', 'AGRICULTURAL_COMPANY', 'SUPPORT_AGENT'];

const PERMISSIONS: Record<string, string> = {
  '/farmer/farms': 'farms.read',
  '/farmer/plots': 'plots.read',
  '/farmer/productions': 'productions.read',
  '/farmer/soil': 'soil.read',
  '/farmer/lots': 'lots.read',
  '/farmer/export': 'export.read',
  '/farmer/projects': 'projects.read',
  '/farmer/certifications': 'certifications.read',
  '/farmer/devices': 'iot.read',
  '/farmer/alerts': 'alerts.read',
  '/farmer/sync': 'sync.write',
  '/farmer/sync/conflicts': 'sync.write',
  '/farmer/verification': 'verifications.read',
};

export function canShowFarmerNavigation(route: string, roles: readonly string[], permissions: readonly string[]): boolean {
  if (!roles.some((role) => PRODUCER_ROLES.includes(role))) return false;
  const permission = PERMISSIONS[route];
  return !permission || permissions.includes(permission) || permissions.includes('*');
}
