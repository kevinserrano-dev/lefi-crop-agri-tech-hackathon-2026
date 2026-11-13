export function formatValue(value: number | null, decimals?: number): string {
  if (value === null) return '—';
  const d = decimals ?? (Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2);
  return value.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 });
}

export function initials(name: string): string {
  return name
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
