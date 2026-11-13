/**
 * Dataset reproduced from the design prototype
 * ("Lefi Crop AI Main" = "Lefi Crop Phase 2") so the UI can be compared with the design.
 * EVERYTHING HERE IS FAKE: the operation, people, numbers and readings are prototype
 * content, served only by this development mock with `origin: SIMULATED`.
 */

export const ROLES = [
  {
    id: 'admin',
    name: 'System Administrator',
    short: 'Sys Admin',
    user: 'Priya Raman',
    color: '#163D32',
  },
  {
    id: 'manager',
    name: 'Greenhouse Manager',
    short: 'Manager',
    user: 'Daniel Tremblay',
    color: '#2E6B57',
  },
  {
    id: 'grower',
    name: 'Grower / Crop Manager',
    short: 'Grower',
    user: 'Sofia Marchetti',
    color: '#3F8F5E',
  },
  {
    id: 'supervisor',
    name: 'Greenhouse Supervisor',
    short: 'Supervisor',
    user: 'Marcus Okafor',
    color: '#7A4A22',
  },
  {
    id: 'scout',
    name: 'Crop Scout / Plant Health Technician',
    short: 'Crop Scout',
    user: 'Hana Kim',
    color: '#3C7EA6',
  },
  {
    id: 'maint',
    name: 'Irrigation / Maintenance Technician',
    short: 'Maintenance',
    user: 'Luis Ortega',
    color: '#8A6D1E',
  },
  {
    id: 'worker',
    name: 'Greenhouse Worker',
    short: 'Worker',
    user: 'Amrit Gill',
    color: '#5E6B65',
  },
] as const;

export type RoleId = (typeof ROLES)[number]['id'];
const ALL: RoleId[] = ROLES.map((r) => r.id);
const NOTW = ALL.filter((r) => r !== 'worker');

/** Permission → roles, as in the prototype's RBAC matrix (navigation + STOP AI). */
export const PERMS: Record<string, RoleId[]> = {
  'nav.dashboard': NOTW,
  'nav.greenhouses': ALL,
  'nav.zones': NOTW,
  'nav.environment': ALL,
  'nav.plantHealth': ['admin', 'manager', 'grower', 'supervisor', 'scout'],
  'nav.alerts': NOTW,
  'nav.robots': NOTW,
  'nav.tasks': ALL,
  'nav.handover': NOTW,
  'nav.escalation': ['admin', 'manager', 'supervisor'],
  'nav.devices': ['admin', 'manager', 'supervisor', 'maint'],
  'nav.aiControl': ['admin', 'manager', 'grower', 'supervisor', 'maint'],
  'nav.knowledge': ALL,
  'nav.workforce': ['admin', 'manager', 'supervisor'],
  'nav.admin': ['admin', 'manager', 'maint'],
  'ai.halt': ['admin', 'manager', 'grower', 'supervisor', 'maint'],
  'device.ai': ['admin', 'manager'],
  'device.power': ['admin', 'maint'],
  'device.manage': ['admin', 'maint'],
  'env.configure': ['admin', 'grower', 'maint'],
  'knowledge.view': ALL,
  'knowledge.edit': ['admin', 'manager', 'grower'],
  'knowledge.approve': ['admin'],
  'env.pump': ['admin', 'grower', 'maint'],
  'ai.confirm': ['admin', 'grower', 'scout'],
  'ai.request': ['admin', 'manager', 'grower', 'supervisor', 'scout'],
  'ai.chat': ALL,
  'task.all': NOTW,
  'task.assign': ['admin', 'manager', 'supervisor'],
  'task.verify': ['admin', 'manager', 'supervisor'],
  'ai.resume': ['admin', 'manager'],
  'ai.autonomy': ['admin'],
  'robot.command': ['admin', 'manager', 'supervisor', 'grower'],
  'robot.camera': ['admin', 'manager', 'supervisor', 'grower', 'scout'],
  'robot.queue': ['admin', 'manager', 'supervisor'],
  'handover.sign': ['admin', 'manager', 'supervisor'],
  'handover.ack': ['admin', 'manager', 'supervisor'],
  'escalation.edit': ['admin', 'manager'],
  'escalation.oncall': ['admin', 'manager'],
  'user.manage': ['admin'],
  'shift.edit': ['admin', 'manager', 'supervisor'],
  'zone.all': NOTW,
  'zone.manage': ['admin', 'manager'],
  'batch.edit': ['admin', 'manager', 'grower'],
  'plant.observe': ['admin', 'grower', 'supervisor', 'scout'],
  'admin.roles': ['admin', 'manager'],
  'admin.devices': ['admin', 'manager', 'maint'],
  'admin.config': ['admin'],
  'admin.audit': ['admin', 'manager'],
  'incident.ack': ['admin', 'manager', 'supervisor', 'grower', 'scout', 'maint'],
  'incident.assign': ['admin', 'manager', 'supervisor'],
  'incident.resolve': ['admin', 'manager', 'supervisor', 'grower', 'maint'],
  'incident.close': ['admin', 'manager', 'supervisor'],
  'incident.report': ALL,
};

export const email = (n: string) =>
  n
    .toLowerCase()
    .replace(/[^a-z\s-]/g, '')
    .replace(/\s+/g, '.') + '@leficrop.ca';

export const ZONES = [
  {
    id: 'GH1-Z1',
    gh: 'GH-1',
    name: 'Bay A',
    crop: 'Green Butterhead',
    plants: 54200,
    health: 94,
    temp: 21.3,
    rh: 66,
    ppfd: 405,
    moist: 56,
    ph: 5.92,
    ec: 1.54,
  },
  {
    id: 'GH1-Z2',
    gh: 'GH-1',
    name: 'Bay B',
    crop: 'Red Oakleaf',
    plants: 53800,
    health: 83,
    temp: 21.8,
    rh: 73,
    ppfd: 398,
    moist: 58,
    ph: 5.88,
    ec: 1.62,
  },
  {
    id: 'GH1-Z3',
    gh: 'GH-1',
    name: 'Bay C',
    crop: 'Lollo Rosso',
    plants: 52600,
    health: 92,
    temp: 21.1,
    rh: 67,
    ppfd: 412,
    moist: 54,
    ph: 5.95,
    ec: 1.58,
  },
  {
    id: 'GH1-Z4',
    gh: 'GH-1',
    name: 'Bay D',
    crop: 'Baby Romaine',
    plants: 51800,
    health: 90,
    temp: 21.5,
    rh: 65,
    ppfd: 420,
    moist: 53,
    ph: 6.01,
    ec: 1.49,
  },
  {
    id: 'GH2-Z1',
    gh: 'GH-2',
    name: 'Gutter block 1',
    crop: 'Spring Mesclun Mix',
    plants: 57400,
    health: 88,
    temp: 22.4,
    rh: 70,
    ppfd: 388,
    moist: 55,
    ph: 5.84,
    ec: 1.66,
  },
  {
    id: 'GH2-Z2',
    gh: 'GH-2',
    name: 'Gutter block 2',
    crop: 'Green Oakleaf',
    plants: 56100,
    health: 80,
    temp: 23.1,
    rh: 77,
    ppfd: 375,
    moist: 57,
    ph: 5.9,
    ec: 1.71,
  },
  {
    id: 'GH2-Z3',
    gh: 'GH-2',
    name: 'Gutter block 3',
    crop: 'Red Butterhead',
    plants: 54800,
    health: 68,
    temp: 23.6,
    rh: 74,
    ppfd: 366,
    moist: null,
    ph: 5.79,
    ec: 2.31,
  },
  {
    id: 'GH3-P1',
    gh: 'GH-3',
    name: 'Bench row 1–12',
    crop: 'Seedlings · green varieties',
    plants: 58300,
    health: 96,
    temp: 20.4,
    rh: 74,
    ppfd: 220,
    moist: 62,
    ph: 5.86,
    ec: 1.18,
  },
  {
    id: 'GH3-P2',
    gh: 'GH-3',
    name: 'Bench row 13–24',
    crop: 'Seedlings · red varieties',
    plants: 47200,
    health: 94,
    temp: 20.1,
    rh: 73,
    ppfd: 210,
    moist: 61,
    ph: 5.82,
    ec: 1.21,
  },
];

export const GREENHOUSES = [
  { id: 'GH-1', name: 'North Range' },
  { id: 'GH-2', name: 'South Range' },
  { id: 'GH-3', name: 'Propagation House' },
];

export const METRICS = [
  {
    k: 'temp',
    label: 'Air temperature',
    unit: '°C',
    icon: 'thermostat',
    dec: 1,
    amp: 2.2,
    noise: 0.5,
    range: [18, 24],
  },
  {
    k: 'rh',
    label: 'Relative humidity',
    unit: '%',
    icon: 'humidity_percentage',
    dec: 0,
    amp: 5,
    noise: 2,
    range: [60, 75],
  },
  {
    k: 'ppfd',
    label: 'Light intensity',
    unit: 'µmol/m²/s',
    icon: 'light_mode',
    dec: 0,
    amp: 160,
    noise: 30,
    range: [200, 450],
  },
  {
    k: 'moist',
    label: 'Substrate moisture',
    unit: '% VWC',
    icon: 'water_drop',
    dec: 0,
    amp: 4,
    noise: 2,
    range: [45, 65],
  },
  {
    k: 'ph',
    label: 'pH',
    unit: 'pH',
    icon: 'science',
    dec: 2,
    amp: 0.1,
    noise: 0.05,
    range: [5.6, 6.2],
  },
  {
    k: 'ec',
    label: 'EC / TDS',
    unit: 'mS/cm',
    icon: 'bolt',
    dec: 2,
    amp: 0.07,
    noise: 0.04,
    range: [1.2, 1.8],
  },
] as const;

export const ALERTS = [
  {
    id: 'INC-0186',
    severity: 'critical',
    title: 'EC above operating range — 2.31 mS/cm',
    zone: 'GH2-Z3',
    at: '08:40',
    icon: 'bolt',
  },
  {
    id: 'INC-0182',
    severity: 'critical',
    title: 'Substrate moisture probe offline',
    zone: 'GH2-Z3',
    at: '06:12',
    icon: 'wifi_off',
  },
  {
    id: 'INC-0185',
    severity: 'warning',
    title: 'Relative humidity 77 % (max 75 %)',
    zone: 'GH2-Z2',
    at: '09:15',
    icon: 'humidity_percentage',
  },
  {
    id: 'INC-0184',
    severity: 'warning',
    title: 'AI flagged possible tipburn · 87 %',
    zone: 'GH1-Z2',
    at: '07:54',
    icon: 'psychiatry',
  },
] as const;

export const TASKS = [
  {
    id: 'T-1174',
    title: 'Replace HAF fan belt — Zone B fan 2',
    zone: 'GH1-Z2',
    assignee: 'Luis Ortega',
    due: 'Today 09:00',
    priority: 'High',
    status: 'Awaiting verification',
  },
  {
    id: 'T-1184',
    title: 'Inspect tipburn flag — raft rows 14–18',
    zone: 'GH1-Z2',
    assignee: 'Hana Kim',
    due: 'Today 11:00',
    priority: 'High',
    status: 'Open',
  },
  {
    id: 'T-1183',
    title: 'Harvest batch B-2611 (Green Butterhead)',
    zone: 'GH1-Z1',
    assignee: 'Amrit Gill',
    due: 'Today 13:00',
    priority: 'High',
    status: 'In progress',
  },
  {
    id: 'T-1182',
    title: 'Replace substrate moisture probe SM-GH2-Z3-02',
    zone: 'GH2-Z3',
    assignee: 'Luis Ortega',
    due: 'Today 10:30',
    priority: 'Critical',
    status: 'Open',
  },
  {
    id: 'T-1181',
    title: 'Pull 5 plants for root inspection',
    zone: 'GH2-Z3',
    assignee: 'Sofia Marchetti',
    due: 'Today 12:00',
    priority: 'Critical',
    status: 'Open',
  },
  {
    id: 'T-1180',
    title: 'Clean raft row 9 and re-seat plugs',
    zone: 'GH1-Z3',
    assignee: 'Amrit Gill',
    due: 'Today 15:00',
    priority: 'Normal',
    status: 'Open',
  },
  {
    id: 'T-1179',
    title: 'Flush and recalibrate EC dosing — tank B',
    zone: 'GH2-Z3',
    assignee: 'Luis Ortega',
    due: 'Today 11:30',
    priority: 'High',
    status: 'Open',
  },
  {
    id: 'T-1178',
    title: 'Sticky-trap count — gutter block 2',
    zone: 'GH2-Z2',
    assignee: 'Hana Kim',
    due: 'Today 14:00',
    priority: 'Normal',
    status: 'Open',
  },
  {
    id: 'T-1177',
    title: 'Check raft float levels after topping-up',
    zone: 'GH1-Z2',
    assignee: 'Amrit Gill',
    due: 'Today 10:00',
    priority: 'Normal',
    status: 'Open',
  },
] as const;

/** [name, role, status] — the prototype's crew. */
export const CREW: Array<[string, RoleId, string]> = [
  ['Priya Raman', 'admin', 'On shift'],
  ['Daniel Tremblay', 'manager', 'On shift'],
  ['Sofia Marchetti', 'grower', 'On shift'],
  ['Marcus Okafor', 'supervisor', 'On shift'],
  ['Owen MacLeod', 'supervisor', 'Off shift'],
  ['Hana Kim', 'scout', 'On shift'],
  ['Fatima Haddad', 'scout', 'Off shift'],
  ['Luis Ortega', 'maint', 'On shift'],
  ['Tyler Brooks', 'maint', 'Off shift'],
  ['Amrit Gill', 'worker', 'On shift'],
  ['Mei Chen', 'worker', 'On shift'],
  ['Jean-Luc Gagnon', 'worker', 'On break'],
  ['Grace Nwosu', 'worker', 'PTO'],
];

export const ACTIVITY = [
  { time: '09:38', who: 'Hana Kim', what: 'started inspection T-1184 in GH1-Z2' },
  { time: '09:31', who: 'Sofia Marchetti', what: 'narrowed RH range to 60–75 %' },
  { time: '09:05', who: 'Amrit Gill', what: 'began harvest of B-2611' },
  { time: '08:47', who: 'Luis Ortega', what: 'acknowledged probe offline alert' },
];

export const FOCUS: Record<RoleId, Array<[string, string, 'crit' | 'warn' | 'ok' | 'info']>> = {
  admin: [
    ['1 device offline · GH2-Z3', 'devices', 'crit'],
    ['Role change logged today', 'admin', 'info'],
    ['13 active users', 'workforce', 'ok'],
  ],
  manager: [
    ['2 critical alerts · GH2-Z3', 'environment', 'crit'],
    ['B-2611 harvest-ready', 'greenhouses', 'ok'],
    ['2 AI detections to review', 'plantHealth', 'warn'],
  ],
  grower: [
    ['2 AI detections to review', 'plantHealth', 'warn'],
    ['EC drift · GH2-Z3', 'environment', 'crit'],
    ['2 batches entering harvest', 'greenhouses', 'ok'],
  ],
  supervisor: [
    ['8 open crew tasks', 'tasks', 'warn'],
    ['9 of 10 day crew on site', 'workforce', 'ok'],
    ['Evening shift starts 14:00', 'workforce', 'info'],
  ],
  scout: [
    ['2 inspections booked today', 'tasks', 'warn'],
    ['2 detections awaiting review', 'plantHealth', 'warn'],
  ],
  maint: [
    ['Probe offline · GH2-Z3', 'environment', 'crit'],
    ['EC dosing recalibration', 'tasks', 'warn'],
  ],
  worker: [],
};

export const AI_SUMMARY =
  'Overall health is stable at **89**. **South Range Zone 3** needs attention: EC has drifted to 2.31 mS/cm and its substrate-moisture probe went offline at 06:12, so substrate moisture in that zone is not being measured. Possible **tipburn** on Red Oakleaf in North Range Zone 2 correlates with 73–78 % overnight humidity — scouting is booked for 11:00. Batch **B-2611** is harvest-ready today.';

export const BRIEFING = {
  happened:
    'A steady day shift. Two incidents in South Range Zone 3 — an EC drift and an offline moisture probe — were handled by maintenance.',
  why: 'The EC drift in GH2-Z3 followed a dosing-pump overshoot on tank B.',
  done: [
    'Dosing on tank B recalibrated (T-1179 in progress)',
    'Probe replacement scheduled (T-1182)',
    'Tipburn scouting T-1184 booked for 11:00',
  ],
  next: [
    'Watch Zone B substrate moisture through the evening',
    'Re-check EC in GH2-Z3 after the flush (target 1.2–1.8 mS/cm)',
  ],
};

/** The prototype's deterministic pseudo-random series. */
function rng(seed: number) {
  let r = (seed * 7919) % 233280;
  return () => {
    r = (r * 9301 + 49297) % 233280;
    return r / 233280;
  };
}

export function series(
  n: number,
  base: number,
  amp: number,
  noise: number,
  seed: number,
  cycles = 1,
  phase = 0,
) {
  const r = rng(seed);
  return Array.from(
    { length: n },
    (_, i) =>
      base + amp * Math.sin((i / (n - 1)) * Math.PI * 2 * cycles + phase) + (r() - 0.5) * noise,
  );
}
