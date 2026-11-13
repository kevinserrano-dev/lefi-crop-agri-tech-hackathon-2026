/**
 * Mock Greenhouses & Crops: greenhouse → zone → crop batch → plant, from the prototype's
 * fictional operation. Health scores, heights and leaf counts are simulated (no vision model);
 * photos do not exist (`image_url: null`); dates are relative to the Brain clock.
 */
import { GREENHOUSES, ZONES } from './design-data.ts';
import { series } from './design-data.ts';
import * as det from './detections.ts';
import { ranges } from './environment.ts';
import { MockError } from './incidents.ts';
import * as auditLog from './audit.ts';
import { findPerson } from './workforce.ts';

interface Actor {
  name: string;
  permissions: string[];
}
const can = (a: Actor, p: string) => a.permissions.includes(p);
const OK = { allowed: true, reason: null as string | null };
const no = (reason: string) => ({ allowed: false, reason });
type Tone = 'ok' | 'warn' | 'crit';
const tone = (h: number): Tone => (h >= 85 ? 'ok' : h >= 70 ? 'warn' : 'crit');
const toneLabel = { ok: 'Healthy', warn: 'Warning', crit: 'Critical' } as const;
const health = (h: number) => ({ value: h, tone: tone(h), label: toneLabel[tone(h)] });

const GH_INFO: Record<
  string,
  { area: string; system: string; glazing: string; heat: string; built: string; health: number }
> = {
  'GH-1': {
    area: '1.8 ha',
    system: 'Deep-water culture rafts',
    glazing: 'Diffuse glass, 6.5 m gutter',
    heat: 'Natural gas boiler + CHP',
    built: '2019',
    health: 90,
  },
  'GH-2': {
    area: '1.4 ha',
    system: 'NFT gutters',
    glazing: 'Double poly, 5.5 m gutter',
    heat: 'Hot-water pipe rail',
    built: '2021',
    health: 79,
  },
  'GH-3': {
    area: '0.4 ha',
    system: 'Ebb & flood benches',
    glazing: 'Diffuse glass, 5 m gutter',
    heat: 'Under-bench radiant',
    built: '2022',
    health: 95,
  },
};

const STAGES: Array<[string, number]> = [
  ['Germination', 0],
  ['Seedling', 6],
  ['Transplant', 14],
  ['Vegetative', 18],
  ['Harvest-ready', 28],
];
const PROP_STAGES: Array<[string, number]> = [
  ['Germination', 0],
  ['Seedling', 6],
  ['Ready to transplant', 14],
];

interface Batch {
  id: string;
  zone: string;
  gh: string;
  variety: string;
  day: number;
  plants: number;
  health: number;
  lot: string;
}
const BATCHES: Batch[] = ZONES.flatMap((z, i) =>
  [0, 1].map((j) => {
    const prop = z.gh === 'GH-3';
    const day = prop ? (j ? 4 + i : 9 + (i % 3)) : j ? 12 + (i % 4) : 24 + ((i * 3) % 9);
    return {
      id: `B-26${String(11 + i * 2 + j).padStart(2, '0')}`,
      zone: z.id,
      gh: z.gh,
      variety: z.crop,
      day: i === 0 && j === 0 ? 31 : day,
      plants: Math.round(z.plants * (j ? 0.46 : 0.54)),
      health: Math.max(55, Math.min(98, z.health + (j ? 2 : -1))),
      lot: `Seed lot ${4410 + i * 3 + j}`,
    };
  }),
);
let nextBatch = 11 + ZONES.length * 2;

const OBS: Record<string, Array<{ at: string; who: string; role: string; note: string }>> = {};
const OFFS = [3, -2, 5, -14, 1, 4, -6, 2, -24, 3, 0, -3];

const isProp = (b: Batch) => b.gh === 'GH-3';
const span = (b: Batch) => (isProp(b) ? 14 : 32);
const stageOf = (b: Batch) => {
  const st = isProp(b) ? PROP_STAGES : STAGES;
  return st.filter((s) => b.day >= s[1]).pop()![0];
};
const progress = (b: Batch) => Math.min(100, Math.round((b.day / span(b)) * 100));
const dayDate = (now: Date, offset: number) => {
  const d = new Date(now);
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
};
const height = (b: Batch, d: number) => {
  const p = isProp(b);
  return (p ? 4.5 : 14.5) / (1 + Math.exp(-(d - (p ? 7 : 18)) / (p ? 2.5 : 4)));
};

/** Zones the actor may see: all with zone.all, else the ones assigned in Workforce. */
export function scope(a: Actor) {
  if (can(a, 'zone.all')) return { zones: ZONES, note: null as string | null };
  const p = findPerson(a.name);
  const allowed = ZONES.filter(
    (z) => p && (p.zones.includes('All') || p.zones.includes(z.id) || p.zones.includes(z.gh)),
  );
  return {
    zones: allowed,
    note: `Showing ${allowed.length} zones assigned to you (${allowed.map((z) => z.id).join(', ')}). Other zones are hidden by your access policy.`,
  };
}
const zoneOr404 = (a: Actor, id: string) => {
  const z = scope(a).zones.find((x) => x.id === id);
  if (!z) throw new MockError(404, 'not_found', 'Unknown zone, or outside your access.');
  return z;
};
const batchOr404 = (a: Actor, id: string) => {
  const b = BATCHES.find((x) => x.id === id);
  if (!b || !scope(a).zones.some((z) => z.id === b.zone))
    throw new MockError(404, 'not_found', 'Unknown batch, or outside your access.');
  return b;
};

const batchEdit = (a: Actor) =>
  can(a, 'batch.edit') ? OK : no('Requires permission: Create & edit crop batches');

export function greenhouses(a: Actor) {
  const sc = scope(a);
  return {
    scope_note: sc.note,
    can_create_batch: batchEdit(a),
    items: GREENHOUSES.filter((g) => sc.zones.some((z) => z.gh === g.id)).map((g) => {
      const zs = sc.zones.filter((z) => z.gh === g.id);
      const avg = (k: 'temp' | 'rh') => zs.reduce((s, z) => s + z[k], 0) / zs.length;
      return {
        id: g.id,
        name: g.name,
        area: GH_INFO[g.id]!.area,
        system: GH_INFO[g.id]!.system,
        health: health(GH_INFO[g.id]!.health),
        zones: zs.map((z) => ({ id: z.id, health: health(z.health) })),
        plants: zs.reduce((s, z) => s + z.plants, 0),
        avg_temp_c: Number(avg('temp').toFixed(1)),
        avg_rh_pct: Math.round(avg('rh')),
        image_url: null,
        origin: 'SIMULATED',
      };
    }),
  };
}

export function greenhouse(a: Actor, id: string) {
  const g = GREENHOUSES.find((x) => x.id === id);
  const zs = scope(a).zones.filter((z) => z.gh === id);
  if (!g || zs.length === 0)
    throw new MockError(404, 'not_found', 'Unknown greenhouse, or outside your access.');
  const info = GH_INFO[id]!;
  return {
    id: g.id,
    name: g.name,
    area: info.area,
    system: info.system,
    structure: info.glazing,
    heating: info.heat,
    commissioned: info.built,
    health: health(info.health),
    image_url: null,
    zones: zs.map((z) => ({
      id: z.id,
      name: z.name,
      crop: z.crop,
      health: health(z.health),
      temp_c: z.temp,
      rh_pct: z.rh,
      ec: z.ec,
      plants: z.plants,
      batches: BATCHES.filter((b) => b.zone === z.id).length,
    })),
    origin: 'SIMULATED',
  };
}

const batchRow = (now: Date, b: Batch) => ({
  id: b.id,
  variety: b.variety,
  sown: dayDate(now, -b.day),
  day: b.day,
  plants: b.plants,
  stage: stageOf(b),
  progress: progress(b),
  health: health(b.health),
});

export function zone(a: Actor, now: Date, id: string) {
  const z = zoneOr404(a, id);
  const bs = BATCHES.filter((b) => b.zone === z.id);
  return {
    id: z.id,
    name: z.name,
    greenhouse_id: z.gh,
    greenhouse_name: GREENHOUSES.find((g) => g.id === z.gh)!.name,
    crop: z.crop,
    plants: z.plants,
    health: health(z.health),
    batches: bs.map((b) => batchRow(now, b)),
    can_create_batch: batchEdit(a),
    origin: 'SIMULATED',
  };
}

function trackedPlants(b: Batch) {
  const base = OFFS.map((o, k) => ({
    // Unique per batch: B-2613 → P-1301 … P-1312 (detection plants replace the last ones).
    id: `P-${String(parseInt(b.id.slice(4)) * 100 + k + 1).padStart(4, '0')}`,
    health: Math.max(40, Math.min(99, b.health + o)),
    row: `Row ${12 + Math.floor(k / 4)} · Pos ${(k % 4) + 1}`,
  }));
  // Plants with a recorded detection are always among the tracked plants.
  det.plantsInBatch(b.id).forEach((pid, i) => {
    if (!base.some((p) => p.id === pid))
      base[base.length - 1 - i] = { ...base[base.length - 1 - i]!, id: pid };
  });
  return base;
}

export function batch(a: Actor, now: Date, id: string) {
  const b = batchOr404(a, id);
  const z = ZONES.find((x) => x.id === b.zone)!;
  const st = isProp(b) ? PROP_STAGES : STAGES;
  const sp = span(b);
  const measured = Array.from({ length: b.day + 1 }, (_, d) => Number(height(b, d).toFixed(2)));
  const projected = Array.from({ length: sp - b.day + 1 }, (_, i) =>
    Number(height(b, b.day + i).toFixed(2)),
  );
  return {
    ...batchRow(now, b),
    lot: b.lot,
    zone_id: z.id,
    zone_name: z.name,
    greenhouse_id: b.gh,
    target_label: isProp(b) ? 'Transplant target' : 'Est. harvest',
    target: dayDate(now, sp - b.day),
    timeline: st.map(([label, d], i) => {
      const done = b.day >= d;
      const next = st[i + 1];
      const current = done && (!next || b.day < next[1]);
      return {
        label,
        day: d,
        date: dayDate(now, d - b.day),
        state: current ? 'current' : done ? 'done' : 'planned',
      };
    }),
    growth: { span_days: sp, measured, projected, max_cm: isProp(b) ? 6 : 16, simulated: true },
    plants_tracked: trackedPlants(b).map((p) => ({
      ...p,
      health: health(p.health),
      image_url: null,
    })),
    actions: { edit: batchEdit(a) },
    origin: 'SIMULATED',
  };
}

export function plant(a: Actor, now: Date, id: string) {
  const b = BATCHES.find(
    (x) => trackedPlants(x).some((p) => p.id === id) && scope(a).zones.some((z) => z.id === x.zone),
  );
  if (!b) throw new MockError(404, 'not_found', 'Unknown plant, or outside your access.');
  const p = trackedPlants(b).find((x) => x.id === id)!;
  const z = ZONES.find((x) => x.id === b.zone)!;
  const detections = det.forPlant(id).filter((d) => d.batch === b.id);
  const hh = series(14, p.health, 2.5, 2, parseInt(id.slice(2)), 0.8, 1).map((v) => Math.round(v));
  hh[13] = p.health;
  const obsDefault = [
    {
      at: dayDate(now, -1) + ' · 14:20',
      who: 'Hana Kim',
      role: 'Crop Scout',
      note: detections.length
        ? 'Slight browning on inner leaf margins, monitoring.'
        : 'Uniform colour and turgor. No pests on underside.',
    },
    {
      at: dayDate(now, -6) + ' · 10:05',
      who: 'Sofia Marchetti',
      role: 'Grower',
      note: 'Transplant establishment good; roots white, 4–5 cm.',
    },
  ];
  const inRange = (v: number, lo: number, hi: number) =>
    v < lo ? 'Below range' : v > hi ? 'Above range' : 'Within range';
  return {
    id,
    variety: b.variety,
    row: p.row,
    batch_id: b.id,
    zone_id: z.id,
    zone_name: z.name,
    greenhouse_name: GREENHOUSES.find((g) => g.id === z.gh)!.name,
    stage: stageOf(b),
    age_days: b.day,
    sown: dayDate(now, -b.day),
    progress: progress(b),
    health: health(p.health),
    health_14d: hh,
    height_cm: Number((height(b, b.day) * (0.9 + p.health / 1000)).toFixed(1)),
    leaves: Math.max(2, Math.round(b.day * 0.48 + (p.health - 85) / 8)),
    estimates_simulated: true,
    image_url: null,
    environment: [
      {
        label: 'Air temperature · 7-day avg',
        value: `${(z.temp - 0.2).toFixed(1)} °C`,
        note: inRange(z.temp - 0.2, ...ranges.temp),
      },
      {
        label: 'Relative humidity · night avg',
        value: `${z.rh + 3} %`,
        note: inRange(z.rh + 3, ...ranges.rh),
      },
      {
        label: 'EC at root zone',
        value: `${z.ec.toFixed(2)} mS/cm`,
        note: inRange(z.ec, ...ranges.ec),
      },
    ],
    ranges_placeholder: true,
    detections: detections.map((d) => ({ ...d, source: 'Detection fixture (simulated)' })),
    observations: [...(OBS[id] ?? []), ...obsDefault],
    actions: {
      observe: can(a, 'plant.observe') ? OK : no('Requires permission: Log plant observations'),
    },
    origin: 'SIMULATED',
  };
}

export function observe(a: Actor, now: Date, id: string, b: { note?: string }) {
  const p = plant(a, now, id);
  if (!p.actions.observe.allowed) throw new MockError(403, 'forbidden', p.actions.observe.reason!);
  const note = String(b.note ?? '').trim();
  if (note.length < 3)
    throw new MockError(422, 'invalid_note', 'Write what you observed (at least 3 characters).');
  if (note.length > 1000)
    throw new MockError(422, 'invalid_note', 'Keep the note under 1000 characters.');
  const role = findPerson(a.name)?.role ?? '';
  (OBS[id] ??= []).unshift({
    at: `${dayDate(now, 0)} · ${now.toTimeString().slice(0, 5)}`,
    who: a.name,
    role,
    note,
  });
  auditLog.record(a.name, 'Observation logged', id, note.slice(0, 80));
  return { item: plant(a, now, id), message: `Observation saved to ${id}.` };
}

type BatchInput = {
  zone_id?: string;
  variety?: string;
  plants?: number;
  sown_days_ago?: number;
  lot?: string;
};
function validate(b: BatchInput, a: Actor, creating: boolean) {
  const variety = String(b.variety ?? '').trim();
  const plants = Number(b.plants);
  const day = Number(b.sown_days_ago);
  if (creating) zoneOr404(a, String(b.zone_id ?? ''));
  if (variety.length < 2) throw new MockError(422, 'invalid_variety', 'Enter the variety.');
  if (!Number.isInteger(plants) || plants < 1 || plants > 200_000)
    throw new MockError(422, 'invalid_plants', 'Plants must be a whole number from 1 to 200,000.');
  if (!Number.isInteger(day) || day < 0 || day > 60)
    throw new MockError(422, 'invalid_sown', 'Sown must be 0–60 days ago.');
  return { variety, plants, day, lot: String(b.lot ?? '').trim() || '—' };
}

export function createBatch(a: Actor, now: Date, b: BatchInput) {
  if (!can(a, 'batch.edit'))
    throw new MockError(403, 'forbidden', 'Requires permission: Create & edit crop batches');
  const v = validate(b, a, true);
  const z = ZONES.find((x) => x.id === b.zone_id)!;
  const nb: Batch = {
    id: `B-26${nextBatch++}`,
    zone: z.id,
    gh: z.gh,
    variety: v.variety,
    day: v.day,
    plants: v.plants,
    health: z.health,
    lot: v.lot,
  };
  BATCHES.push(nb);
  auditLog.record(
    a.name,
    'Crop batch created',
    nb.id,
    `${nb.variety} · ${nb.plants.toLocaleString('en-CA')} plants · ${z.id}`,
  );
  return { item: batch(a, now, nb.id), message: `${nb.id} created in ${z.id}.` };
}

export function updateBatch(a: Actor, now: Date, id: string, b: BatchInput) {
  if (!can(a, 'batch.edit'))
    throw new MockError(403, 'forbidden', 'Requires permission: Create & edit crop batches');
  const cur = batchOr404(a, id);
  const v = validate(b, a, false);
  Object.assign(cur, { variety: v.variety, plants: v.plants, day: v.day, lot: v.lot });
  auditLog.record(
    a.name,
    'Crop batch updated',
    id,
    `${v.variety} · ${v.plants.toLocaleString('en-CA')} plants · day ${v.day}`,
  );
  return { item: batch(a, now, id), message: `${id} updated.` };
}

/** Batches and tracked plants the actor may see, for the global search. */
export function searchRows(a: Actor) {
  const zones = new Set(scope(a).zones.map((z) => z.id));
  const bs = BATCHES.filter((b) => zones.has(b.zone));
  return {
    batches: bs.map((b) => ({ id: b.id, variety: b.variety, zone: b.zone, gh: b.gh })),
    plants: bs.flatMap((b) =>
      trackedPlants(b).map((p) => ({
        id: p.id,
        row: p.row,
        batch: b.id,
        zone: b.zone,
        gh: b.gh,
        variety: b.variety,
      })),
    ),
  };
}
