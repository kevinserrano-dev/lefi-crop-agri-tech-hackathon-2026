import type { AlertSeverity } from '@lefi/api';
import type { Tone } from '@lefi/ui';

export const SEVERITY: Record<AlertSeverity, { label: string; tone: Tone }> = {
  critical: { label: 'Critical', tone: 'crit' },
  warning: { label: 'Warning', tone: 'warn' },
  info: { label: 'Info', tone: 'info' },
};

export const STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'crit' },
  acknowledged: { label: 'Acknowledged', tone: 'info' },
  resolved: { label: 'Resolved', tone: 'ok' },
};

export const EVENT: Record<string, string> = {
  opened: 'Raised',
  reopened: 'Came back (reopened)',
  repeated: 'Happened again',
  escalated: 'Became more severe',
  acknowledged: 'Acknowledged',
  assigned: 'Assigned',
  note: 'Note',
  cleared: 'Cleared: the condition went away',
  resolved: 'Resolved',
};

/** What the rules engine is doing, as people should read it. */
export const MONITOR: Record<string, { tone: Tone; title: string }> = {
  starting: { tone: 'info', title: 'Lefi Brain is starting its checks' },
  grace: { tone: 'info', title: 'Waiting for devices to report' },
  watching: { tone: 'ok', title: 'Watching devices, sensors and value rules' },
  no_ingestion: { tone: 'warn', title: 'No device data can arrive' },
  ingestion_down: { tone: 'crit', title: 'Lefi Brain is not receiving device data' },
};

export const forLabel = (s: number) =>
  s % 3600 === 0 ? `${s / 3600} h` : s % 60 === 0 ? `${s / 60} min` : `${s} s`;

/** Who raised an alert, as a short tag. */
export const SOURCE: Record<'rule' | 'ai' | 'person', { label: string; icon: string }> = {
  rule: { label: 'Rule', icon: 'rule' },
  ai: { label: 'Lefi AI · to confirm', icon: 'auto_awesome' },
  person: { label: 'Reported', icon: 'person' },
};

/** An icon for what the alert is about. */
export const kindIcon = (rule: string, source: string): string => {
  if (source === 'person') return 'report';
  if (rule.startsWith('ai.vision:')) return 'psychiatry';
  if (rule.endsWith(':change')) return 'trending_up';
  if (rule.startsWith('crop:') || rule.startsWith('value:')) return 'thermostat';
  if (rule.startsWith('device.')) return 'wifi_off';
  if (rule.startsWith('sensor.')) return 'sensors_off';
  if (rule.startsWith('ingestion')) return 'cloud_off';
  return 'warning';
};

export const EVENT_ICON: Record<string, string> = {
  opened: 'notifications_active',
  reopened: 'replay',
  repeated: 'repeat',
  escalated: 'priority_high',
  acknowledged: 'done',
  assigned: 'person_add',
  note: 'edit_note',
  cleared: 'check_circle',
  resolved: 'task_alt',
};
