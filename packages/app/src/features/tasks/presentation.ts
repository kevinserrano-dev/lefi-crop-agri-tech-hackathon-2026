import type { TaskPriority, TaskStatus } from '@lefi/api';
import type { Tone } from '@lefi/ui';

export const PRIORITY: Record<TaskPriority, { tone: Tone; label: string }> = {
  critical: { tone: 'crit', label: 'Critical' },
  high: { tone: 'warn', label: 'High' },
  normal: { tone: 'info', label: 'Normal' },
};

export const STATUS_TONE: Record<TaskStatus, Tone> = {
  Open: 'off',
  'In progress': 'info',
  'Awaiting verification': 'warn',
  Verified: 'ok',
};
