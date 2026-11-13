import type { Alert } from '@lefi/api';

const BY_CATEGORY: Record<Alert['category'], string> = {
  sensor: 'bolt',
  device: 'wifi_off',
  climate: 'humidity_percentage',
  ai: 'psychiatry',
  system: 'info',
};

export const alertIcon = (a: Alert): string => BY_CATEGORY[a.category] ?? 'warning';
