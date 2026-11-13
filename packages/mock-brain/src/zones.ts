/**
 * Mock Zones & Inventory: zone setup plus what is assigned to each zone (devices from the
 * registry, robots of the greenhouse, crew from Workforce, upcoming service). New zones are
 * recorded here with no devices: devices join a zone by announcing themselves and being
 * approved (ADR-016) or by registration — they are never pre-declared.
 */
import { GREENHOUSES, ROLES, ZONES, type RoleId } from './design-data.ts';
import * as dev from './devices.ts';
import { scope } from './crops.ts';
import { MockError } from './incidents.ts';
import * as auditLog from './audit.ts';
import { PEOPLE } from './workforce.ts';

interface Actor {
  name: string;
  permissions: string[];
}
const can = (a: Actor, p: string) => a.permissions.includes(p);
const OK = { allowed: true, reason: null as string | null };
const no = (reason: string) => ({ allowed: false, reason });
const tone = (h: number | null) =>
  h === null ? 'off' : h >= 85 ? 'ok' : h >= 70 ? 'warn' : 'crit';

const GH_INFO: Record<string, { system: string; area_ha: number }> = {
  'GH-1': { system: 'Deep-water culture rafts', area_ha: 1.8 },
  'GH-2': { system: 'NFT gutters', area_ha: 1.4 },
  'GH-3': { system: 'Ebb & flood benches', area_ha: 0.4 },
};
const USES = ['Production', 'Propagation', 'Quarantine', 'Trials / R&D', 'Packing / storage'];
const SYSTEMS = [
  'Deep-water culture rafts',
  'NFT gutters',
  'Ebb & flood benches',
  'Substrate slabs',
  'Vertical towers',
];
const SPEEDS = ['0.3 m/s', '0.5 m/s', 'Robots not allowed'];

interface ZoneRec {
  id: string;
  gh: string;
  name: string;
  crop: string;
  plants: number | null;
  health: number | null;
  area_m2: number;
  system: string;
  rows: string;
  use: string;
  robot_access: string;
  supervisor: string;
  custom: boolean;
}

const base: ZoneRec[] = ZONES.map((z) => ({
  id: z.id,
  gh: z.gh,
  name: z.name,
  crop: z.crop,
  plants: z.plants,
  health: z.health,
  area_m2: Math.round((GH_INFO[z.gh]!.area_ha * 10000) / ZONES.filter((q) => q.gh === z.gh).length),
  system: GH_INFO[z.gh]!.system,
  rows: z.gh === 'GH-3' ? '12 benches' : '18 rafts / gutters',
  use: z.gh === 'GH-3' ? 'Propagation' : 'Production',
  robot_access:
    z.id === 'GH1-Z4' ? 'Restricted · spray re-entry interval' : 'Allowed · max 0.3 m/s near crew',
  supervisor: z.gh === 'GH-3' ? 'Owen MacLeod' : 'Marcus Okafor',
  custom: false,
}));
const extra: ZoneRec[] = [];
const all = () => [...base, ...extra].sort((x, y) => x.id.localeCompare(y.id));

function visible(a: Actor) {
  const allowed = new Set(scope(a).zones.map((z) => z.id));
  return all().filter((z) => allowed.has(z.id) || (z.custom && can(a, 'zone.all')));
}

const crewOf = (z: ZoneRec) =>
  PEOPLE.filter(
    (p) =>
      !['admin', 'manager'].includes(p.role) &&
      (p.zones.includes('All') || p.zones.includes(z.gh) || p.zones.includes(z.id)),
  );
const short = (r: RoleId) => ROLES.find((x) => x.id === r)!.short;
const ghName = (id: string) => GREENHOUSES.find((g) => g.id === id)!.name;

export function list(a: Actor, now: Date) {
  const zs = visible(a);
  const devices = zs.flatMap((z) => dev.inZone(now, z.id));
  const robots = new Set(
    zs.flatMap((z) =>
      z.robot_access === 'Robots not allowed' ? [] : dev.robotsIn(now, z.gh).map((r) => r.id),
    ),
  );
  return {
    summary: `${zs.length} zones · ${devices.length} devices · ${robots.size} robots & drones`,
    can_create: can(a, 'zone.manage') ? OK : no('Requires permission: Create & edit zones'),
    items: zs.map((z) => {
      const ds = dev.inZone(now, z.id);
      const sensors = ds.filter((d) => d.category === 'sensor');
      return {
        id: z.id,
        name: z.name,
        greenhouse_name: ghName(z.gh),
        crop: z.crop,
        tone: tone(z.health),
        sensors_live: sensors.filter((d) => d.status === 'Online' && d.mode === 'on').length,
        sensors_total: sensors.length,
        cameras: ds.filter((d) => d.category === 'camera').length,
        robots: z.robot_access === 'Robots not allowed' ? 0 : dev.robotsIn(now, z.gh).length,
        crew: crewOf(z).length,
        service_due: ds.filter((d) => d.service.due_days !== null && d.service.due_days <= 14)
          .length,
        custom: z.custom,
      };
    }),
    origin: 'SIMULATED',
  };
}

export function detail(a: Actor, now: Date, id: string) {
  const z = visible(a).find((x) => x.id === id);
  if (!z) throw new MockError(404, 'not_found', 'Unknown zone, or outside your access.');
  const ds = dev.inZone(now, z.id);
  return {
    id: z.id,
    name: z.name,
    greenhouse_id: z.gh,
    greenhouse_name: ghName(z.gh),
    custom: z.custom,
    params: [
      { label: 'Greenhouse', value: `${z.gh} · ${ghName(z.gh)}` },
      { label: 'Use', value: z.use },
      { label: 'Crop', value: z.crop },
      { label: 'Growing system', value: z.system },
      { label: 'Area', value: `${z.area_m2.toLocaleString('en-CA')} m²` },
      { label: 'Rows / benches', value: z.rows },
      { label: 'Plants', value: z.plants === null ? '—' : z.plants.toLocaleString('en-CA') },
      { label: 'Environment profile', value: 'Placeholder profile (agronomist to confirm)' },
      { label: 'Irrigation', value: 'Disabled by design (interface only)' },
      { label: 'Robot access', value: z.robot_access },
      { label: 'Zone supervisor', value: z.supervisor },
    ],
    devices: ds.map((d) => ({
      id: d.id,
      category: d.category,
      brand: d.brand,
      model: d.model,
      status: d.status,
      mode: d.mode,
      due_days: d.service.due_days,
      origin: d.origin,
    })),
    robots:
      z.robot_access === 'Robots not allowed'
        ? []
        : dev
            .robotsIn(now, z.gh)
            .map((r) => ({ id: r.id, type: r.type, mode: r.mode, origin: r.origin })),
    crew: crewOf(z).map((p) => ({ name: p.name, role_id: p.role, role_label: short(p.role) })),
    maintenance: ds
      .filter((d) => d.service.due_days !== null)
      .sort((x, y) => x.service.due_days! - y.service.due_days!)
      .slice(0, 5)
      .map((d) => ({
        device_id: d.id,
        type: d.type,
        date: d.service.next,
        due_days: d.service.due_days!,
      })),
    origin: 'SIMULATED',
  };
}

const nextId = (gh: string) =>
  `${gh.replace('-', '')}-Z${all().filter((z) => z.gh === gh).length + 1}`;

export function form(a: Actor) {
  return {
    can_create: can(a, 'zone.manage') ? OK : no('Requires permission: Create & edit zones'),
    greenhouses: GREENHOUSES.map((g) => ({
      id: g.id,
      label: `${g.id} · ${g.name}`,
      next_id: nextId(g.id),
    })),
    uses: USES,
    systems: SYSTEMS,
    robot_speeds: SPEEDS,
    supervisors: PEOPLE.filter((p) => p.role === 'supervisor').map((p) => p.name),
  };
}

export function create(
  a: Actor,
  now: Date,
  b: {
    greenhouse_id?: string;
    name?: string;
    use?: string;
    crop?: string;
    system?: string;
    area_m2?: number;
    rows?: number;
    plants?: number | null;
    supervisor?: string;
    robot_speed?: string;
  },
) {
  if (!can(a, 'zone.manage'))
    throw new MockError(403, 'forbidden', 'Requires permission: Create & edit zones');
  const gh = GREENHOUSES.find((g) => g.id === b.greenhouse_id);
  if (!gh) throw new MockError(422, 'invalid_greenhouse', 'Choose a greenhouse.');
  const name = String(b.name ?? '').trim();
  if (name.length < 2 || name.length > 40)
    throw new MockError(422, 'invalid_name', 'Give the zone a name (2–40 characters).');
  if (all().some((z) => z.gh === gh.id && z.name.toLowerCase() === name.toLowerCase()))
    throw new MockError(409, 'duplicate', `${gh.name} already has a zone called “${name}”.`);
  if (!USES.includes(String(b.use))) throw new MockError(422, 'invalid_use', 'Choose a use.');
  if (!SYSTEMS.includes(String(b.system)))
    throw new MockError(422, 'invalid_system', 'Choose a growing system.');
  if (!SPEEDS.includes(String(b.robot_speed)))
    throw new MockError(422, 'invalid_speed', 'Choose the robot access.');
  const area = Number(b.area_m2);
  const rows = Number(b.rows);
  if (!Number.isInteger(area) || area < 10 || area > 50_000)
    throw new MockError(422, 'invalid_area', 'Area must be a whole number from 10 to 50,000 m².');
  if (!Number.isInteger(rows) || rows < 1 || rows > 500)
    throw new MockError(
      422,
      'invalid_rows',
      'Rows / benches must be a whole number from 1 to 500.',
    );
  const plants =
    b.plants === null || b.plants === undefined || String(b.plants) === ''
      ? null
      : Number(b.plants);
  if (plants !== null && (!Number.isInteger(plants) || plants < 0 || plants > 500_000))
    throw new MockError(
      422,
      'invalid_plants',
      'Plant capacity must be a whole number up to 500,000.',
    );
  const sup = PEOPLE.find((p) => p.name === b.supervisor && p.role === 'supervisor');
  if (!sup) throw new MockError(422, 'invalid_supervisor', 'Choose a zone supervisor.');
  const z: ZoneRec = {
    id: nextId(gh.id),
    gh: gh.id,
    name,
    crop: String(b.crop ?? '').trim() || 'Not planted',
    plants,
    health: null,
    area_m2: area,
    system: String(b.system),
    rows: `${rows} rows`,
    use: String(b.use),
    robot_access:
      b.robot_speed === 'Robots not allowed'
        ? 'Robots not allowed'
        : `Allowed · max ${b.robot_speed} near crew`,
    supervisor: sup.name,
    custom: true,
  };
  extra.push(z);
  auditLog.record(a.name, 'Zone created', z.id, `${z.name} · ${z.use}`);
  return {
    item: detail(a, now, z.id),
    message: `${z.id} created. It has no devices yet: they appear when they announce themselves and are approved, or when you register them.`,
  };
}
