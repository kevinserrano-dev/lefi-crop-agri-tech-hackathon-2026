import type { Tone } from '@lefi/ui';
import type { ReviewHealth, ReviewMeasurement } from '@lefi/api';

export const REVIEW_HEALTH: Record<ReviewHealth, { label: string; tone: Tone; hint: string }> = {
  good: {
    label: 'Good',
    tone: 'ok',
    hint: 'Every measured value in its optimal range, nothing seen',
  },
  watch: { label: 'Watch', tone: 'warn', hint: 'Small deviations or missing information' },
  attention: {
    label: 'Needs attention',
    tone: 'warn',
    hint: 'A value beyond its alert limit, a finding to confirm or a recorded problem',
  },
  critical: {
    label: 'Critical',
    tone: 'crit',
    hint: 'A value in its critical band or a critical alert',
  },
  unknown: { label: 'Unknown', tone: 'off', hint: 'Nothing to judge from yet' },
};

export const BAND: Record<ReviewMeasurement['band'], { label: string; tone: Tone }> = {
  optimal: { label: 'Optimal', tone: 'ok' },
  acceptable: { label: 'Outside optimal', tone: 'warn' },
  warning: { label: 'Out of range', tone: 'warn' },
  critical: { label: 'Critical', tone: 'crit' },
  no_data: { label: 'No fresh value', tone: 'off' },
};

export const POINT_TONE: Record<string, Tone> = {
  good: 'ok',
  info: 'info',
  watch: 'warn',
  attention: 'warn',
  critical: 'crit',
};

export const TRIGGER: Record<string, string> = {
  person: 'asked by',
  schedule: 'regular review',
  photo: 'after a new photo',
};

export function rangeText(m: ReviewMeasurement): string {
  const [lo, hi] = m.optimal;
  const u = m.unit;
  if (lo != null && hi != null) return `${lo}–${hi} ${u}`;
  if (lo != null) return `≥ ${lo} ${u}`;
  if (hi != null) return `≤ ${hi} ${u}`;
  return '—';
}
