/** Presentation-only mappings for devices (colours, icons, copy). No rules here. */
import type { Device, DeviceCategory, DeviceMode } from '@lefi/api';
import type { Tone } from '@lefi/ui';

const STATUS_TONE: Record<string, Tone> = {
  Online: 'ok',
  Docked: 'ok',
  Offline: 'crit',
  Simulated: 'sim',
  'Low battery': 'warn',
  Maintenance: 'warn',
  'Readings paused': 'warn',
  'Powered off': 'off',
  Planned: 'info',
  'Pending approval': 'info',
};
export const statusTone = (status: string): Tone => STATUS_TONE[status] ?? 'off';

export const CATEGORY_ICON: Record<DeviceCategory, string> = {
  sensor: 'sensors',
  camera: 'videocam',
  actuator: 'water_pump',
  robot: 'smart_toy',
  drone: 'flight',
};

export const CATEGORY_LABEL: Record<DeviceCategory, string> = {
  sensor: 'Sensor',
  camera: 'Camera',
  actuator: 'Actuator',
  robot: 'Robot',
  drone: 'Drone',
};

export const healthColor = (h: number | null) =>
  h === null
    ? '#C9D2CC'
    : h >= 80
      ? 'var(--lefi-ok-dot)'
      : h >= 60
        ? 'var(--lefi-warn-dot)'
        : 'var(--lefi-crit-dot)';

export function dueLabel(d: Device): string {
  const due = d.service.due_days;
  if (due === null) return '—';
  if (due < 0) return `Overdue ${-due} d`;
  return due === 0 ? 'Today' : `In ${due} d`;
}

export function dueColor(d: Device): string {
  const due = d.service.due_days;
  if (due === null) return 'var(--lefi-text-faint)';
  if (due < 0) return 'var(--lefi-crit-fg)';
  return due <= 14 ? 'var(--lefi-warn-fg)' : 'var(--lefi-text-strong)';
}

export const MODES: Record<
  DeviceMode,
  { label: string; sub: string; icon: string; tone: Tone; effect: string }
> = {
  on: {
    label: 'Connected',
    sub: 'Platform + AI',
    icon: 'hub',
    tone: 'ok',
    effect:
      'Readings go to dashboards, alerts and Lefi AI. AI may use this device in recommendations; nothing runs without the validator.',
  },
  ai: {
    label: 'AI isolated',
    sub: 'Platform only — AI can’t see or use it',
    icon: 'visibility_off',
    tone: 'info',
    effect:
      'Readings stay visible to crew and threshold alerts still fire, but Lefi AI can’t read, command or dispatch it. Use while a device is suspect or being validated.',
  },
  paused: {
    label: 'Readings paused',
    sub: 'Powered — no data ingested',
    icon: 'pause_circle',
    tone: 'warn',
    effect:
      'The device keeps power but the platform stops ingesting its data — no alerts, no AI. Use during calibration or probe replacement.',
  },
  off: {
    label: 'Powered off',
    sub: 'Power cut at relay / PoE port',
    icon: 'power_settings_new',
    tone: 'off',
    effect: 'Nothing is read or sent.',
  },
};
