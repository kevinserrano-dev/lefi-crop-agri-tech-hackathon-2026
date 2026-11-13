/**
 * Simulated MH3-compatible robot LEFI-R1 for the Robot Mission Center (prototype geometry).
 * Everything here is SIMULATED: there is no physical robot and no AI. Missions support
 * cancel (safe stop + return), pause/resume, return to base and a timeout in every state.
 * Free-text commands go through a deterministic keyword parser (not AI), and are paused while
 * the AI kill switch is on; button commands are structured intents. Movement is validated:
 * RBAC, target policy (restricted zone), battery reserve, safe-hold after an emergency stop.
 */
import type { MockState } from './fixtures.ts';
import { MockError } from './incidents.ts';

interface Pt {
  x: number;
  y: number;
}
type Phase =
  | 'Idle'
  | 'Dispatched'
  | 'Navigating'
  | 'At destination'
  | 'Inspecting'
  | 'Returning'
  | 'Paused'
  | 'Completed'
  | 'Cancelled'
  | 'Failed';
interface Mission {
  id: string;
  title: string;
  origin: string;
  target: string;
  state: string;
  start: string;
  end: string;
  dist: string;
  photos: number;
  summary: string;
  log: Array<[string, string, string]>;
}

const DOCK: Pt = { x: 40, y: 280 };
const AISLE = 280;
const ZONES = [
  {
    id: 'A',
    gh: 'GH1-Z1',
    x: 90,
    y: 30,
    w: 380,
    h: 220,
    crop: 'Green Butterhead',
    restricted: false,
  },
  { id: 'B', gh: 'GH1-Z2', x: 530, y: 30, w: 430, h: 220, crop: 'Red Oakleaf', restricted: false },
  { id: 'C', gh: 'GH1-Z3', x: 90, y: 310, w: 380, h: 220, crop: 'Lollo Rosso', restricted: false },
  { id: 'D', gh: 'GH1-Z4', x: 530, y: 310, w: 430, h: 220, crop: 'Baby Romaine', restricted: true },
];
const REI = 'Zone D is under a spray re-entry interval until 14:00 (REI policy)';
const UNIT_M = 0.05; // map unit → metres
const SPEED_MPS = 0.6;
const TIMEOUT_S = 600;

function target(id: string) {
  if (id === 'Dock')
    return {
      id,
      x: DOCK.x,
      y: DOCK.y,
      lx: DOCK.x,
      zone: 'Dock',
      allowed: true,
      reason: null as string | null,
    };
  const m = /^([A-D])-0?(\d{1,2})$/.exec(id);
  if (!m) return null;
  const z = ZONES.find((q) => q.id === m[1])!;
  const max = Math.floor((z.w - 50) / 45) + 1;
  const n = Math.max(1, Math.min(Number(m[2]), max));
  const x = z.x + 35 + (n - 1) * 45;
  const y = z.y < 200 ? z.y + 80 : z.y + 140;
  return {
    id: `${z.id}-${String(n).padStart(2, '0')}`,
    x,
    y,
    lx: x - 22,
    zone: `Zone ${z.id}`,
    allowed: !z.restricted,
    reason: z.restricted ? REI : null,
  };
}

function routeTo(p: Pt, t: NonNullable<ReturnType<typeof target>>): Pt[] {
  const tx = t.id === 'Dock' ? t.x : t.lx;
  const r: Pt[] = [];
  if (Math.abs(p.y - AISLE) > 1) r.push({ x: p.x, y: AISLE });
  if (Math.abs(p.x - tx) > 1) r.push({ x: tx, y: AISLE });
  if (t.id === 'Dock') r.push({ x: DOCK.x, y: DOCK.y });
  else r.push({ x: tx, y: t.y });
  return r;
}
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const routeLen = (p: Pt, r: Pt[]) => r.reduce((acc, q, i) => acc + dist(i ? r[i - 1]! : p, q), 0);
const zoneOf = (p: Pt) =>
  dist(p, DOCK) < 4
    ? 'Dock'
    : ZONES.find((z) => p.x >= z.x - 25 && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h)
      ? `Zone ${ZONES.find((z) => p.x >= z.x - 25 && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h)!.id}`
      : 'Main aisle';
const clock = (d = new Date()) => d.toTimeString().slice(0, 5);

const sim = {
  speed: 1 as 1 | 2 | 4,
  pos: { ...DOCK },
  route: [] as Pt[],
  phase: 'Idle' as Phase,
  resumePhase: null as Phase | null,
  battery: 78,
  live: false,
  photos: [] as Array<{ id: string; label: string; time: string; by: string }>,
  mission: null as null | {
    id: string;
    title: string;
    origin: string;
    target: string;
    startedAt: number;
    elapsed: number;
    phaseT: number;
    travelled: number;
    photos: number;
    log: Array<[string, string, string]>;
    outcome: 'Completed' | 'Cancelled' | 'Failed' | null;
  },
  last: Date.now(),
  next: 1047,
};

const history: Mission[] = [
  {
    id: 'M-1042',
    title: 'Imaging run · Zone B (all rows)',
    origin: 'Scheduled · 07:15',
    target: 'B-01 → B-09',
    state: 'Completed',
    start: '07:16',
    end: '07:58',
    dist: '412 m',
    photos: 1240,
    summary:
      '1,240 images captured. 3 AI flags raised (tipburn, rows 14–18). No navigation incidents.',
    log: [
      ['07:15', 'Requested', 'Daily imaging schedule'],
      ['07:15', 'Queued', 'Policy checks passed'],
      ['07:16', 'Dispatched', 'Target B-01'],
      ['07:17', 'Navigating', 'Row sweep B-01 → B-09'],
      ['07:55', 'Returning', 'Sweep complete'],
      ['07:58', 'Completed', 'Docked'],
    ],
  },
  {
    id: 'M-1041',
    title: 'Spot inspection · Plant A-03',
    origin: 'Manual · Sofia Marchetti',
    target: 'A-03',
    state: 'Completed',
    start: 'Oct 27 15:40',
    end: '15:52',
    dist: '22 m',
    photos: 6,
    summary: 'Leaf colour normal; requested by grower after visual check. No action needed.',
    log: [
      ['15:40', 'Requested', 'Manual request'],
      ['15:41', 'Dispatched', 'Target A-03'],
      ['15:44', 'Inspecting', '6 photos'],
      ['15:52', 'Completed', 'Docked'],
    ],
  },
  {
    id: 'M-1040',
    title: 'Sticky-trap photo · Zone C row 7',
    origin: 'AI follow-up',
    target: 'C-07',
    state: 'Cancelled',
    start: 'Oct 27 13:05',
    end: '13:07',
    dist: '9 m',
    photos: 0,
    summary:
      'Cancelled by Marcus Okafor — crew harvesting in Zone C aisle. Robot performed a safe stop and returned to dock.',
    log: [
      ['13:05', 'Dispatched', 'Target C-07'],
      ['13:06', 'Navigating', ''],
      ['13:07', 'Cancelled', 'Safe stop · crew in aisle'],
      ['13:09', 'Returning', 'Docked 13:10'],
    ],
  },
  {
    id: 'M-1039',
    title: 'Imaging run · Zone D',
    origin: 'Scheduled',
    target: 'D-01 → D-09',
    state: 'Failed',
    start: 'Oct 27 07:15',
    end: '07:31',
    dist: '148 m',
    photos: 402,
    summary:
      'Wi-Fi link lost at D-06 for > 20 s. Robot held position per link-loss policy, then auto-returned. AP-GH1-04 replaced.',
    log: [
      ['07:15', 'Dispatched', ''],
      ['07:16', 'Navigating', ''],
      ['07:29', 'Failed', 'Link loss > 20 s at D-06'],
      ['07:31', 'Returning', 'Auto-return policy'],
    ],
  },
];

const queue = [
  {
    id: 'M-1044',
    title: 'Imaging run · Zone C (all rows)',
    origin: 'Scheduled',
    target: 'C-01 → C-08',
    priority: 'Normal',
  },
  {
    id: 'M-1045',
    title: 'Re-scan downy mildew · C-05',
    origin: 'AI follow-up · INC-0179',
    target: 'C-05',
    priority: 'Low',
  },
  {
    id: 'M-1046',
    title: 'Sticky-trap photo · Zone A row 2',
    origin: 'Manual · Hana Kim',
    target: 'A-02',
    priority: 'Low',
  },
];

const commands: Array<{
  id: number;
  time: string;
  who: string;
  via: string;
  text: string;
  intent: string;
  label: string;
  auth: 'allowed' | 'denied' | 'n/a';
  exec: 'Executed' | 'Rejected' | 'Not understood' | 'Paused';
  result: string;
  parser: string;
}> = [];

const INTENT: Record<string, { label: string; perm: string; move?: boolean }> = {
  'nav.goto': { label: 'Navigate & inspect', perm: 'robot.command', move: true },
  'nav.pause': { label: 'Pause navigation', perm: 'robot.command', move: true },
  'nav.resume': { label: 'Resume navigation', perm: 'robot.command', move: true },
  'nav.return': { label: 'Return to base', perm: 'robot.command', move: true },
  'mission.cancel': { label: 'Cancel mission (safe stop)', perm: 'robot.command', move: true },
  'camera.photo': { label: 'Capture photograph', perm: 'robot.camera' },
  'camera.video.start': { label: 'Start live video', perm: 'robot.camera' },
  'camera.video.stop': { label: 'Stop live video', perm: 'robot.camera' },
  'query.status': { label: 'Report robot status', perm: 'nav.robots' },
  'query.findings': { label: 'Summarise findings', perm: 'nav.robots' },
  unknown: { label: 'Not understood', perm: 'nav.robots' },
};

/** Deterministic keyword parser (prototype parseCmd). Not AI. */
function parse(raw: string): { intent: string; arg?: string | null } {
  const t = raw.toLowerCase();
  const pm = t.match(/\b(?:plant\s*)?([a-d])\s*-\s*0?(\d{1,2})\b/);
  const plant = pm ? `${pm[1]!.toUpperCase()}-${pm[2]!.padStart(2, '0')}` : null;
  const zm = t.match(/zone\s*([a-d])\b/);
  const zone = zm ? zm[1]!.toUpperCase() : null;
  if (/what.*(find|found|see)|findings|results?\b/.test(t)) return { intent: 'query.findings' };
  if (/\bcancel|abort/.test(t)) return { intent: 'mission.cancel' };
  if (/(stop|end|close).*(video|stream|live)/.test(t)) return { intent: 'camera.video.stop' };
  if (/(start|begin|open|show).*(video|stream)|live video|live view/.test(t))
    return { intent: 'camera.video.start' };
  if (/(picture|photo|image|snapshot|pic)\b/.test(t))
    return { intent: 'camera.photo', arg: plant ?? (zone ? `${zone}-03` : null) };
  if (/\bpause|hold on|\bwait\b/.test(t)) return { intent: 'nav.pause' };
  if (/resume|continue|carry on/.test(t)) return { intent: 'nav.resume' };
  if (/return|go back|go home|base|dock/.test(t)) return { intent: 'nav.return' };
  if (/status|battery|where are you/.test(t)) return { intent: 'query.status' };
  if ((plant || zone) && /(go|inspect|check|move|navigate|drive|visit|head)/.test(t))
    return { intent: 'nav.goto', arg: plant ?? `${zone}-03` };
  if (/\bstop\b/.test(t)) return { intent: 'mission.cancel' };
  return { intent: 'unknown' };
}

const active = () => sim.mission !== null && sim.mission.outcome === null;
/** Cancel was requested; the mission ends when the robot is back on the dock. */
const cancelled = () => !!sim.mission?.log.some(([, state]) => state === 'Cancelled');
const moving = () =>
  ['Dispatched', 'Navigating', 'At destination', 'Inspecting', 'Returning'].includes(sim.phase);

function logM(state: string, note: string) {
  sim.mission?.log.push([clock(), state, note]);
}

function setPhase(p: Phase, note = '') {
  sim.phase = p;
  if (sim.mission) {
    sim.mission.phaseT = 0;
    logM(p, note);
  }
}

function finish(outcome: 'Completed' | 'Cancelled' | 'Failed') {
  const m = sim.mission!;
  m.outcome = outcome;
  history.unshift({
    id: m.id,
    title: m.title,
    origin: m.origin,
    target: m.target,
    state: outcome,
    start: new Date(m.startedAt).toTimeString().slice(0, 5),
    end: clock(),
    dist: `${Math.round(m.travelled * UNIT_M)} m`,
    photos: m.photos,
    summary:
      outcome === 'Completed'
        ? `${m.photos} simulated photos captured at ${m.target}. No navigation incidents.`
        : outcome === 'Cancelled'
          ? 'Cancelled — the robot performed a safe stop and returned to dock.'
          : 'Mission timed out — the robot returned to dock per policy.',
    log: m.log,
  });
  sim.phase = 'Idle';
  sim.live = false;
  sim.mission = null;
}

function headHome(note: string) {
  sim.route = routeTo(sim.pos, target('Dock')!);
  setPhase('Returning', note);
}

/** Advance the simulation to `now` (called on every read). */
export function tick(now = Date.now()) {
  let dt = ((now - sim.last) / 1000) * sim.speed;
  sim.last = now;
  if (!active()) {
    sim.battery = Math.min(100, sim.battery + dt * 0.02); // charging on the dock
    return;
  }
  const m = sim.mission!;
  while (dt > 0 && active()) {
    if (sim.phase === 'Paused') return;
    const step = Math.min(dt, 0.5);
    dt -= step;
    m.elapsed += step;
    m.phaseT += step;
    if (m.elapsed > TIMEOUT_S && sim.phase !== 'Returning') {
      m.outcome = null;
      logM('Failed', `Mission timeout (${TIMEOUT_S / 60} min)`);
      (m as { failed?: boolean }).failed = true;
      headHome('Auto-return after timeout');
      continue;
    }
    if (sim.phase === 'Dispatched' && m.phaseT >= 2) setPhase('Navigating', `Route to ${m.target}`);
    else if (sim.phase === 'Navigating' || sim.phase === 'Returning') {
      let budget = (SPEED_MPS / UNIT_M) * step;
      while (budget > 0 && sim.route.length) {
        const q = sim.route[0]!;
        const d = dist(sim.pos, q);
        if (d <= budget) {
          sim.pos = { ...q };
          sim.route.shift();
          budget -= d;
          m.travelled += d;
        } else {
          sim.pos = {
            x: sim.pos.x + ((q.x - sim.pos.x) * budget) / d,
            y: sim.pos.y + ((q.y - sim.pos.y) * budget) / d,
          };
          m.travelled += budget;
          budget = 0;
        }
      }
      sim.battery = Math.max(0, sim.battery - step * 0.03);
      if (!sim.route.length) {
        if (sim.phase === 'Navigating') setPhase('At destination', m.target);
        else
          finish(
            m.log.some((l) => l[1] === 'Cancelled')
              ? 'Cancelled'
              : (m as { failed?: boolean }).failed
                ? 'Failed'
                : 'Completed',
          );
      }
    } else if (sim.phase === 'At destination' && m.phaseT >= 1)
      setPhase('Inspecting', 'Capturing photos');
    else if (sim.phase === 'Inspecting') {
      const due = Math.floor(m.phaseT / 2);
      while (m.photos < Math.min(4, due)) {
        m.photos++;
        sim.photos.unshift({
          id: `IMG-SIM-${String(sim.photos.length + 1).padStart(3, '0')}`,
          label: `${m.target} · view ${m.photos}`,
          time: clock(),
          by: 'LEFI-R1 (simulated)',
        });
      }
      if (m.phaseT >= 8) headHome('Inspection complete · returning per mission policy');
    }
  }
}

interface Actor {
  name: string;
  permissions: string[];
}
const can = (a: Actor, p: string) => a.permissions.includes(p);
const ok = { allowed: true, reason: null as string | null };
const no = (reason: string) => ({ allowed: false, reason });

function controls(s: MockState, a: Actor) {
  const moveGate = () =>
    !can(a, 'robot.command')
      ? no('Requires permission: Send movement commands to robots')
      : s.halted === 'all'
        ? no('Emergency stop: robots are in safe-hold.')
        : ok;
  const cam = () =>
    !can(a, 'robot.camera') ? no('Requires permission: Use the robot camera') : ok;
  // Cancel is always available to whoever may command the robot, in every active state.
  return {
    pause: active() && moving() && sim.phase !== 'Returning' ? moveGate() : no('Nothing to pause.'),
    resume: sim.phase === 'Paused' ? moveGate() : no('Not paused.'),
    cancel: !active()
      ? no('No active mission.')
      : cancelled()
        ? no(`${sim.mission!.id} is already cancelled — the robot is returning to dock.`)
        : can(a, 'robot.command')
          ? ok
          : no('Requires permission: Send movement commands to robots'),
    return:
      active() && sim.phase !== 'Returning'
        ? moveGate()
        : no(active() ? 'Already returning.' : 'Already docked.'),
    photo:
      active() && ['At destination', 'Inspecting'].includes(sim.phase)
        ? cam()
        : no('The robot must be at a destination to take a photo.'),
    video: cam(),
    status: can(a, 'nav.robots') ? ok : no('Requires permission: Robot mission center'),
    goto: moveGate(),
  };
}

function step(): number {
  if (!sim.mission) return 0;
  const map: Record<string, number> = {
    Dispatched: 5,
    Navigating: 6,
    Paused: 6,
    'At destination': 7,
    Inspecting: 8,
    Returning: 12,
  };
  return map[sim.phase] ?? 0;
}

export function live(s: MockState, a: Actor) {
  tick();
  const m = sim.mission;
  const remaining = sim.route.length ? routeLen(sim.pos, sim.route) * UNIT_M : 0;
  return {
    sim: { speed: sim.speed, driver: 'sim-mh3 v0.9 (mock)', simulated: true },
    fleet: [
      {
        id: 'LEFI-R1',
        home: 'GH-1 dock',
        kind: 'rover',
        state: m ? sim.phase : 'Docked · charging',
        battery_pct: Math.round(sim.battery),
        link: 'Connected',
        simulated: true,
        adapter: true,
      },
      {
        id: 'LEFI-R2',
        home: 'GH-2 dock',
        kind: 'rover',
        state: 'Docked · charging',
        battery_pct: 96,
        link: 'Connected',
        simulated: true,
        adapter: false,
      },
      {
        id: 'LEFI-D1',
        home: 'GH-3 pad',
        kind: 'drone',
        state: 'Maintenance',
        battery_pct: null,
        link: 'Powered off',
        simulated: true,
        adapter: false,
      },
    ],
    robot: {
      id: 'LEFI-R1',
      model: 'MH3-compatible rover · sim-mh3 v0.9',
      mode: m ? (sim.phase === 'Paused' ? 'Paused' : sim.phase) : 'Docked · charging',
      battery_pct: Math.round(sim.battery),
      link: 'Sim link · −58 dBm · 46 ms',
      position: { x: Math.round(sim.pos.x), y: Math.round(sim.pos.y) },
      position_m: { x: +(sim.pos.x * UNIT_M).toFixed(1), y: +(sim.pos.y * UNIT_M).toFixed(1) },
      location: zoneOf(sim.pos),
      speed_mps: ['Navigating', 'Returning'].includes(sim.phase) ? SPEED_MPS : 0,
      remaining_m: remaining ? Math.round(remaining) : null,
    },
    map: {
      title: 'North Range · GH-1 · live floor map',
      subtitle: '50 m × 28 m · 4 zones · 34 crop rows · LiDAR map rev. 12 (simulated)',
      width: 1000,
      height: 560,
      aisle_y: AISLE,
      dock: DOCK,
      zones: ZONES.map((z) => ({
        id: z.id,
        label: `ZONE ${z.id} · ${z.gh} · ${z.crop}${z.restricted ? ' · RESTRICTED · spray REI until 14:00' : ''}`,
        x: z.x,
        y: z.y,
        w: z.w,
        h: z.h,
        restricted: z.restricted,
      })),
      targets: ['A-03', 'B-03', 'B-07', 'C-05', 'D-02'].map((id) => {
        const t = target(id)!;
        return { id: t.id, x: t.x, y: t.y, allowed: t.allowed, reason: t.reason };
      }),
      route: sim.route,
      crew: [{ label: 'Crew · 2', x: 690, y: 190 }],
    },
    workflow_step: step(),
    // Manual missions skip the AI steps (alert, need for inspection, AI request).
    workflow_skipped: sim.mission && sim.mission.origin.startsWith('Manual') ? [1, 2, 3] : [],
    mission: m
      ? {
          id: m.id,
          title: m.title,
          origin: m.origin,
          target: m.target,
          state: sim.phase,
          elapsed_s: Math.round(m.elapsed),
          photos: m.photos,
          log: m.log.map(([time, state, note]) => ({ time, state, note })),
        }
      : null,
    camera: {
      live: sim.live,
      label: `SIMULATED FEED · LEFI-R1 mast camera · ${zoneOf(sim.pos)}`,
      time: new Date().toTimeString().slice(0, 8),
    },
    photos: sim.photos.slice(0, 12).map((p) => ({ ...p, image_url: null })),
    summary: s.halted
      ? { text: null, simulated: true, state: 'disabled' }
      : {
          state: 'available',
          simulated: true,
          text: m
            ? `LEFI-R1 is ${sim.phase.toLowerCase()} on ${m.id} (${m.title}). ${m.photos} photo(s) so far. Supervisors can cancel at any time; the robot then stops safely and returns to dock.`
            : 'No active mission. LEFI-R1 is docked and charging. Choose a target and dispatch an inspection, or wait for the next queued mission.',
        },
    commands: commands.slice(0, 50),
    queue,
    controls: controls(s, a),
    queue_actions: can(a, 'robot.queue')
      ? ok
      : no('Requires permission: Reprioritise / cancel queued missions'),
    auth_note: can(a, 'robot.command')
      ? 'You can issue movement commands.'
      : 'Movement commands will be rejected by authorisation for your role.',
  };
}

function record(
  a: Actor,
  via: string,
  text: string,
  intent: string,
  auth: 'allowed' | 'denied' | 'n/a',
  exec: (typeof commands)[number]['exec'],
  result: string,
  parser: string,
) {
  commands.unshift({
    id: commands.length + 1,
    time: clock(),
    who: a.name,
    via,
    text,
    intent,
    label: INTENT[intent]?.label ?? intent,
    auth,
    exec,
    result,
    parser,
  });
}

function run(s: MockState, a: Actor, intent: string, arg: string | null | undefined): string {
  const c = controls(s, a);
  const need = (av: { allowed: boolean; reason: string | null }, perm?: string) => {
    if (!av.allowed)
      throw new MockError(
        perm && !can(a, perm) ? 403 : 409,
        perm && !can(a, perm) ? 'forbidden' : 'rejected',
        av.reason ?? 'Not allowed.',
      );
  };
  switch (intent) {
    case 'nav.goto': {
      need(c.goto, 'robot.command');
      const t = target(String(arg ?? ''));
      if (!t) throw new MockError(422, 'invalid_target', 'Unknown target.');
      if (!t.allowed) throw new MockError(409, 'policy', `Policy check failed: ${t.reason}`);
      if (sim.battery < 25)
        throw new MockError(409, 'policy', 'Policy check failed: battery below the 25 % reserve.');
      if (active()) {
        if (sim.phase === 'Returning' && sim.mission!.log.some((l) => l[1] === 'Cancelled'))
          throw new MockError(
            409,
            'rejected',
            'The robot is returning after a cancel; wait until it docks.',
          );
        sim.mission!.target = t.id;
        sim.route = routeTo(sim.pos, t);
        setPhase('Navigating', `Redirected to ${t.id} by ${a.name}`);
        return `Redirecting to ${t.id}. Policy checks passed.`;
      }
      const id = `M-${sim.next++}`;
      sim.mission = {
        id,
        title: `Spot inspection · Plant ${t.id}`,
        origin: `Manual · ${a.name}`,
        target: t.id,
        startedAt: Date.now(),
        elapsed: 0,
        phaseT: 0,
        travelled: 0,
        photos: 0,
        log: [
          [clock(), 'Requested', `Manual request by ${a.name}`],
          [clock(), 'Dispatched', `Target ${t.id} · policy checks passed`],
        ],
        outcome: null,
      };
      sim.route = routeTo(sim.pos, t);
      sim.phase = 'Dispatched';
      return `${id} dispatched to ${t.id}. Policy checks passed: target permitted, battery ≥ 25 %, requester authorised.`;
    }
    case 'nav.pause':
      need(c.pause, 'robot.command');
      sim.resumePhase = sim.phase;
      setPhase('Paused', `Paused by ${a.name}`);
      return 'Navigation paused. The robot holds position.';
    case 'nav.resume':
      need(c.resume, 'robot.command');
      setPhase(sim.resumePhase ?? 'Navigating', `Resumed by ${a.name}`);
      return 'Navigation resumed.';
    case 'nav.return':
      need(c.return, 'robot.command');
      headHome(`Return to base requested by ${a.name}`);
      return 'Returning to base.';
    case 'mission.cancel':
      need(c.cancel, 'robot.command');
      logM('Cancelled', `Safe stop · cancelled by ${a.name}`);
      sim.live = false;
      headHome('Returning to dock after cancel');
      return `${sim.mission!.id} cancelled. Safe stop done; returning to dock.`;
    case 'camera.photo':
      need(c.photo, 'robot.camera');
      sim.mission!.photos++;
      sim.photos.unshift({
        id: `IMG-SIM-${String(sim.photos.length + 1).padStart(3, '0')}`,
        label: `${arg ?? sim.mission!.target} · requested`,
        time: clock(),
        by: a.name,
      });
      return 'Photo captured (simulated) and delivered to the supervisor.';
    case 'camera.video.start':
      need(c.video, 'robot.camera');
      sim.live = true;
      return 'Live video started (simulated feed).';
    case 'camera.video.stop':
      need(c.video, 'robot.camera');
      sim.live = false;
      return 'Live video stopped.';
    case 'query.status':
      need(c.status, 'nav.robots');
      return `LEFI-R1 · ${sim.mission ? sim.phase : 'Docked · charging'} · battery ${Math.round(sim.battery)} % · ${zoneOf(sim.pos)}.`;
    case 'query.findings':
      return history[0]
        ? `Last mission ${history[0].id}: ${history[0].summary}`
        : 'No findings yet.';
    default:
      throw new MockError(
        422,
        'not_understood',
        'Command not understood. Try “Go inspect plant B-03”, “Return to base” or “Start live video”.',
      );
  }
}

export function command(
  s: MockState,
  a: Actor,
  body: { intent?: string; arg?: string | null; text?: string },
) {
  tick();
  const free = typeof body.text === 'string' && body.text.trim().length > 0;
  const parser = free ? 'mock keyword parser (no AI)' : 'structured control';
  const text = free
    ? body.text!.trim().slice(0, 200)
    : (INTENT[body.intent ?? '']?.label ?? String(body.intent));
  if (free && s.halted) {
    record(
      a,
      'Talk to LEFI-R1',
      text,
      '—',
      'n/a',
      'Paused',
      'Natural-language commands are paused while Lefi AI is stopped. Use the supervisor controls.',
      parser,
    );
    throw new MockError(
      409,
      'ai_stopped',
      'Natural-language commands are paused while Lefi AI is stopped. Use the supervisor controls.',
    );
  }
  const p = free ? parse(text) : { intent: body.intent ?? 'unknown', arg: body.arg };
  try {
    const msg = run(s, a, p.intent, p.arg);
    record(
      a,
      free ? 'Talk to LEFI-R1' : 'Control panel',
      text,
      p.intent,
      'allowed',
      'Executed',
      msg,
      parser,
    );
    return { item: live(s, a), message: `LEFI-R1: ${msg}` };
  } catch (e) {
    if (e instanceof MockError) {
      record(
        a,
        free ? 'Talk to LEFI-R1' : 'Control panel',
        text,
        p.intent,
        e.status === 403 ? 'denied' : 'allowed',
        p.intent === 'unknown' ? 'Not understood' : 'Rejected',
        e.message,
        parser,
      );
    }
    throw e;
  }
}

export function setSpeed(s: MockState, a: Actor, speed: number) {
  if (![1, 2, 4].includes(speed))
    throw new MockError(422, 'invalid_speed', 'Speed must be 1, 2 or 4.');
  tick();
  sim.speed = speed as 1 | 2 | 4;
  return { item: live(s, a), message: `Simulation speed ${speed}×.` };
}

export function queueOp(s: MockState, a: Actor, id: string, op: string) {
  if (!can(a, 'robot.queue'))
    throw new MockError(
      403,
      'forbidden',
      'Requires permission: Reprioritise / cancel queued missions',
    );
  const i = queue.findIndex((q) => q.id === id);
  if (i < 0) throw new MockError(404, 'not_found', `Queued mission ${id} not found.`);
  if (op === 'cancel') queue.splice(i, 1);
  else if (op === 'up' && i > 0) queue.splice(i - 1, 0, queue.splice(i, 1)[0]!);
  else if (op === 'down' && i < queue.length - 1) queue.splice(i + 1, 0, queue.splice(i, 1)[0]!);
  return {
    item: live(s, a),
    message: op === 'cancel' ? `${id} removed from the queue.` : `${id} moved ${op}.`,
  };
}

/** Emergency stop hook: with scope "all" the robot safe-stops and returns. */
export function onHalt(scope: 'ai' | 'all', by: string) {
  tick();
  if (scope === 'all' && active()) {
    logM('Cancelled', `Emergency stop by ${by}`);
    sim.live = false;
    headHome('Safe-hold: returning to dock');
  }
}

const CHECKS = [
  'Robot available & healthy',
  'Battery ≥ 25 % reserve',
  'Target inside permitted inspection area',
  'No spray re-entry interval active at target',
  'Crew proximity: speed limit 0.3 m/s',
  'Requester authorised to dispatch',
];

export function missions() {
  tick();
  const cur = sim.mission
    ? [
        {
          id: sim.mission.id,
          title: sim.mission.title,
          origin: sim.mission.origin,
          state: sim.phase,
          start: new Date(sim.mission.startedAt).toTimeString().slice(0, 5),
        },
      ]
    : [];
  return [
    ...cur,
    ...history.map((m) => ({
      id: m.id,
      title: m.title,
      origin: m.origin,
      state: m.state,
      start: m.start,
    })),
  ].map((m) => ({ ...m, origin_data: 'SIMULATED' }));
}

export function mission(id: string) {
  tick();
  if (sim.mission?.id === id) {
    const m = sim.mission;
    return {
      id,
      title: m.title,
      origin: m.origin,
      target: m.target,
      state: sim.phase,
      start: new Date(m.startedAt).toTimeString().slice(0, 5),
      end: '—',
      distance: `${Math.round(m.travelled * UNIT_M)} m`,
      photos: m.photos,
      robot: 'LEFI-R1',
      adapter: 'sim-mh3 v0.9 · simulated',
      log: m.log.map(([time, state, note]) => ({ time, state, note })),
      checks: CHECKS.map((label) => ({ label, passed: true })),
      summary: { text: 'Mission in progress.', simulated: true },
      photo_labels: sim.photos.slice(0, m.photos).map((p) => p.id),
    };
  }
  const m = history.find((x) => x.id === id);
  if (!m) throw new MockError(404, 'not_found', `Mission ${id} not found.`);
  return {
    id,
    title: m.title,
    origin: m.origin,
    target: m.target,
    state: m.state,
    start: m.start,
    end: m.end,
    distance: m.dist,
    photos: m.photos,
    robot: 'LEFI-R1',
    adapter: 'sim-mh3 v0.9 · simulated',
    log: m.log.map(([time, state, note]) => ({ time, state, note })),
    checks: CHECKS.map((label) => ({ label, passed: true })),
    summary: { text: m.summary, simulated: true },
    photo_labels:
      m.photos > 0 && m.photos < 20
        ? Array.from({ length: m.photos }, (_, i) => `IMG-SIM-${m.id}-${i + 1}`)
        : [],
  };
}

export const robotCard = () => {
  tick();
  return {
    mode: sim.mission ? sim.phase : 'Docked · charging',
    state: sim.mission ? 'on_mission' : 'docked',
    battery_pct: Math.round(sim.battery),
    last: history[0],
  };
};

/** Missions that ended during the current (day) shift — history rows without a date prefix. */
export function shiftMissions() {
  return history
    .filter((m) => !/^[A-Z][a-z]{2} \d/.test(m.start))
    .map((m) => ({ id: m.id, title: m.title, state: m.state, summary: m.summary }));
}
