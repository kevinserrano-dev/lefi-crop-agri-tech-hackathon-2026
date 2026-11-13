import type { IncidentStatus } from '@lefi/api';
import type { Severity, Tone } from '@lefi/ui';

export const SEVERITY: Record<Severity, { tone: Tone; label: string }> = {
  critical: { tone: 'crit', label: 'Critical' },
  warning: { tone: 'warn', label: 'Warning' },
  info: { tone: 'info', label: 'Informational' },
};

export const STATUS_TONE: Record<IncidentStatus, Tone> = {
  New: 'crit',
  Acknowledged: 'warn',
  Investigating: 'info',
  Resolved: 'ok',
  Closed: 'off',
};
