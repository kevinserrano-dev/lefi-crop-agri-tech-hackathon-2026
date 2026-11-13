/**
 * Mock AI Control & Safety. The halt state is shared with /system/status (kill switch).
 * Truthful to LEFI CROP: no actuator automations exist; actions that would drive pumps,
 * valves, dosing, climate or spraying are not in the allowlist and can never be enabled;
 * internet research sources are unavailable (offline platform).
 */
import type { MockState } from './fixtures.ts';
import { MockError } from './incidents.ts';

interface Actor {
  name: string;
  permissions: string[];
}
const can = (a: Actor, p: string) => a.permissions.includes(p);
const OK = { allowed: true, reason: null };
const no = (reason: string) => ({ allowed: false, reason });

type Mode = 'off' | 'ask' | 'auto';
interface Row {
  key: string;
  label: string;
  area: string;
  risk: 'Low' | 'Medium' | 'High' | 'Critical';
  approver: string;
  allowlisted: boolean;
  mode: Mode;
}

const NOT_ALLOWLISTED =
  'Not in the action allowlist: LEFI CROP never lets AI drive pumps, valves, dosing, climate or spraying.';
const rows: Row[] = [
  ['inspect', 'Ask a worker to inspect a plant', 'Tasks', 'Low', 'supervisor', true],
  ['robot', 'Dispatch a robot for inspection', 'Robots', 'Low', 'supervisor', true],
  [
    'maint',
    'Request maintenance from a specialised technician',
    'Maintenance',
    'Low',
    'supervisor',
    true,
  ],
  ['resched', 'Reschedule crew tasks', 'Tasks', 'Low', 'supervisor', true],
  ['isolate', 'Isolate a faulty sensor from AI decisions', 'Devices', 'Low', 'maint', true],
  ['substrate', 'Request a substrate / soil change', 'Crop', 'Medium', 'grower', true],
  ['fertreq', 'Request a fertigation cycle', 'Irrigation', 'Medium', 'grower', true],
  [
    'climate',
    'Adjust climate setpoints within approved range',
    'Climate',
    'Medium',
    'supervisor',
    false,
  ],
  ['parts', 'Order spare parts & consumables', 'Purchasing', 'Medium', 'manager', true],
  ['fertrun', 'Run fertigation / irrigation directly', 'Irrigation', 'High', 'grower', false],
  [
    'dosing',
    'Change nutrient dosing (EC / pH) by up to 10 %',
    'Irrigation',
    'High',
    'grower',
    false,
  ],
  ['quarantine', 'Quarantine plants or close a zone', 'Crop', 'High', 'grower', true],
  ['spray', 'Apply pesticide or fungicide', 'Crop protection', 'Critical', 'grower', false],
].map(([key, label, area, risk, approver, allowlisted]) => ({
  key: key as string,
  label: label as string,
  area: area as string,
  risk: risk as Row['risk'],
  approver: approver as string,
  allowlisted: allowlisted as boolean,
  mode: allowlisted ? 'ask' : 'off',
}));

const guardrails = [
  {
    key: 'twoMan',
    label: 'Second approver for high-risk actions',
    description: 'High & critical actions need two different people',
    on: true,
  },
  {
    key: 'crew',
    label: 'Pause autonomy when crew are in the zone',
    description: 'Uses mobile check-ins and robot proximity sensors',
    on: true,
  },
  {
    key: 'quiet',
    label: 'No autonomous actions at night',
    description: '22:00–06:00 · suggestions queue for the morning shift',
    on: true,
  },
];
let maxPerHour = 4;

const automations = [
  {
    id: 'AU-3',
    source: 'ai',
    title: 'Daily vision imaging schedule',
    target: 'LEFI-R1 (simulated robot) · next run M-1044 Zone C',
    by: 'Scheduled by Daniel Tremblay',
    since: 'Daily 07:15',
    icon: 'photo_camera',
    running: true,
  },
];

const settings = {
  depth: 'Standard' as 'Fast' | 'Standard' | 'Deep research',
  sources: [
    { key: 'hist', label: 'Farm history & past incidents', on: true, available: OK },
    {
      key: 'weather',
      label: 'Weather forecast · Environment Canada',
      on: false,
      available: no('Needs internet access — LEFI CROP runs offline.'),
    },
    {
      key: 'omafa',
      label: 'OMAFA crop-protection & pest bulletins',
      on: false,
      available: no('Needs internet access — LEFI CROP runs offline.'),
    },
    {
      key: 'lit',
      label: 'Peer-reviewed horticulture research',
      on: false,
      available: no('Needs internet access — LEFI CROP runs offline.'),
    },
    {
      key: 'vendor',
      label: 'Supplier datasheets & manuals',
      on: false,
      available: no('No local document library configured.'),
    },
  ],
  min_confidence: 60,
  corroborating: 2,
  rescan: '24 h',
  toggles: [
    {
      key: 'explain',
      label: 'Always explain why',
      description: 'Every AI alert and suggestion shows its evidence and reasoning',
      on: true,
      available: OK,
    },
    {
      key: 'learn',
      label: 'Learn from reviewer feedback',
      description: 'Confirm / reject decisions retrain the model weekly',
      on: false,
      available: no('No model training pipeline exists yet.'),
    },
    {
      key: 'proactive',
      label: 'Proactive investigation',
      description:
        'AI looks into early signals (trends, neighbouring zones) before they become alerts',
      on: true,
      available: OK,
    },
  ],
};

const MANUAL = {
  keeps: [
    'Live sensor readings, charts and dashboards',
    'Threshold alerts from operating ranges',
    'Alerts & incidents and the fixed escalation chain',
    'Tasks, work orders and shift handover',
    'Manual controls of the simulated robot (pause, return, stop)',
  ],
  paused: [
    'AI plant-health diagnosis and recommendations',
    'AI robot dispatch and natural-language commands',
    'Any action at Ask approval or Autonomous',
    'Lefi assistant summaries',
  ],
};

/** Request-type actions only create work for a person; nothing is operated or ordered. */
const REQUEST_NOTE: Record<string, string> = {
  fertreq: 'Creates a task for the grower · irrigation itself is never operated',
  substrate: 'Creates a task for the grower',
  parts: 'Creates a purchase request for the manager · no external order is placed',
};

export function view(s: MockState, a: Actor) {
  const halted = Boolean(s.halted);
  const aiSvc = halted ? 'stopped' : 'online';
  const rulesSvc = halted && s.halted === 'all' ? 'safe_hold' : 'online';
  const edit = can(a, 'ai.autonomy');
  return {
    status: halted
      ? {
          state: 'halted',
          label: 'Stopped by emergency stop',
          detail: `Stopped by ${s.haltedBy ?? 'an operator'}${s.haltedAt ? ` at ${s.haltedAt}` : ''}${s.haltReason ? ` · “${s.haltReason}”` : ''} · ${s.halted === 'all' ? 'AI and all automations' : 'AI only — rule-based monitoring keeps running'}`,
        }
      : {
          state: 'online',
          label: 'Online',
          detail: 'Mock Brain — no AI model connected; AI outputs on these screens are simulated.',
        },
    services: [
      { name: 'Vision diagnosis', kind: 'ai', state: halted ? 'stopped' : 'not_connected' },
      { name: 'Recommendations & decision engine', kind: 'ai', state: aiSvc },
      { name: 'Natural-language assistant', kind: 'ai', state: aiSvc },
      { name: 'AI robot dispatch (simulated robot)', kind: 'ai', state: aiSvc },
      { name: 'Rules engine · on-premise', kind: 'rules', state: rulesSvc },
      { name: 'Sensor ingestion & threshold alerts', kind: 'rules', state: 'online' },
      { name: 'Notifications · in-app', kind: 'rules', state: 'online' },
    ],
    actions: {
      halt: halted
        ? no('Lefi AI is already stopped.')
        : can(a, 'ai.halt')
          ? OK
          : no('Requires permission: Emergency stop'),
      resume: !halted
        ? no('Lefi AI is running.')
        : can(a, 'ai.resume')
          ? OK
          : no('Requires permission: Resume AI after a stop (Manager or System Administrator)'),
    },
    manual_mode: MANUAL,
    automations: automations.map((x) => ({
      ...x,
      origin: 'SIMULATED',
      running: x.running && !(halted && (x.source === 'ai' || s.halted === 'all')),
      actions: {
        stop: !can(a, 'ai.halt')
          ? no('Requires permission: Emergency stop')
          : x.running
            ? OK
            : no('Already stopped.'),
        restart: !can(a, 'ai.halt')
          ? no('Requires permission: Emergency stop')
          : x.running
            ? no('Already running.')
            : halted && x.source === 'ai'
              ? no('Lefi AI is not running — resume AI first.')
              : OK,
      },
    })),
    automations_note:
      'No actuator automations exist in LEFI CROP: irrigation, dosing, climate and vents are not controlled by the platform.',
    autonomy: {
      can_edit: edit
        ? OK
        : no('Read-only · only System Administrators can change the AI autonomy policy.'),
      rows: rows.map((r) => ({
        key: r.key,
        label: r.label,
        area: r.area,
        risk: r.risk,
        mode: r.mode,
        approver: r.approver,
        note: !r.allowlisted
          ? 'Not in the action allowlist · manual only'
          : REQUEST_NOTE[r.key]
            ? `${REQUEST_NOTE[r.key]} · ${r.mode === 'auto' ? 'no approval needed' : r.mode === 'off' ? 'AI won’t suggest it' : 'approver decides'}`
            : r.mode === 'auto'
              ? 'Runs without approval · validator still authorises · logged'
              : r.mode === 'off'
                ? 'AI won’t suggest this · manual only'
                : 'AI suggests → approver decides',
        modes: {
          off: edit ? OK : no('Read-only'),
          ask: !r.allowlisted ? no(NOT_ALLOWLISTED) : edit ? OK : no('Read-only'),
          auto: !r.allowlisted
            ? no(NOT_ALLOWLISTED)
            : r.risk === 'High' || r.risk === 'Critical'
              ? no('High-risk actions are never autonomous.')
              : edit
                ? OK
                : no('Read-only'),
        },
      })),
      guardrails,
      max_per_hour: maxPerHour,
      approvers: [
        { id: 'manager', label: 'Manager' },
        { id: 'grower', label: 'Grower' },
        { id: 'supervisor', label: 'Supervisor' },
        { id: 'scout', label: 'Crop Scout' },
        { id: 'maint', label: 'Maintenance' },
      ],
    },
    settings: { ...settings, can_edit: edit ? OK : no('Read-only · System Administrators only.') },
  };
}

export function halt(s: MockState, a: Actor, body: { scope?: string; reason?: string }) {
  if (s.halted) throw new MockError(409, 'invalid_state', 'Lefi AI is already stopped.');
  s.halted = body.scope === 'all' ? 'all' : 'ai';
  s.haltReason = String(body.reason ?? '').slice(0, 200);
  s.haltedBy = a.name;
  s.haltedAt = new Date().toTimeString().slice(0, 5);
  automations.forEach((x) => {
    if (x.source === 'ai' || s.halted === 'all') x.running = false;
  });
}

export function resume(s: MockState, a: Actor) {
  if (!s.halted) throw new MockError(409, 'invalid_state', 'Lefi AI is running.');
  if (!can(a, 'ai.resume'))
    throw new MockError(
      403,
      'forbidden',
      'Requires permission: Resume AI after a stop (Manager or System Administrator)',
    );
  s.halted = null;
  s.haltReason = '';
  return {
    item: view(s, a),
    message: 'Lefi AI resumed. Stopped missions and automations are not restarted automatically.',
  };
}

export function automation(s: MockState, a: Actor, id: string, op: 'stop' | 'restart') {
  const x = automations.find((y) => y.id === id);
  if (!x) throw new MockError(404, 'not_found', `Automation ${id} not found.`);
  const v = view(s, a).automations.find((y) => y.id === id)!;
  const av = v.actions[op];
  if (!av.allowed)
    throw new MockError(
      can(a, 'ai.halt') ? 409 : 403,
      can(a, 'ai.halt') ? 'invalid_state' : 'forbidden',
      av.reason ?? 'Not allowed.',
    );
  x.running = op === 'restart';
  return {
    item: view(s, a),
    message:
      op === 'stop'
        ? `“${x.title}” stopped. The simulated robot holds its last safe state.`
        : `“${x.title}” restarted.`,
  };
}

export function updateAutonomy(
  s: MockState,
  a: Actor,
  body: {
    row?: { key: string; mode?: Mode; approver?: string };
    guardrail?: { key: string; on: boolean };
    max_per_hour?: number;
  },
) {
  if (!can(a, 'ai.autonomy'))
    throw new MockError(
      403,
      'forbidden',
      'Only System Administrators can change the AI autonomy policy.',
    );
  let message = 'AI autonomy policy updated.';
  if (body.row) {
    const r = rows.find((x) => x.key === body.row!.key);
    if (!r) throw new MockError(404, 'not_found', 'Unknown action.');
    if (body.row.mode) {
      const av = view(s, a).autonomy.rows.find((x) => x.key === r.key)!.modes[body.row.mode];
      if (!av.allowed) throw new MockError(409, 'not_allowed', av.reason ?? 'Not allowed.');
      r.mode = body.row.mode;
      message =
        r.mode === 'auto'
          ? `“${r.label}” is now autonomous. Lefi AI acts without approval, within the guardrails; the validator still authorises every run.`
          : `“${r.label}” → ${r.mode === 'ask' ? 'Ask approval' : 'Off · manual'}.`;
    }
    if (body.row.approver) {
      if (!['manager', 'grower', 'supervisor', 'scout', 'maint'].includes(body.row.approver))
        throw new MockError(422, 'invalid_approver', 'Unknown approver role.');
      r.approver = body.row.approver;
      message = `Approver for “${r.label}” updated.`;
    }
  }
  if (body.guardrail) {
    const g = guardrails.find((x) => x.key === body.guardrail!.key);
    if (!g) throw new MockError(404, 'not_found', 'Unknown guardrail.');
    g.on = Boolean(body.guardrail.on);
    message = `${g.label}: ${g.on ? 'on' : 'off'}.`;
  }
  if (body.max_per_hour !== undefined) {
    const n = Math.floor(Number(body.max_per_hour));
    if (!(n >= 0 && n <= 60))
      throw new MockError(
        422,
        'invalid_value',
        'Max autonomous actions per hour must be between 0 and 60.',
      );
    maxPerHour = n;
    message = `Max autonomous actions per hour: ${n}.`;
  }
  return { item: view(s, a), message };
}

export function updateSettings(s: MockState, a: Actor, body: Record<string, unknown>) {
  if (!can(a, 'ai.autonomy'))
    throw new MockError(403, 'forbidden', 'Only System Administrators can change AI settings.');
  if (typeof body.depth === 'string' && ['Fast', 'Standard', 'Deep research'].includes(body.depth))
    settings.depth = body.depth as typeof settings.depth;
  if (typeof body.source === 'string') {
    const src = settings.sources.find((x) => x.key === body.source);
    if (!src) throw new MockError(404, 'not_found', 'Unknown source.');
    if (!src.available.allowed)
      throw new MockError(409, 'not_available', src.available.reason ?? 'Not available.');
    src.on = !src.on;
  }
  if (typeof body.toggle === 'string') {
    const t = settings.toggles.find((x) => x.key === body.toggle);
    if (!t) throw new MockError(404, 'not_found', 'Unknown setting.');
    if (!t.available.allowed)
      throw new MockError(409, 'not_available', t.available.reason ?? 'Not available.');
    t.on = !t.on;
  }
  if (body.min_confidence !== undefined) {
    const n = Number(body.min_confidence);
    if (!(n >= 0 && n <= 100))
      throw new MockError(422, 'invalid_value', 'Confidence must be between 0 and 100 %.');
    settings.min_confidence = n;
  }
  if (body.corroborating !== undefined) {
    const n = Number(body.corroborating);
    if (!(n >= 1 && n <= 5))
      throw new MockError(422, 'invalid_value', 'Corroborating signals must be between 1 and 5.');
    settings.corroborating = n;
  }
  if (typeof body.rescan === 'string' && ['6 h', '12 h', '24 h', '48 h'].includes(body.rescan))
    settings.rescan = body.rescan;
  return { item: view(s, a), message: 'AI settings saved.' };
}
