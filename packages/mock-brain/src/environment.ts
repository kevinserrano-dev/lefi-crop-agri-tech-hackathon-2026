/**
 * Mock environment data: zone readings, history and the (placeholder) operating ranges.
 * FAKE prototype values, `origin: SIMULATED`. pH outside GH-3 is a model estimate in the
 * prototype (no probe installed) and is reported as `source: estimate`.
 */
import { METRICS, ZONES, series } from './design-data.ts';
import { MockError } from './incidents.ts';

type Key = (typeof METRICS)[number]['k'];
export const ranges: Record<Key, [number, number]> = Object.fromEntries(
  METRICS.map((m) => [m.k, [...m.range]]),
) as Record<Key, [number, number]>;
const PROFILE = {
  id: 'mock-baby-lettuce',
  name: 'Baby lettuce · standard (placeholder)',
  is_placeholder: true,
};

const sourceOf = (zoneId: string, k: Key): 'sensor' | 'estimate' | 'none' => {
  const z = ZONES.find((x) => x.id === zoneId);
  if (k === 'ph' && z && z.gh !== 'GH-3') return 'estimate';
  if (zoneId === 'GH2-Z3' && k === 'moist') return 'none';
  return 'sensor';
};

function status(v: number | null, k: Key) {
  if (v === null) return 'UNKNOWN';
  const [lo, hi] = ranges[k];
  const dev = v < lo ? lo - v : v > hi ? v - hi : 0;
  const p = dev / (hi - lo);
  return p === 0 ? 'HEALTHY' : p <= 0.25 ? 'WARNING' : 'CRITICAL';
}

const deviceId = (zoneId: string, k: Key) => {
  const pre = { temp: 'TH', rh: 'TH', ppfd: 'PAR', moist: 'SM', ph: 'PH', ec: 'EC' }[k];
  return `${pre}-${zoneId}-0${zoneId === 'GH2-Z3' && k === 'moist' ? 2 : 1}`;
};

function vals(zoneId: string, mi: number, n: number, seedBase: number, v: number) {
  const m = METRICS[mi]!;
  const ser = series(n, 0, m.amp, m.noise, seedBase * 31 + mi * 7 + zoneId.length * 3, 1, mi);
  const last = ser[ser.length - 1] ?? 0;
  return ser.map((x) => {
    const y = x - last + v;
    return m.k === 'ppfd' ? Math.max(0, y) : y;
  });
}

const zone = (id: string) => {
  const z = ZONES.find((x) => x.id === id);
  if (!z) throw new MockError(404, 'not_found', `Zone ${id} not found.`);
  return z;
};

const ago = (now: Date, minutes: number) =>
  new Date(now.getTime() - minutes * 60_000).toISOString();

export function zoneReadings(zoneId: string, now: Date) {
  const z = ZONES.find((x) => x.id === zoneId);
  if (!z) return null;
  return METRICS.map((m, mi) => {
    const v = z[m.k] as number | null;
    const src = sourceOf(zoneId, m.k);
    return {
      sensor_id: deviceId(zoneId, m.k),
      variable: m.k,
      label: m.label,
      unit: m.unit,
      value: v,
      decimals: m.dec,
      origin: 'SIMULATED',
      source: src,
      freshness: v === null ? 'OFFLINE' : 'LIVE',
      received_at: v === null ? ago(now, 210) : src === 'estimate' ? ago(now, 2) : ago(now, 0.2),
      status: status(v, m.k),
      range: { min: ranges[m.k][0], max: ranges[m.k][1], is_placeholder: true },
      history: v === null ? [] : vals(zoneId, mi, 24, 2, v),
    };
  });
}

const POINTS = { '24h': 48, '7d': 84, '30d': 60 } as const;
const SEED = { '24h': 7, '7d': 8, '30d': 9 } as const;
const SPAN_MS = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 } as const;

export function history(now: Date, zoneId: string, q: URLSearchParams) {
  const z = zone(zoneId);
  const k = (q.get('variable') ?? 'temp') as Key;
  const mi = METRICS.findIndex((m) => m.k === k);
  if (mi < 0) throw new MockError(422, 'invalid_variable', `Unknown variable ${k}.`);
  const range = (['24h', '7d', '30d'] as const).find((r) => r === q.get('range')) ?? '24h';
  const m = METRICS[mi]!;
  const v = z[m.k] as number | null;
  const src = sourceOf(zoneId, m.k);
  const base = {
    zone_id: z.id,
    variable: m.k,
    label: m.label,
    unit: m.unit,
    decimals: m.dec,
    range: { min: ranges[m.k][0], max: ranges[m.k][1], is_placeholder: true },
    source: src,
    origin: 'SIMULATED',
  };
  if (v === null) {
    return {
      ...base,
      labels: [],
      values: [],
      stats: null,
      freshness: 'OFFLINE',
      unavailable_note: `${deviceId(zoneId, m.k)} stopped reporting ${new Date(ago(now, 210)).toTimeString().slice(0, 5)}. Replacement task T-1182 is assigned to Luis Ortega.`,
    };
  }
  const n = POINTS[range];
  const values = vals(zoneId, mi, n, SEED[range], v);
  const labels = values.map((_, i) =>
    new Date(now.getTime() - SPAN_MS[range] + (i / (n - 1)) * SPAN_MS[range]).toISOString(),
  );
  const [lo, hi] = ranges[m.k];
  const inRange = values.filter((x) => x >= lo && x <= hi).length;
  return {
    ...base,
    labels,
    values,
    freshness: 'LIVE',
    unavailable_note: null,
    stats: {
      current: v,
      average: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      time_in_range_pct: Math.round((inRange / values.length) * 100),
    },
  };
}

interface Actor {
  name: string;
  permissions: string[];
}

export function operatingRanges(a: Actor) {
  const allowed = a.permissions.includes('env.configure');
  return {
    profile: PROFILE,
    rows: METRICS.map((m) => ({
      variable: m.k,
      label: m.label,
      unit: m.unit,
      min: ranges[m.k][0],
      max: ranges[m.k][1],
      step: m.dec === 0 ? 1 : m.dec === 1 ? 0.1 : 0.05,
    })),
    can_edit: allowed
      ? { allowed: true, reason: null }
      : { allowed: false, reason: 'Requires permission: Configure operating ranges' },
  };
}

export function saveRanges(
  a: Actor,
  body: { rows?: Array<{ variable: string; min: number; max: number }> },
) {
  if (!a.permissions.includes('env.configure'))
    throw new MockError(403, 'forbidden', 'Requires permission: Configure operating ranges');
  const rows = body.rows ?? [];
  for (const r of rows) {
    const m = METRICS.find((x) => x.k === r.variable);
    if (!m) throw new MockError(422, 'invalid_variable', `Unknown variable ${r.variable}.`);
    if (!(Number.isFinite(r.min) && Number.isFinite(r.max) && r.min < r.max)) {
      throw new MockError(
        422,
        'invalid_range',
        `Minimum must be lower than maximum for ${m.label}.`,
      );
    }
  }
  const changes = rows
    .filter((r) => ranges[r.variable as Key][0] !== r.min || ranges[r.variable as Key][1] !== r.max)
    .map((r) => {
      const before = ranges[r.variable as Key].join('–');
      ranges[r.variable as Key] = [r.min, r.max];
      return `${r.variable} ${before} → ${r.min}–${r.max}`;
    });
  return {
    item: operatingRanges(a),
    message: changes.length
      ? `Operating ranges saved and applied to all zones (${changes.length} changed). Recorded in the audit trail; still a placeholder profile until an agronomist confirms it.`
      : 'No changes.',
  };
}
