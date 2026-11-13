/** Plain words for the audit actions Lefi Brain records; unknown ones are shown as recorded. */
const ACTIONS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'authz.denied': 'Was refused an action',
  'user.created': 'Account created',
  'user.updated': 'Name or email changed',
  'user.role_changed': 'Role changed',
  'user.disabled': 'Deactivated',
  'user.enabled': 'Reactivated',
  'user.password_reset': 'Password reset by an administrator',
  'user.password_changed': 'Changed own password',
  'user.sessions_revoked': 'Sessions ended by an administrator',
  'user.unlocked': 'Unlocked',
  'client_device.paired': 'PC paired',
  'client_device.revoked': 'PC removed',
  'brain.started': 'Lefi Brain started',
  'brain.stopped': 'Lefi Brain stopped',
  'db.migrated': 'Database updated',
};

export const actionLabel = (action: string) => ACTIONS[action] ?? action;

/** Filters of the audit trail: an action prefix (ending in ".") or an exact action. */
export const AUDIT_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Everything' },
  { value: 'user.', label: 'Users and roles' },
  { value: 'auth.', label: 'Sign-in and sign-out' },
  { value: 'authz.denied', label: 'Refused actions' },
  { value: 'client_device.', label: 'Paired PCs' },
  { value: 'field_device.', label: 'Field devices' },
  { value: 'zone.', label: 'Zones' },
  { value: 'ai.', label: 'Lefi AI' },
];
