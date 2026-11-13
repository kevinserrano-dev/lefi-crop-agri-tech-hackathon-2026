import type { PlantHealthState, PlantIssue } from '@lefi/api';
import type { Tone } from '@lefi/ui';

export const HEALTH: Record<PlantHealthState, { label: string; tone: Tone; hint: string }> = {
  healthy: { label: 'Healthy', tone: 'ok', hint: 'Nothing wrong seen' },
  watch: { label: 'Watch', tone: 'warn', hint: 'Something to keep an eye on' },
  problem: { label: 'Problem', tone: 'crit', hint: 'Needs action' },
};

export const ISSUE: Record<PlantIssue, string> = {
  pest: 'Pest',
  disease: 'Disease',
  nutrient: 'Nutrient',
  water: 'Water',
  environment: 'Environment',
  damage: 'Damage',
  growth: 'Growth',
  other: 'Other',
};

/** What Lefi AI's state means for a person (states come from Lefi Brain). */
export const AI_STATE: Record<string, { label: string; tone: Tone }> = {
  available: { label: 'Available', tone: 'ok' },
  disabled: { label: 'Stopped', tone: 'warn' },
  unconfigured: { label: 'Not set up', tone: 'off' },
  unreachable: { label: 'Not answering', tone: 'crit' },
  model_missing: { label: 'Model missing', tone: 'crit' },
};

