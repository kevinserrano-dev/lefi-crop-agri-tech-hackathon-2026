import type { Tone } from '@lefi/ui';

/** Mission state colours (design MST). */
const STATE_TONE: Record<string, Tone> = {
  Requested: 'info',
  Queued: 'info',
  Dispatched: 'info',
  Navigating: 'ok',
  'At destination': 'ok',
  Inspecting: 'sim',
  Returning: 'info',
  Paused: 'warn',
  Completed: 'ok',
  Cancelled: 'off',
  Failed: 'crit',
};
export const stateTone = (s: string): Tone => STATE_TONE[s] ?? 'off';

export const WORKFLOW = [
  'AI creates plant health alert',
  'Physical inspection needed?',
  'Robotic inspection request',
  'Policy engine check',
  'Robot receives target',
  'Autonomous navigation',
  'Arrives at destination',
  'Photos + live stream',
  'AI analyses evidence',
  'Supervisor receives findings',
  'Incident updated · next action',
  'Return per mission policy',
];

export const elapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
