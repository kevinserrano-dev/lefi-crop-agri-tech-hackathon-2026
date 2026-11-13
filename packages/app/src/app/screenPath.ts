/** Screen id → route path. Kept apart from screens.ts so features can link without import cycles. */
const SPECIAL: Record<string, `/${string}`> = {
  dashboard: '/',
  plantHealth: '/plant-health',
  aiControl: '/ai-control',
};

export const screenPath = (id: string): `/${string}` => SPECIAL[id] ?? `/${id}`;
