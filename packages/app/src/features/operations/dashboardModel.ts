/**
 * What the Executive Dashboard derives from Lefi Brain's overview (ADR-077). Pure functions: every
 * number comes from `/overview` or `/overview/trends`; nothing is estimated or filled in.
 */
import type { Overview, OverviewTrends } from '@lefi/api';
import type { Tone } from '@lefi/ui';

export type Value = {
  variable: string;
  label: string;
  value: number | null;
  unit: string | null;
  received_at: string | null;
  range: { min: number | null; max: number | null; rule: string } | null;
  in_range: boolean | null;
};

/** The generated type keeps values as free dicts; read them with their documented keys. */
export const valuesOf = (r: Overview['readings'][number]): Value[] =>
  r.values.map((v) => ({
    variable: String(v.variable),
    label: String(v.label ?? v.variable),
    value: typeof v.value === 'number' ? v.value : null,
    unit: v.unit == null ? null : String(v.unit),
    received_at: v.received_at == null ? null : String(v.received_at),
    range: (v.range as Value['range']) ?? null,
    in_range: typeof v.in_range === 'boolean' ? v.in_range : null,
  }));

export interface SiteStatus {
  word: 'Normal' | 'Attention' | 'Critical' | 'No sensors';
  tone: Tone;
  enabled: number;
  receiving: number;
  /** Share of enabled sensors receiving data, 0..1 (null: none enabled). */
  coverage: number | null;
  outOfRange: number;
}

/** Greenhouse status: from active alerts, sensors receiving and values outside people's ranges. */
export function siteStatus(o: Overview): SiteStatus {
  const enabled = Object.values(o.devices.sensors).reduce((a, b) => a + b, 0);
  const receiving = o.devices.sensors.receiving ?? 0;
  const outOfRange = o.readings.flatMap(valuesOf).filter((v) => v.in_range === false).length;
  const base = { enabled, receiving, coverage: enabled ? receiving / enabled : null, outOfRange };
  if (o.alerts.critical > 0) return { ...base, word: 'Critical', tone: 'crit' };
  if (o.alerts.active > 0 || outOfRange > 0 || receiving < enabled)
    return { ...base, word: 'Attention', tone: 'warn' };
  if (enabled === 0) return { ...base, word: 'No sensors', tone: 'off' };
  return { ...base, word: 'Normal', tone: 'ok' };
}

/** Active zones by their worst active alert. */
export function zoneConditions(o: Overview) {
  const active = o.zones.filter((z) => z.status === 'active');
  const critical = active.filter((z) => z.alerts_critical > 0).length;
  const warning = active.filter((z) => !z.alerts_critical && z.alerts_warning > 0).length;
  return { active: active.length, clear: active.length - critical - warning, warning, critical };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The operational summary, written by Lefi Brain's data, not by a model: each sentence states a
 * count or a fact the overview holds. `**…**` marks bold (RichText).
 */
export function summaryText(o: Overview): string {
  const s = siteStatus(o);
  const out: string[] = [];
  const a = o.alerts;
  if (a.active === 0) out.push('No active alerts.');
  else {
    const first = a.latest[0];
    out.push(
      `**${plural(a.active, 'active alert')}**${a.critical ? `, ${a.critical} critical` : ''}` +
        (first ? `; latest: **${String(first.title)}**.` : '.'),
    );
  }
  if (s.enabled === 0) out.push('No sensor is enabled yet.');
  else
    out.push(
      `**${s.receiving} of ${s.enabled}** sensors are receiving data` +
        (s.outOfRange ? `; ${plural(s.outOfRange, 'value')} outside the range people set.` : '.'),
    );
  const h = o.plant_health;
  const p = o.places;
  out.push(
    `${plural(p.plants, 'plant')}, ${p.crop_plants} of them in ${plural(p.active_crops, 'crop batch', 'crop batches')}` +
      (h.plants
        ? `; people recorded ${h.problem} with problems, ${h.watch} to watch and ${h.not_checked} not checked yet.`
        : '.'),
  );
  if (h.open_requests) out.push(`${plural(h.open_requests, 'inspection')} asked.`);
  return out.join(' ');
}

/** Five evenly spaced axis labels for `count` buckets of `step_s` from `since`. */
export function timeTicks(since: string, stepS: number, count: number, fmt: (d: Date) => string) {
  const t0 = new Date(since).getTime();
  return [0, 0.25, 0.5, 0.75, 1].map((f) =>
    fmt(new Date(t0 + Math.round(f * count) * stepS * 1000)),
  );
}

/** Chart scale around real values, with a little margin; null when there is nothing to draw. */
export function scaleOf(values: Array<number | null>): { min: number; max: number } | null {
  const v = values.filter((x): x is number => x !== null);
  if (v.length === 0) return null;
  let lo = Math.min(...v);
  let hi = Math.max(...v);
  if (hi - lo < 1) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.15;
  return { min: Math.floor(lo - pad), max: Math.ceil(hi + pad) };
}

/** Four axis labels from top to bottom. */
export const axisLabels = (s: { min: number; max: number }, suffix = '') =>
  [0, 1, 2, 3].map((i) => `${Math.round(s.max - ((s.max - s.min) * i) / 3)}${suffix}`);

/** The two environment series the design shows: air temperature and humidity when measured. */
export function environmentPair(t: OverviewTrends) {
  const by = new Map(t.environment.map((e) => [e.variable, e]));
  const preferred = ['air_temperature', 'air_humidity']
    .map((v) => by.get(v))
    .filter((e) => e !== undefined);
  const rest = t.environment.filter((e) => !preferred.includes(e));
  return [...preferred, ...rest].slice(0, 2);
}

/** Share of checked plants recorded healthy each day, in percent (NaN: none checked = a gap). */
export function healthyShare(h: OverviewTrends['plant_health']) {
  return h.healthy.map((ok, i) => {
    const checked = ok + (h.watch[i] ?? 0) + (h.problem[i] ?? 0);
    return checked ? (ok / checked) * 100 : Number.NaN;
  });
}
