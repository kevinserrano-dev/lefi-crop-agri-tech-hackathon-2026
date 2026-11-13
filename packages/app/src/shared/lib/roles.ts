/** Avatar colours per role id (design). Unknown roles fall back to the brand green. */
const ROLE_COLORS: Record<string, string> = {
  admin: '#163D32',
  manager: '#2E6B57',
  grower: '#3F8F5E',
  supervisor: '#7A4A22',
  scout: '#3C7EA6',
  maint: '#8A6D1E',
  worker: '#5E6B65',
};

export const roleColor = (roleId: string | undefined) =>
  (roleId && ROLE_COLORS[roleId]) || '#163D32';
