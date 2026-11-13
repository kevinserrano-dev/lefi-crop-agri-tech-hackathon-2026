/** Presentation-only mappings for detections (labels, colours, icons). */
import type { DetectionStatus } from '@lefi/api';

export const STATUS: Record<
  DetectionStatus,
  { label: string; icon: string; bg: string; fg: string }
> = {
  unconfirmed: {
    label: 'AI prediction · not confirmed',
    icon: 'psychiatry',
    bg: 'var(--lefi-warn-bg)',
    fg: 'var(--lefi-warn-fg)',
  },
  inspection: {
    label: 'Human inspection requested',
    icon: 'person_search',
    bg: 'var(--lefi-info-bg)',
    fg: 'var(--lefi-info-fg)',
  },
  confirmed: {
    label: 'Confirmed diagnosis',
    icon: 'verified',
    bg: 'var(--lefi-forest-800)',
    fg: '#fff',
  },
  rejected: {
    label: 'Rejected by reviewer',
    icon: 'block',
    bg: 'var(--lefi-off-bg)',
    fg: 'var(--lefi-off-fg)',
  },
};

export const LEAF_COLOUR: Record<string, string> = {
  anthocyanin: '#8E2F3F',
  healthy: '#4E9A4F',
  chlorotic: '#C9CF6A',
  necrotic: '#7A4A22',
};

export const BOX_COLOUR = { ok: '#54B985', warn: '#E0A21B', crit: '#D64545' } as const;

export function confidenceLevel(c: number) {
  return c >= 80
    ? { label: 'High', color: '#2E9A63' }
    : c >= 65
      ? { label: 'Moderate', color: '#E0A21B' }
      : { label: 'Low', color: '#D64545' };
}
