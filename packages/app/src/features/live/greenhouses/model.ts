import type {
  CropAssignment,
  PlantHealthRow,
  PlantHealthState,
  PlantItem,
  Places,
} from '@lefi/api';

/** Where the person is in Greenhouse → Zone → Crop batch → Plant. */
export type GhPath =
  | { level: 'list' }
  | { level: 'gh'; gh: string }
  | { level: 'zone'; gh: string; zone: string }
  | { level: 'batch'; gh: string; zone: string; batch: string }
  | { level: 'plant'; gh: string; zone: string; batch?: string; plant: string };

export type Go = (p: GhPath) => void;

/** Everything the screen reads from Lefi Brain, joined once. */
export interface GhData {
  places: Places;
  plants: PlantItem[];
  /** Active crop assignments: the "crop batches" of the design (ADR-066). */
  crops: CropAssignment[];
  /** Latest health recorded by people, per plant; absent without `nav.plantHealth`. */
  health?: Map<string, PlantHealthRow>;
  /** Lefi Brain's clock (ADR-008); day counts are not shown without it. */
  now?: string;
}

const DAY_MS = 86_400_000;

/** Whole days from a `YYYY-MM-DD` date to Lefi Brain's time; `undefined` without that time. */
export function daysSince(date: string, now: string | undefined): number | undefined {
  if (!now) return undefined;
  const start = Date.parse(`${date}T00:00:00Z`);
  const today = Date.parse(`${now.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(today)) return undefined;
  return Math.max(0, Math.round((today - start) / DAY_MS));
}

/**
 * Share of the time from start to the expected harvest that has passed (0–100), only when a person
 * entered the expected harvest. Nothing is estimated from the crop.
 */
export function timeProgress(c: CropAssignment, now: string | undefined): number | undefined {
  if (!c.expected_harvest_on) return undefined;
  const total = Date.parse(c.expected_harvest_on) - Date.parse(c.started_on);
  const done = daysSince(c.started_on, now);
  if (done === undefined || !(total > 0)) return undefined;
  return Math.min(100, Math.max(0, Math.round(((done * DAY_MS) / total) * 100)));
}


/** The registered plants a crop batch is made of (ADR-082). */
export function plantsOfCrop(c: CropAssignment, d: GhData): PlantItem[] {
  return d.plants.filter((p) => p.assignment_id === c.id);
}

/** The active crop batch this plant belongs to, if any (ADR-082). */
export function cropOfPlant(p: PlantItem, d: GhData): CropAssignment | undefined {
  return p.assignment_id ? d.crops.find((c) => c.id === p.assignment_id) : undefined;
}

const RANK: Record<PlantHealthState, number> = { healthy: 0, watch: 1, problem: 2 };

export interface HealthSummary {
  total: number;
  checked: number;
  worst?: PlantHealthState;
  counts: Record<PlantHealthState, number>;
}

/** What people last recorded about these plants; never a score. */
export function summarizeHealth(plants: PlantItem[], health: GhData['health']): HealthSummary {
  const counts: Record<PlantHealthState, number> = { healthy: 0, watch: 0, problem: 0 };
  let worst: PlantHealthState | undefined;
  for (const p of plants) {
    const h = health?.get(p.id)?.latest?.health;
    if (!h) continue;
    counts[h] += 1;
    if (!worst || RANK[h] > RANK[worst]) worst = h;
  }
  const checked = counts.healthy + counts.watch + counts.problem;
  return { total: plants.length, checked, counts, ...(worst ? { worst } : {}) };
}

export const cropNames = (d: GhData) =>
  new Map(d.places.cropTypes.map((t) => [t.id, t.variety ? `${t.name} · ${t.variety}` : t.name]));

/** "ZA · Zona A", or the name alone for zones made before codes existed. */
export const zoneTitle = (z: { code: string | null; name: string }) =>
  z.code ? `${z.code} · ${z.name}` : z.name;

export const fmtNum = (n: number) => n.toLocaleString('en-CA');
