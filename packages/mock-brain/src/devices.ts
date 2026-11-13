/**
 * Mock device fleet: the prototype's 60 devices (design DEVICES + robots) plus one ESP32 that
 * announced itself and waits for approval (ADR-016). FAKE — brands, models and serials are
 * prototype content, every record `origin: SIMULATED`. Power control is never available:
 * LEFI CROP does not operate relays (no actuator in the allowlist).
 */
import { GREENHOUSES, ZONES } from './design-data.ts';
import { MockError } from './incidents.ts';
import { addTask, allTasks } from './tasks.ts';

type Mode = 'on' | 'ai' | 'paused' | 'off';
type Cat = 'sensor' | 'camera' | 'actuator' | 'robot' | 'drone';

interface Dev {
  id: string;
  cat: Cat;
  type: string;
  brand: string;
  model: string;
  serial: string;
  gh: string;
  zone: string;
  pos: string;
  proto: string;
  fw: string;
  signal: string;
  battery: string;
  seen: string;
  status: string;
  interval: number | null;
  age: number | null; // days since last service
  installedDaysAgo: number;
  warrantyInDays: number;
  power: string;
  hist: Array<[number | null, string, string]>; // [daysAgo, what, who]
  mode: Mode;
  lifecycle: 'PENDING' | 'ACTIVE' | 'MISSING' | 'RETIRED';
}

const MAKER: Record<string, [string, string]> = {
  'LC-TH200': ['Vaisala', 'HMP110'],
  'LC-PAR10': ['Apogee Instruments', 'SQ-500-SS'],
  'LC-SM12': ['METER Group', 'TEROS 12'],
  'LC-PH4': ['Atlas Scientific', 'Industrial pH probe'],
  'LC-EC3': ['Atlas Scientific', 'Conductivity K1.0'],
  'LC-CAM-R4': ['Axis Communications', 'M3086-V'],
  'LC-PC2': ['Priva', 'Connext PC2'],
};
const KIT: Array<[string, string, string]> = [
  ['TH', 'Temp / RH probe', 'LC-TH200'],
  ['PAR', 'PAR light sensor', 'LC-PAR10'],
  ['SM', 'Substrate moisture', 'LC-SM12'],
  ['PH', 'pH probe', 'LC-PH4'],
  ['EC', 'EC / TDS probe', 'LC-EC3'],
  ['CAM', 'Vision camera', 'LC-CAM-R4'],
];

function build(): Dev[] {
  const raw: Array<
    Omit<
      Dev,
      | 'cat'
      | 'brand'
      | 'model'
      | 'serial'
      | 'pos'
      | 'interval'
      | 'age'
      | 'installedDaysAgo'
      | 'warrantyInDays'
      | 'power'
      | 'hist'
      | 'gh'
    > & { code: string }
  > = [];
  ZONES.forEach((z, zi) =>
    KIT.forEach(([c, t, m], k) => {
      const sim = c === 'PH' && z.gh !== 'GH-3';
      const off = z.id === 'GH2-Z3' && c === 'SM';
      raw.push({
        id: `${c}-${z.id}-0${c === 'SM' && off ? 2 : 1}`,
        type: t,
        code: m,
        zone: z.id,
        proto: c === 'CAM' ? 'Wi-Fi / RTSP' : 'LoRaWAN',
        fw: c === 'CAM' ? '4.1.2' : `2.${3 + (k % 3)}.${zi % 4}`,
        signal: off || sim ? '—' : `${-62 - ((zi * 7 + k * 5) % 26)} dBm`,
        battery: c === 'CAM' ? 'Mains' : off || sim ? '—' : `${58 + ((zi * 13 + k * 11) % 41)} %`,
        seen: off ? '06:12' : sim ? 'Not installed' : `09:4${(zi + k) % 3}`,
        status: off
          ? 'Offline'
          : sim
            ? 'Simulated'
            : zi === 5 && c === 'PAR'
              ? 'Low battery'
              : 'Online',
        mode: 'on',
        lifecycle: off ? 'MISSING' : 'ACTIVE',
      });
    }),
  );
  ['GH-1', 'GH-2', 'GH-3'].forEach((g) =>
    raw.push({
      id: `PUMP-${g}-A`,
      type: 'Irrigation pump controller',
      code: 'LC-PC2',
      zone: g,
      proto: 'Modbus TCP',
      fw: '1.9.4',
      signal: 'Wired',
      battery: 'Mains',
      seen: '09:42',
      status: 'Online',
      mode: 'on',
      lifecycle: 'ACTIVE',
    }),
  );
  const robots: Array<[string, string, string, string, string, string, string, string, string]> = [
    [
      'LEFI-R1',
      'Ground rover',
      'MH3-compatible',
      'GH-1',
      '0.9.3 (sim)',
      '−58 dBm',
      '78 %',
      'Live',
      'Online',
    ],
    ['LEFI-R2', 'Ground rover', 'MH3 rover', 'GH-2', '1.2.0', '−61 dBm', '96 %', '09:42', 'Docked'],
    [
      'LEFI-D1',
      'Indoor drone',
      'Quad · 4K gimbal',
      'GH-3',
      '0.7.1',
      '—',
      '—',
      'Oct 26 17:20',
      'Maintenance',
    ],
  ];
  robots.forEach(([id, type, model, zone, fw, signal, battery, seen, status]) =>
    raw.push({
      id,
      type,
      code: model,
      zone,
      proto: id.startsWith('LEFI-D') ? 'Wi-Fi 6' : 'Wi-Fi 6 · ROS 2',
      fw,
      signal,
      battery,
      seen,
      status,
      mode: 'on',
      lifecycle: 'ACTIVE',
    }),
  );

  return raw.map((d, i) => {
    const cat: Cat = d.id.startsWith('LEFI-D')
      ? 'drone'
      : d.id.startsWith('LEFI-')
        ? 'robot'
        : d.id.startsWith('CAM')
          ? 'camera'
          : /^(PUMP|VLV)/.test(d.id)
            ? 'actuator'
            : 'sensor';
    const [brand, model] = MAKER[d.code] ?? ['Lefi Robotics', d.code];
    const gh = d.zone.startsWith('GH-')
      ? d.zone
      : (ZONES.find((z) => z.id === d.zone)?.gh ?? 'GH-1');
    const sim = d.status === 'Simulated';
    const interval =
      cat === 'sensor'
        ? /^(PH|EC)/.test(d.id)
          ? 30
          : 90
        : cat === 'camera'
          ? 180
          : cat === 'actuator'
            ? 120
            : 60;
    let age = [4, 11, 23, 37, 52, 68, 81, 26][(i * 5) % 8] ?? 10;
    if (d.status === 'Offline') age = interval + 3;
    if (d.id === 'LEFI-D1') age = 62;
    const pre = brand.replace(/[^A-Z]/g, '').slice(0, 3) || 'LC';
    const robotish = cat === 'robot' || cat === 'drone';
    return {
      ...d,
      cat,
      brand,
      model,
      gh,
      serial: `${pre}-${2400000 + ((i * 7919) % 99999)}`,
      pos:
        cat === 'actuator'
          ? `Pump room · panel P${(i % 3) + 1}`
          : robotish
            ? `${gh} ${cat === 'drone' ? 'pad' : 'dock'}`
            : `Row ${8 + ((i * 3) % 14)} · post ${1 + (i % 4)}${cat === 'camera' ? ' · rail 2.4 m' : ' · 0.4 m'}`,
      interval: sim ? null : interval,
      age: sim ? null : age,
      installedDaysAgo: 200 + ((i * 13) % 600),
      warrantyInDays: 400 + ((i * 11) % 500),
      power:
        cat === 'camera'
          ? `PoE switch SW-${gh.replace('-', '')} · port ${1 + (i % 24)}`
          : cat === 'actuator'
            ? `MCC panel · contactor K${(i % 4) + 1}`
            : robotish
              ? 'Dock charger + wireless e-stop'
              : `Relay RLY-${d.zone} · ch ${1 + (i % 6)}`,
      hist: sim
        ? [[null, 'Not installed — values are model estimates', 'System']]
        : [
            [
              age,
              cat === 'sensor' ? 'Calibration · 2-point' : 'Inspection & cleaning',
              ['Luis Ortega', 'Tyler Brooks'][i % 2] ?? '',
            ],
            [age + interval, `Firmware update → v${d.fw}`, 'Priya Raman'],
          ],
    } satisfies Dev;
  });
}

const fleet: Dev[] = build();
fleet.push({
  id: 'ESP32-A4CF12',
  cat: 'sensor',
  type: 'ESP32 node (announced)',
  brand: 'Espressif',
  model: 'ESP32 (announce)',
  serial: 'A4:CF:12:9B:30:7E',
  gh: 'GH-1',
  zone: 'GH1-Z1',
  pos: 'Not set',
  proto: 'MQTT · Wi-Fi',
  fw: '0.1.0',
  signal: '−55 dBm',
  battery: 'Mains',
  seen: '09:41',
  status: 'Pending approval',
  interval: null,
  age: null,
  installedDaysAgo: 0,
  warrantyInDays: 0,
  power: 'None',
  hist: [[0, 'Announced itself on lefi/v1/devices/…/announce', 'Device']],
  mode: 'ai',
  lifecycle: 'PENDING',
});

const DAY = 86_400_000;
const date = (now: Date, daysOffset: number, year = false) =>
  new Date(now.getTime() + daysOffset * DAY).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    ...(year && { year: 'numeric' }),
  });

const dueDays = (d: Dev) => (d.interval === null || d.age === null ? null : d.interval - d.age);
const health = (d: Dev) =>
  d.mode === 'off' || d.status === 'Offline'
    ? d.status === 'Offline'
      ? 0
      : null
    : d.status === 'Simulated' || d.lifecycle === 'PENDING'
      ? null
      : d.status === 'Low battery'
        ? 61
        : d.status === 'Maintenance'
          ? 48
          : Math.max(55, 98 - Math.round(((d.age ?? 0) / (d.interval ?? 1)) * 30));

function statusOf(d: Dev) {
  if (d.mode === 'paused' && !['Offline', 'Pending approval'].includes(d.status))
    return 'Readings paused';
  return d.status;
}

const ghName = (id: string) => GREENHOUSES.find((g) => g.id === id)?.name ?? id;

function row(d: Dev, now: Date) {
  const due = dueDays(d);
  const z = ZONES.find((x) => x.id === d.zone);
  return {
    id: d.id,
    category: d.cat,
    type: d.type,
    brand: d.brand,
    model: d.model,
    serial: d.serial,
    greenhouse_id: d.gh,
    zone_id: z ? z.id : null,
    zone_label: d.zone,
    position: d.pos,
    location_label: `${ghName(d.gh)} · ${z ? z.name : d.cat === 'actuator' ? 'Pump room' : d.pos}`,
    protocol: d.proto,
    firmware: d.fw,
    signal: d.signal,
    battery: d.battery,
    last_seen_label: d.seen,
    status: statusOf(d),
    health: health(d),
    mode: d.mode,
    lifecycle: d.lifecycle,
    origin: 'SIMULATED',
    service: {
      interval_days: d.interval,
      due_days: due,
      last: d.age === null ? '—' : date(now, -d.age),
      next: due === null ? '—' : date(now, due),
    },
  };
}

interface Actor {
  name: string;
  permissions: string[];
}
const can = (a: Actor, p: string) => a.permissions.includes(p);
const LABEL: Record<string, string> = {
  'device.ai': 'Isolate devices from AI / pause readings',
  'device.manage': 'Register & edit devices',
};

/** An unfinished maintenance task for this device, if any (no duplicate work orders). */
const openMaintenance = (d: Dev) =>
  allTasks().find((t) => t.title.startsWith(`Maintenance · ${d.id} `) && t.status !== 'Verified');

function availability(d: Dev, a: Actor) {
  const soft = (m: Mode) =>
    d.lifecycle === 'PENDING'
      ? { allowed: false, reason: 'Approve the device first.' }
      : d.mode === m
        ? { allowed: false, reason: 'Already in this mode.' }
        : can(a, 'device.ai') || can(a, 'device.power')
          ? { allowed: true, reason: null }
          : { allowed: false, reason: `Requires permission: ${LABEL['device.ai']}` };
  const manage = (ok: boolean, why: string) =>
    !can(a, 'device.manage')
      ? { allowed: false, reason: `Requires permission: ${LABEL['device.manage']}` }
      : ok
        ? { allowed: true, reason: null }
        : { allowed: false, reason: why };
  return {
    modes: {
      on: soft('on'),
      ai: soft('ai'),
      paused: soft('paused'),
      off: {
        allowed: false,
        reason:
          'Not available: LEFI CROP does not operate relays, PoE ports or other power controls.',
      },
    },
    actions: {
      schedule_maintenance: openMaintenance(d)
        ? manage(false, `${openMaintenance(d)!.id} is already open for this device.`)
        : manage(
            d.lifecycle === 'ACTIVE' || d.lifecycle === 'MISSING',
            'Only registered devices can be scheduled.',
          ),
      approve: manage(d.lifecycle === 'PENDING', 'Only pending devices can be approved.'),
      reject: manage(d.lifecycle === 'PENDING', 'Only pending devices can be rejected.'),
    },
  };
}

function detail(d: Dev, now: Date, a: Actor) {
  return {
    ...row(d, now),
    power_control: d.power,
    installed: d.installedDaysAgo ? date(now, -d.installedDaysAgo, true) : '—',
    warranty_until: d.warrantyInDays ? date(now, d.warrantyInDays, true) : '—',
    history: d.hist.map(([ago, what, who]) => ({
      date: ago === null ? '—' : date(now, -ago),
      what,
      who,
    })),
    ...availability(d, a),
  };
}

const NEEDS = (d: Dev) =>
  ['Offline', 'Low battery', 'Maintenance', 'Pending approval'].includes(d.status) ||
  (dueDays(d) ?? 99) <= 14;
const STATUS_FILTER: Record<string, (d: Dev) => boolean> = {
  attention: NEEDS,
  offline: (d) => d.status === 'Offline',
  due14: (d) => (dueDays(d) ?? 99) <= 14,
  isolated: (d) => d.mode !== 'on',
  pending: (d) => d.lifecycle === 'PENDING',
};
const CAT_FILTER: Record<string, (d: Dev) => boolean> = {
  sensor: (d) => d.cat === 'sensor',
  camera: (d) => d.cat === 'camera',
  actuator: (d) => d.cat === 'actuator',
  robot: (d) => d.cat === 'robot' || d.cat === 'drone',
};

const live = () => fleet.filter((d) => d.lifecycle !== 'RETIRED');

export function list(now: Date, q: URLSearchParams) {
  const cat = q.get('category');
  const zoneId = q.get('zone');
  const st = q.get('status');
  const text = (q.get('q') ?? '').toLowerCase();
  return live()
    .filter(
      (d) => !zoneId || d.zone === zoneId || d.zone === ZONES.find((z) => z.id === zoneId)?.gh,
    )
    .filter((d) => !cat || CAT_FILTER[cat]?.(d))
    .filter((d) => !st || STATUS_FILTER[st]?.(d))
    .filter(
      (d) =>
        !text ||
        `${d.id} ${d.type} ${d.brand} ${d.model} ${d.zone} ${d.serial}`
          .toLowerCase()
          .includes(text),
    )
    .map((d) => row(d, now));
}

export function summary() {
  const f = live();
  return {
    registered: f.length,
    online: f.filter((d) => ['Online', 'Docked'].includes(statusOf(d))).length,
    offline: f.filter((d) => d.status === 'Offline').length,
    service_due_14d: f.filter(STATUS_FILTER.due14!).length,
    isolated_paused_off: f.filter((d) => d.mode !== 'on').length,
    pending_approval: f.filter((d) => d.lifecycle === 'PENDING').length,
    categories: {
      all: f.length,
      sensor: f.filter(CAT_FILTER.sensor!).length,
      camera: f.filter(CAT_FILTER.camera!).length,
      actuator: f.filter(CAT_FILTER.actuator!).length,
      robot: f.filter(CAT_FILTER.robot!).length,
    },
  };
}

/** Sidebar counter (design): offline, overdue for service, or waiting for approval. */
export const attentionCount = () =>
  live().filter((d) => d.status === 'Offline' || (dueDays(d) ?? 0) < 0 || d.lifecycle === 'PENDING')
    .length;

const find = (id: string) => {
  const d = fleet.find((x) => x.id === id && x.lifecycle !== 'RETIRED');
  if (!d) throw new MockError(404, 'not_found', `Device ${id} not found.`);
  return d;
};

export const get = (now: Date, id: string, a: Actor) => detail(find(id), now, a);

function refuse(av: { allowed: boolean; reason: string | null }, perm: string, a: Actor) {
  if (av.allowed) return;
  const forbidden = !can(a, perm);
  throw new MockError(
    forbidden ? 403 : 409,
    forbidden ? 'forbidden' : 'invalid_state',
    av.reason ?? 'Not allowed.',
  );
}

const MSG: Record<Mode, (d: Dev) => string> = {
  on: (d) => `${d.id} reconnected. Readings flow to the platform and Lefi AI again.`,
  ai: (d) => `${d.id} isolated from Lefi AI. Crew still see its readings; AI decisions ignore it.`,
  paused: (d) => `${d.id} readings paused. Device stays powered; dashboards show “paused”.`,
  off: (d) => `${d.id} powered off.`,
};

export function setMode(now: Date, id: string, a: Actor, mode: string) {
  const d = find(id);
  if (!['on', 'ai', 'paused', 'off'].includes(mode))
    throw new MockError(422, 'invalid_mode', 'Unknown mode.');
  const m = mode as Mode;
  if (m === 'off')
    throw new MockError(
      409,
      'not_supported',
      availability(d, a).modes.off.reason ?? 'Not available.',
    );
  refuse(availability(d, a).modes[m], 'device.ai', a);
  d.mode = m;
  d.hist.unshift([
    0,
    `Mode → ${m === 'on' ? 'Connected' : m === 'ai' ? 'AI isolated' : 'Readings paused'}`,
    a.name,
  ]);
  return { item: detail(d, now, a), message: MSG[m](d) };
}

export function scheduleMaintenance(now: Date, id: string, a: Actor) {
  const d = find(id);
  refuse(availability(d, a).actions.schedule_maintenance, 'device.manage', a);
  const overdue = (dueDays(d) ?? 0) < 0;
  const zone = ZONES.some((z) => z.id === d.zone)
    ? d.zone
    : (ZONES.find((z) => z.gh === d.gh)?.id ?? 'GH1-Z1');
  const task = addTask({
    title: `Maintenance · ${d.id} (${d.type})`,
    zone,
    assignee: d.cat === 'camera' ? 'Tyler Brooks' : 'Luis Ortega',
    due: overdue ? 'Today 15:00' : 'Oct 30',
    priority: overdue ? 'High' : 'Normal',
    status: 'Open',
  });
  d.hist.unshift([0, `Maintenance scheduled (${task.id})`, a.name]);
  return { item: detail(d, now, a), message: `${task.id} created for ${d.id}.` };
}

export function decide(now: Date, id: string, a: Actor, approve: boolean) {
  const d = find(id);
  refuse(availability(d, a).actions[approve ? 'approve' : 'reject'], 'device.manage', a);
  if (approve) {
    d.lifecycle = 'ACTIVE';
    d.status = 'Online';
    d.mode = 'ai'; // validation period: visible to crew, not to AI
    d.interval = 90;
    d.age = 0;
    d.hist.unshift([0, 'Approved — starts AI isolated for validation', a.name]);
    return {
      item: detail(d, now, a),
      message: `${d.id} approved. It starts AI-isolated while its readings are validated.`,
    };
  }
  d.lifecycle = 'RETIRED';
  return {
    item: null,
    message: `${d.id} rejected. Its credentials are revoked and it will not be shown again.`,
  };
}

export function register(now: Date, a: Actor, body: Record<string, string>) {
  if (!can(a, 'device.manage'))
    throw new MockError(403, 'forbidden', `Requires permission: ${LABEL['device.manage']}`);
  const FIELD: Record<string, string> = {
    type: 'device type',
    brand: 'brand',
    model: 'model',
    serial: 'serial number',
    zone_id: 'zone',
  };
  const need = Object.keys(FIELD).filter((k) => !String(body[k] ?? '').trim());
  if (need.length)
    throw new MockError(422, 'missing_fields', `Missing: ${need.map((k) => FIELD[k]).join(', ')}.`);
  const serial = String(body.serial).trim();
  const dup = fleet.find(
    (d) => d.serial.toLowerCase() === serial.toLowerCase() && d.lifecycle !== 'RETIRED',
  );
  if (dup)
    throw new MockError(
      409,
      'duplicate_serial',
      `Serial ${serial} is already registered as ${dup.id}.`,
    );
  const interval = Number(body.interval_days ?? 90);
  if (!Number.isInteger(interval) || interval < 1 || interval > 3650)
    throw new MockError(
      422,
      'invalid_interval',
      'Service interval must be a whole number of days from 1 to 3650.',
    );
  const z = ZONES.find((x) => x.id === body.zone_id);
  if (!z) throw new MockError(422, 'invalid_zone', 'Choose a zone.');
  const pre =
    {
      'Temp / RH probe': 'TH',
      'PAR light sensor': 'PAR',
      'Substrate moisture': 'SM',
      'pH probe': 'PH',
      'EC / TDS probe': 'EC',
      'CO₂ sensor': 'CO2',
      'Vision camera': 'CAM',
    }[body.type ?? ''] ?? 'DEV';
  const id = `${pre}-${z.id}-0${2 + fleet.filter((d) => d.id.startsWith(`${pre}-${z.id}`)).length}`;
  const d: Dev = {
    id,
    cat: pre === 'CAM' ? 'camera' : 'sensor',
    type: body.type ?? 'Sensor',
    brand: body.brand!.trim(),
    model: body.model!.trim(),
    serial: body.serial!.trim(),
    gh: z.gh,
    zone: z.id,
    pos: body.position?.trim() || 'Not set',
    proto: body.protocol || 'LoRaWAN',
    fw: body.firmware?.trim() || '—',
    signal: '—',
    battery: '—',
    seen: 'Never',
    status: 'Pending approval',
    interval,
    age: null,
    installedDaysAgo: 0,
    warrantyInDays: 0,
    power: 'None',
    hist: [[0, 'Registered manually — waiting for its first announce', a.name]],
    mode: 'ai',
    lifecycle: 'PENDING',
  };
  fleet.push(d);
  return {
    item: row(d, now),
    message: `${id} registered as PENDING. It becomes active after it announces itself and is approved.`,
  };
}

/** Devices installed in a zone (registry rows), for Zones & Inventory. */
export const inZone = (now: Date, zoneId: string) =>
  live()
    .filter((d) => d.zone === zoneId)
    .map((d) => row(d, now));

/** Robots and drones based in a greenhouse. */
export const robotsIn = (now: Date, gh: string) =>
  live()
    .filter((d) => (d.cat === 'robot' || d.cat === 'drone') && d.gh === gh)
    .map((d) => row(d, now));

/** Light rows for the global search. */
export const searchRows = () =>
  live().map((d) => ({
    id: d.id,
    type: d.type,
    zone: d.zone,
    brand: d.brand,
    model: d.model,
    serial: d.serial,
  }));
