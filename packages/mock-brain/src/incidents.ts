/**
 * Mock incident store: the prototype's incidents (design INC0), a state machine and the
 * prototype's RBAC. FAKE data — every record is `origin: SIMULATED`. In the real system these
 * rules live in the Brain; the desktop app only renders what it is told.
 */
import { ZONES, type RoleId } from './design-data.ts';
// Permissions come from design-data.ts PERMS (the prototype's RBAC matrix).

type Sev = 'critical' | 'warning' | 'info';
type Status = 'New' | 'Acknowledged' | 'Investigating' | 'Resolved' | 'Closed';

interface Rec {
  id: string;
  ts: string; // design clock "YYYY-MM-DD HH:MM"
  zone: string;
  area: string;
  plant: string | null;
  title: string;
  sev: Sev;
  src: string;
  conf: number | null;
  status: Status;
  assignee: string | null;
  ackMin: number | null;
  evidence: string[];
  actions: string[]; // "HH:MM text"
  esc: Array<[string, string, string]>;
  missions: string[];
  rec: string;
  resolution: string | null;
}

const RECS: Rec[] = [
  {
    id: 'INC-0186',
    ts: '2026-10-28 08:40',
    zone: 'GH2-Z3',
    area: 'South Range · Gutter block 3',
    plant: null,
    title: 'EC above operating range (2.31 mS/cm)',
    sev: 'critical',
    src: 'Automatic · sensor',
    conf: 99,
    status: 'Acknowledged',
    assignee: 'Luis Ortega',
    ackMin: 7,
    evidence: [
      'EC-GH2-Z3-01 reads 2.31 mS/cm (max 1.8) for 62 min',
      'Dosing pump B duty cycle 38 % above recipe',
    ],
    actions: [
      '08:41 Push sent to Marcus Okafor (delivered)',
      '08:47 Acknowledged by Luis Ortega',
      '09:05 Work order T-1179 created: flush & recalibrate dosing',
    ],
    esc: [
      ['08:40', 'L1 · Push → Greenhouse Supervisor', 'Delivered'],
      ['08:47', 'Acknowledged in 7 min', 'No escalation'],
    ],
    missions: [],
    rec: 'Flush gutter block 3 with fresh solution at 1.4 mS/cm and recalibrate EC dosing on tank B. Re-check in 2 h.',
    resolution: null,
  },
  {
    id: 'INC-0185',
    ts: '2026-10-28 09:15',
    zone: 'GH2-Z2',
    area: 'South Range · Gutter block 2',
    plant: null,
    title: 'Relative humidity 77 % (max 75 %)',
    sev: 'warning',
    src: 'Automatic · sensor',
    conf: 97,
    status: 'Investigating',
    assignee: 'Marcus Okafor',
    ackMin: 4,
    evidence: ['TH-GH2-Z2-01: 77 % RH, rising 1.2 %/h', 'Vent position 12 % (setpoint 20 %)'],
    actions: [
      '09:15 Push → Marcus Okafor',
      '09:19 Acknowledged',
      '09:24 Vent actuator check requested',
    ],
    esc: [
      ['09:15', 'L1 · Push → Greenhouse Supervisor', 'Delivered'],
      ['09:19', 'Acknowledged in 4 min', 'No escalation'],
    ],
    missions: [],
    rec: 'Open vents to 20 % and run HAF fans overnight. Check vent actuator VA-GH2-02 for stalling.',
    resolution: null,
  },
  {
    id: 'INC-0184',
    ts: '2026-10-28 07:54',
    zone: 'GH1-Z2',
    area: 'North Range · Zone B',
    plant: 'P-0412',
    title: 'Possible leaf-margin tipburn',
    sev: 'warning',
    src: 'Automatic · vision AI',
    conf: 87,
    status: 'Acknowledged',
    assignee: 'Hana Kim',
    ackMin: 11,
    evidence: [
      'Necrotic margins on 3 inner leaves (AI-1028-0142)',
      'Night RH 73–78 % for 3 nights',
    ],
    actions: [
      '07:54 Detection from mission M-1042',
      '08:05 Acknowledged by Hana Kim',
      '08:06 Scouting task T-1184 created',
    ],
    esc: [
      ['07:54', 'L1 · Push → Greenhouse Supervisor', 'Delivered'],
      ['08:05', 'Acknowledged in 11 min', 'No escalation'],
    ],
    missions: ['M-1042'],
    rec: 'Scout 20 plants in rows 14–18; increase overnight airflow and verify Ca in solution.',
    resolution: null,
  },
  {
    id: 'INC-0182',
    ts: '2026-10-28 06:12',
    zone: 'GH2-Z3',
    area: 'South Range · Gutter block 3',
    plant: null,
    title: 'Substrate moisture probe offline',
    sev: 'warning',
    src: 'Automatic · device',
    conf: 100,
    status: 'Investigating',
    assignee: 'Luis Ortega',
    ackMin: 18,
    evidence: ['SM-GH2-Z3-02 heartbeat lost at 06:12', 'Battery 9 % at last report'],
    actions: [
      '06:12 Push → Owen MacLeod (night supervisor)',
      '06:30 Acknowledged by Luis Ortega',
      '08:47 Replacement task T-1182 created',
    ],
    esc: [
      ['06:12', 'L1 · Push → Greenhouse Supervisor', 'Delivered'],
      ['06:27', 'L2 · Push → Maintenance on-call', 'Delivered'],
      ['06:30', 'Acknowledged in 18 min', 'Escalation stopped'],
    ],
    missions: [],
    rec: 'Replace probe and battery pack; until then substrate moisture in GH2-Z3 is not measured — check it by hand.',
    resolution: null,
  },
  {
    id: 'INC-0183',
    ts: '2026-10-28 00:00',
    zone: 'GH-1 · GH-2',
    area: 'North & South Range',
    plant: null,
    title: 'pH values simulated — probes not installed',
    sev: 'info',
    src: 'Automatic · system',
    conf: null,
    status: 'New',
    assignee: 'Priya Raman',
    ackMin: null,
    evidence: ['No LC-PH4 probe registered in 7 zones'],
    actions: ['00:00 Shown on dashboard only (informational)'],
    esc: [['00:00', 'Dashboard only', 'Informational rule']],
    missions: [],
    rec: 'Install pH probes to replace model estimates before relying on pH alerts.',
    resolution: null,
  },
  {
    id: 'INC-0181',
    ts: '2026-10-27 15:20',
    zone: 'GH1-Z3',
    area: 'North Range · Zone C',
    plant: null,
    title: 'Broken raft float — row 9',
    sev: 'warning',
    src: 'Manual report · Amrit Gill',
    conf: null,
    status: 'Resolved',
    assignee: 'Amrit Gill',
    ackMin: 3,
    evidence: ['Photo from worker mobile: cracked float at R9-14'],
    actions: [
      '15:20 Reported by Amrit Gill',
      '15:23 Acknowledged by Marcus Okafor',
      '16:10 Float replaced',
    ],
    esc: [
      ['15:20', 'L1 · Push → Greenhouse Supervisor', 'Delivered'],
      ['15:23', 'Acknowledged in 3 min', 'No escalation'],
    ],
    missions: [],
    rec: 'Replace float and check adjacent rafts for buoyancy loss.',
    resolution: 'Float replaced; 6 plants re-seated. Photo IMG-4741 attached.',
  },
  {
    id: 'INC-0179',
    ts: '2026-10-26 08:20',
    zone: 'GH1-Z3',
    area: 'North Range · Zone C',
    plant: 'P-0426',
    title: 'Downy mildew confirmed — 46 plants',
    sev: 'critical',
    src: 'Automatic · vision AI',
    conf: 91,
    status: 'Closed',
    assignee: 'Sofia Marchetti',
    ackMin: 5,
    evidence: ['Angular lesions + sporulation (AI-1026-0088)', 'Leaf wetness > 6 h on Oct 24–25'],
    actions: [
      '08:20 Push + SMS → Supervisor',
      '08:25 Acknowledged by Marcus Okafor',
      '10:05 Diagnosis confirmed by Sofia Marchetti',
      '11:30 46 plants removed',
    ],
    esc: [
      ['08:20', 'L1 · Push + SMS → Supervisor', 'Delivered'],
      ['08:25', 'Acknowledged in 5 min', 'No escalation'],
    ],
    missions: ['M-1037'],
    rec: 'Remove affected plants, lower dehumidification setpoint, re-scan Oct 29.',
    resolution:
      '46 plants removed and composted off-site. RH setpoint lowered to 70 %. Re-scan M-1045 queued.',
  },
];

const store: Rec[] = RECS.map((r) => ({ ...r, actions: [...r.actions] }));
const OPEN: Status[] = ['New', 'Acknowledged', 'Investigating'];
const DESIGN_NOW = Date.parse('2026-10-28T09:42:00');

/** Shifts a design-clock timestamp so it keeps its distance from "now". */
const shift = (now: Date, designTs: string) =>
  new Date(now.getTime() - (DESIGN_NOW - Date.parse(designTs.replace(' ', 'T'))));
const hhmm = (d: Date) => d.toTimeString().slice(0, 5);
const shiftClock = (now: Date, rec: Rec, clock: string) =>
  hhmm(shift(now, `${rec.ts.slice(0, 10)} ${clock}`));

const PERM_LABEL: Record<string, string> = {
  'incident.ack': 'Acknowledge & investigate incidents',
  'incident.assign': 'Assign incidents',
  'incident.resolve': 'Resolve incidents',
  'incident.close': 'Close incidents',
  'incident.report': 'Report incidents manually',
};

export class MockError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface Actor {
  name: string;
  role: RoleId;
  permissions: string[];
}

function availability(r: Rec, a: Actor) {
  const need = (perm: string, okState: boolean, stateMsg: string) =>
    !a.permissions.includes(perm)
      ? { allowed: false, reason: `Requires permission: ${PERM_LABEL[perm]}` }
      : okState
        ? { allowed: true, reason: null }
        : { allowed: false, reason: stateMsg };
  return {
    acknowledge: need('incident.ack', r.status === 'New', `Already ${r.status.toLowerCase()}.`),
    investigate: need(
      'incident.ack',
      r.status === 'New' || r.status === 'Acknowledged',
      `Incident is already ${r.status.toLowerCase()}.`,
    ),
    resolve: need(
      'incident.resolve',
      OPEN.includes(r.status),
      `Already ${r.status.toLowerCase()}.`,
    ),
    close: need(
      'incident.close',
      r.status === 'Resolved',
      'Only resolved incidents can be closed.',
    ),
    assign: need(
      'incident.assign',
      r.status !== 'Closed',
      'Closed incidents cannot be reassigned.',
    ),
  };
}

function summaryRow(r: Rec, now: Date) {
  const manual = r.src.startsWith('Manual');
  return {
    id: r.id,
    detected_at: shift(now, r.ts).toISOString(),
    zone_id: ZONES.some((z) => z.id === r.zone) ? r.zone : null,
    zone_label: r.zone,
    area: r.area,
    plant_id: r.plant,
    title: r.title,
    severity: r.sev,
    source: { kind: manual ? 'manual' : 'automatic', label: r.src },
    ai_confidence: r.conf,
    status: r.status,
    assignee: r.assignee,
    origin: 'SIMULATED',
  };
}

function detail(r: Rec, now: Date, a: Actor) {
  return {
    ...summaryRow(r, now),
    ack_minutes: r.ackMin,
    evidence: r.evidence,
    recommendation: { text: r.rec, simulated: true },
    timeline: r.actions.map((x) => {
      const sp = x.indexOf(' ');
      return { time: shiftClock(now, r, x.slice(0, sp)), text: x.slice(sp + 1) };
    }),
    escalation: r.esc.map(([t, what, state]) => ({ time: shiftClock(now, r, t), what, state })),
    notifications: r.esc.map(([t, what, state]) => ({
      time: shiftClock(now, r, t),
      channel: what.includes('SMS')
        ? 'Push + SMS'
        : what.includes('Dashboard')
          ? 'Dashboard'
          : what.startsWith('Ack')
            ? 'Acknowledgement'
            : 'Mobile push',
      recipient: what.split('→ ')[1] ?? '—',
      status: state,
      ok: true,
    })),
    missions: r.missions,
    resolution: r.resolution,
    actions: availability(r, a),
  };
}

const find = (id: string) => {
  const r = store.find((x) => x.id === id);
  if (!r) throw new MockError(404, 'not_found', `Incident ${id} not found.`);
  return r;
};

export function list(now: Date, q: URLSearchParams) {
  const sev = q.get('severity');
  const st = q.get('status');
  const src = q.get('source');
  const text = (q.get('q') ?? '').toLowerCase();
  return store
    .filter((r) => !sev || r.sev === sev)
    .filter((r) => !st || (st === 'open' ? OPEN.includes(r.status) : r.status === st))
    .filter((r) => !src || (src === 'manual') === r.src.startsWith('Manual'))
    .filter(
      (r) =>
        !text || `${r.id} ${r.title} ${r.zone} ${r.assignee ?? ''}`.toLowerCase().includes(text),
    )
    .map((r) => summaryRow(r, now));
}

export function summary() {
  const open = store.filter((r) => OPEN.includes(r.status));
  const acks = store
    .map((r) => r.ackMin)
    .filter((m): m is number => m !== null)
    .sort((x, y) => x - y);
  return {
    open: open.length,
    critical_open: open.filter((r) => r.sev === 'critical').length,
    unacknowledged: store.filter((r) => r.status === 'New').length,
    median_ack_minutes: acks.length ? (acks[Math.floor(acks.length / 2)] ?? null) : null,
  };
}

export const openCount = () => store.filter((r) => OPEN.includes(r.status)).length;

export const get = (now: Date, id: string, a: Actor) => detail(find(id), now, a);

const ACTION_PERM = {
  acknowledge: 'incident.ack',
  investigate: 'incident.ack',
  resolve: 'incident.resolve',
  close: 'incident.close',
  assign: 'incident.assign',
} as const;

function guard(r: Rec, a: Actor, action: keyof typeof ACTION_PERM) {
  const av = availability(r, a)[action];
  if (av.allowed) return;
  const forbidden = !a.permissions.includes(ACTION_PERM[action]);
  throw new MockError(
    forbidden ? 403 : 409,
    forbidden ? 'forbidden' : 'invalid_state',
    av.reason ?? 'Not allowed.',
  );
}

export function transition(
  now: Date,
  id: string,
  a: Actor,
  body: { action?: string; note?: string },
) {
  const r = find(id);
  const action = body.action as 'acknowledge' | 'investigate' | 'resolve' | 'close';
  if (!['acknowledge', 'investigate', 'resolve', 'close'].includes(action)) {
    throw new MockError(422, 'invalid_action', 'Unknown action.');
  }
  guard(r, a, action);
  const t = hhmm(now);
  const designClock = (d: Date) => hhmm(new Date(DESIGN_NOW - (now.getTime() - d.getTime())));
  const log = (text: string) => r.actions.push(`${designClock(now)} ${text}`);
  let message: string;
  if (action === 'acknowledge') {
    r.status = 'Acknowledged';
    r.ackMin = Math.max(1, Math.round((now.getTime() - shift(now, r.ts).getTime()) / 60_000));
    log(`Acknowledged by ${a.name}`);
    message = `${r.id}: acknowledged at ${t}.`;
  } else if (action === 'investigate') {
    if (r.status === 'New')
      r.ackMin = Math.max(1, Math.round((now.getTime() - shift(now, r.ts).getTime()) / 60_000));
    r.status = 'Investigating';
    log(`Investigation started by ${a.name}`);
    message = `${r.id}: investigation started.`;
  } else if (action === 'resolve') {
    const note = (body.note ?? '').trim();
    if (note.length < 10)
      throw new MockError(
        422,
        'evidence_required',
        'Add resolution evidence (a short note) before resolving.',
      );
    r.status = 'Resolved';
    r.resolution = note;
    log(`Resolved by ${a.name}`);
    message = `${r.id}: resolved.`;
  } else {
    r.status = 'Closed';
    log(`Closed by ${a.name}`);
    message = `${r.id}: closed.`;
  }
  return { item: detail(r, now, a), message };
}

export function assign(now: Date, id: string, a: Actor, assignee: string, people: string[]) {
  const r = find(id);
  guard(r, a, 'assign');
  if (!people.includes(assignee))
    throw new MockError(422, 'unknown_person', `${assignee} is not on the roster.`);
  r.assignee = assignee;
  r.actions.push(`${hhmm(new Date(DESIGN_NOW))} Reassigned to ${assignee} by ${a.name}`);
  return { item: detail(r, now, a), message: `${r.id}: owner is now ${assignee}.` };
}

export function report(
  now: Date,
  a: Actor,
  body: { title?: string; zone_id?: string; severity?: string },
) {
  if (!a.permissions.includes('incident.report')) {
    throw new MockError(403, 'forbidden', `Requires permission: ${PERM_LABEL['incident.report']}`);
  }
  const title = String(body.title ?? '').trim();
  if (title.length < 5) throw new MockError(422, 'invalid_title', 'Describe the incident first.');
  const zone = ZONES.find((z) => z.id === body.zone_id);
  if (!zone) throw new MockError(422, 'invalid_zone', 'Choose a zone.');
  const sev =
    (['critical', 'warning', 'info'] as const).find((s) => s === body.severity) ?? 'warning';
  const id = `INC-0${188 + store.length - RECS.length}`;
  const designTs = new Date(DESIGN_NOW);
  const ts = `2026-10-28 ${hhmm(designTs)}`;
  const r: Rec = {
    id,
    ts,
    zone: zone.id,
    area: zone.name,
    plant: null,
    title,
    sev,
    src: `Manual report · ${a.name}`,
    conf: null,
    status: 'New',
    assignee: null,
    ackMin: null,
    evidence: [`Reported from the desktop admin by ${a.name}`],
    actions: [`${hhmm(designTs)} Reported by ${a.name}`],
    esc: [],
    missions: [],
    rec: 'No AI recommendation yet for manual reports.',
    resolution: null,
  };
  store.unshift(r);
  return {
    item: summaryRow(r, now),
    message: `${id} reported. It is in the open incident list for the on-shift supervisor.`,
  };
}

/** Light rows for the global search. */
export const searchRows = () =>
  store.map((r) => ({ id: r.id, title: r.title, zone: r.zone, status: r.status }));
