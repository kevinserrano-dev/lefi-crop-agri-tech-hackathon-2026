import type { Tone } from '@lefi/ui';

/** Directory status colours (design). Unknown statuses fall back to neutral. */
const STATUS: Record<string, Tone> = {
  'On shift': 'ok',
  'On break': 'info',
  'Off shift': 'off',
  PTO: 'warn',
  Invited: 'info',
  'Deactivation pending': 'crit',
};
export const statusTone = (s: string): Tone => STATUS[s] ?? 'off';

export const zonesLabel = (zones: string[]) =>
  zones.includes('All') ? 'All zones' : zones.join(', ');

/** Shift cell colours (design SHC). */
export const SHIFT_TONE: Record<string, Tone> = { D: 'ok', E: 'info', O: 'off', P: 'warn' };
