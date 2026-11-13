/**
 * Mock escalation rules (prototype content). Who gets an alert is resolved here by
 * deterministic rules over the fake Workforce data — never by an LLM — and the preview says
 * so. SMS and voice need an external gateway, which is not configured (offline-first), so
 * those channels are reported unavailable instead of pretending to send.
 */
import { ROLES, type RoleId } from './design-data.ts';
import type { MockState } from './fixtures.ts';
import { MockError } from './incidents.ts';
import * as auditLog from './audit.ts';
import { findPerson, PEOPLE, personId, type Person } from './workforce.ts';

interface Actor {
  name: string;
  permissions: string[];
}
const can = (a: Actor, p: string) => a.permissions.includes(p);
const OK = { allowed: true, reason: null as string | null };
const no = (reason: string) => ({ allowed: false, reason });
const short = (r: RoleId) => ROLES.find((x) => x.id === r)!.short;

type Channel = 'dashboard' | 'push' | 'sms' | 'voice';
type Level = 'info' | 'warn' | 'crit';

const CHANNELS: Array<{
  key: Channel;
  label: string;
  description: string;
  available: { allowed: boolean; reason: string | null };
}> = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    description: 'Always shown on dashboards',
    available: no('Dashboard display is always on.'),
  },
  {
    key: 'push',
    label: 'Push',
    description: 'In-app notification to Lefi Desktop and the mobile app over the LAN',
    available: OK,
  },
  {
    key: 'sms',
    label: 'SMS',
    description: 'Needs an SMS gateway',
    available: no(
      'No SMS gateway is configured. SMS needs external infrastructure and is disabled by default (offline-first).',
    ),
  },
  {
    key: 'voice',
    label: 'Voice call',
    description: 'Needs a telephony gateway',
    available: no(
      'No telephony gateway is configured. Voice calls need external infrastructure and are disabled by default (offline-first).',
    ),
  },
];

/** People (role, zones, shift, status, phone) come from the mock Workforce directory. */
const TYPES: Record<string, [string, RoleId[]]> = {
  env: ['Climate / environment', ['supervisor', 'grower', 'manager']],
  plant: ['Plant health', ['scout', 'grower', 'manager']],
  device: ['Device / irrigation fault', ['maint', 'supervisor', 'manager']],
  robot: ['Robot incident', ['supervisor', 'manager']],
};
const SLOTS: Record<string, [string, 'Day' | 'Evening' | null]> = {
  day: ['Day shift · now', 'Day'],
  eve: ['Evening · 18:00', 'Evening'],
  night: ['Night · 02:00', null],
};
const ROTATION = [
  'Owen MacLeod',
  'Owen MacLeod',
  'Tyler Brooks',
  'Tyler Brooks',
  'Daniel Tremblay',
  'Owen MacLeod',
  'Tyler Brooks',
];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const todayIdx = () => (new Date().getDay() + 6) % 7;

const RULES: Array<{ key: string; label: string; description: string }> = [
  {
    key: 'role',
    label: 'Match incident type to role',
    description: 'Climate → Supervisor · Plant → Scout · Device → Maintenance',
  },
  {
    key: 'zone',
    label: 'Match zone coverage',
    description: 'Only people assigned to the affected greenhouse',
  },
  {
    key: 'skip',
    label: 'Skip people on break, PTO or off shift',
    description: 'Reads Workforce shifts',
  },
  { key: 'onsite', label: 'Prefer staff checked in on site', description: 'Mobile app check-in' },
  {
    key: 'night',
    label: 'Warnings wait for the next shift at night',
    description: 'Only critical alerts wake people 22:00–06:00',
  },
];
const CHAIN_ROLES = [
  'Greenhouse Supervisor',
  'Grower / Crop Manager',
  'Greenhouse Manager',
  'After-hours on-call',
];

const cfg = {
  mode: 'dynamic' as 'dynamic' | 'fixed',
  rules: { role: true, zone: true, skip: true, onsite: true, night: true } as Record<
    string,
    boolean
  >,
  levels: {
    info: { channels: ['dashboard'] as Channel[], timeout: null as number | null },
    warn: { channels: ['dashboard', 'push'] as Channel[], timeout: 15 as number | null },
    crit: { channels: ['dashboard', 'push'] as Channel[], timeout: 5 as number | null },
  },
  quiet: true,
  oncall: [
    ['Tyler Brooks', true],
    ['Owen MacLeod', true],
    ['Daniel Tremblay', true],
    ['Sofia Marchetti', false],
    ['Luis Ortega', false],
  ].map(([name, on]) => ({ name: name as string, on: on as boolean })),
};

const person = (name: string) => findPerson(name)!;
const aiOn = (s: MockState) => !s.halted;
const pushOnly = () => 'Push';

/** Today's on-call: the rotation's primary if still on the roster, else the first backup. */
function onCallNow() {
  const rot = ROTATION[todayIdx()]!;
  if (cfg.oncall.some((o) => o.on && o.name === rot)) return `${rot} today`;
  const backup = cfg.oncall.find((o) => o.on);
  return backup ? `${backup.name} (backup — ${rot} is off the roster)` : 'nobody on the roster';
}

function chain() {
  const who = [
    'Marcus Okafor (day) · Owen MacLeod (evening)',
    'Sofia Marchetti',
    'Daniel Tremblay',
    `On-call rotation · ${onCallNow()}`,
  ];
  return CHAIN_ROLES.map((role, i) => ({
    level: i + 1,
    role,
    who: who[i]!,
    when:
      i === 0
        ? 'Immediately'
        : `+${cfg.levels.crit.timeout! * i} min critical · +${cfg.levels.warn.timeout! * i} min warning`,
  }));
}

export function view(s: MockState, a: Actor) {
  const edit = can(a, 'escalation.edit')
    ? OK
    : no('Only Managers and System Administrators can edit escalation rules.');
  const today = todayIdx();
  return {
    note: edit.allowed
      ? 'Changes apply to new alerts immediately and are written to the audit trail.'
      : 'Read-only · only Managers and System Administrators can edit escalation rules.',
    can_edit: edit,
    can_edit_oncall: can(a, 'escalation.oncall')
      ? OK
      : no('Only Managers and System Administrators can change the on-call roster.'),
    mode: cfg.mode,
    description:
      cfg.mode === 'dynamic'
        ? 'For every alert the Brain checks who is on shift right now, their role and zones, skips anyone unavailable, works up the ranks and finally reaches the 24/7 on-call roster. Each routing decision is logged with its reason.'
        : 'Alerts follow the fixed chain regardless of who is on shift. This is also the automatic fallback when Lefi AI is stopped or offline.',
    fallback_notice:
      cfg.mode === 'dynamic' && !aiOn(s)
        ? 'Lefi AI is stopped — the rules engine is using the fixed fallback chain. Alerts still go out.'
        : null,
    rules: RULES.map((r) => ({ ...r, on: cfg.rules[r.key]! })),
    incident_types: Object.entries(TYPES).map(([id, [label]]) => ({ id, label })),
    slots: Object.entries(SLOTS).map(([id, [label]]) => ({ id, label })),
    channels: CHANNELS,
    levels: (['info', 'warn', 'crit'] as Level[]).map((k) => ({
      key: k,
      severity: k === 'info' ? 'info' : k === 'warn' ? 'warning' : 'critical',
      description:
        k === 'info'
          ? 'Dashboard only — no push, SMS or calls'
          : k === 'warn'
            ? 'Push to the assigned Supervisor'
            : 'Push to authorised responsible personnel, escalating up the chain',
      channels: cfg.levels[k].channels,
      timeout_min: cfg.levels[k].timeout,
    })),
    chain: chain(),
    quiet_hours: {
      label: 'Quiet hours 22:00–06:00',
      description: 'Only critical alerts notify people during quiet hours',
      on: cfg.quiet,
    },
    oncall: cfg.oncall.map((o) => {
      const p = person(o.name);
      return {
        id: personId(o.name),
        name: o.name,
        role_id: p.role,
        role_label: short(p.role),
        phone: p.phone,
        on: o.on,
        primary: o.on && o.name === ROTATION[today],
      };
    }),
    rotation: DAYS.map((day, i) => ({ day, who: ROTATION[i]!.split(' ')[0]!, today: i === today })),
    live: [] as unknown[],
    origin: 'SIMULATED',
  };
}

const covers = (zones: string[]) =>
  zones.includes('All') || zones.includes('GH-1') || zones.includes('GH1-Z2');

/** Preview for a critical alert in GH1-Z2 — the same resolver the mock uses for real alerts. */
export function preview(s: MockState, q: URLSearchParams) {
  const type = TYPES[q.get('type') ?? 'env'] ? (q.get('type') ?? 'env') : 'env';
  const slot = SLOTS[q.get('slot') ?? 'day'] ? (q.get('slot') ?? 'day') : 'day';
  const shift = SLOTS[slot]![1];
  const R = cfg.rules;
  const timeout = cfg.levels.crit.timeout!;
  const steps: Array<{
    level: number;
    who: string;
    role: string;
    why: string;
    channels: string;
    when: string;
  }> = [];
  const skipped: string[] = [];
  const dynamic = cfg.mode === 'dynamic' && aiOn(s);
  const add = (who: string, role: string, why: string) =>
    steps.push({
      level: steps.length + 1,
      who,
      role,
      why,
      channels: pushOnly(),
      when: steps.length === 0 ? 'Immediately' : `+${timeout * steps.length} min if no ack`,
    });
  if (dynamic) {
    const roles = TYPES[type]![1];
    const pool = shift ? PEOPLE.filter((p) => p.shift === shift) : [];
    const used = new Set<string>();
    const rot = ROTATION[slot === 'night' ? (todayIdx() + 1) % 7 : todayIdx()];
    for (const role of roles) {
      for (const p of pool.filter((x) => x.role === role)) {
        if (steps.length >= 3 || used.has(p.name) || steps.some((x) => x.role === short(role)))
          continue;
        if (p.status === 'Deactivation pending') {
          skipped.push(`${p.name} — account being deactivated`);
          continue;
        }
        if (R.skip && slot === 'day' && p.status !== 'On shift') {
          skipped.push(`${p.name} — ${p.status.toLowerCase()}`);
          continue;
        }
        if (R.zone && !covers(p.zones)) {
          skipped.push(`${p.name} — on shift but doesn’t cover GH-1`);
          continue;
        }
        used.add(p.name);
        add(
          p.name,
          short(role),
          `On shift (${p.shift?.toLowerCase()})${R.onsite && slot === 'day' ? ' · checked in on site' : ''} · ${p.zones.includes('All') ? 'all zones' : `covers ${p.zones.join(', ')}`}`,
        );
      }
    }
    const oc = cfg.oncall
      .filter((o) => o.on && person(o.name).status !== 'Deactivation pending')
      .map((o) => person(o.name))
      .sort((x, y) => {
        const m = (p: Person) =>
          (R.role && roles.includes(p.role) ? 2 : 0) + (p.name === rot ? 1 : 0);
        return m(y) - m(x);
      });
    for (const p of oc) {
      if (steps.length >= 3 || used.has(p.name)) continue;
      used.add(p.name);
      add(
        p.name,
        short(p.role),
        `24/7 on-call${p.name === rot ? ' · primary' : ' · backup'}${pool.some((x) => x.name === p.name) ? '' : ' · off shift'}`,
      );
    }
    if (!shift) skipped.push('No crew on shift at 02:00 — went straight to the on-call roster');
    for (const o of cfg.oncall)
      if (!o.on && !pool.some((p) => p.name === o.name))
        skipped.push(`${o.name} — not on the 24/7 roster`);
  } else {
    for (const c of chain()) add(c.who, c.role, `Fixed chain · level ${c.level} · ignores shifts`);
  }
  return {
    mode_used: dynamic ? 'dynamic' : 'fixed',
    resolver: dynamic ? 'Mock Brain routing rules (deterministic, no AI)' : 'Fixed fallback chain',
    steps,
    skipped,
  };
}

export function update(
  s: MockState,
  a: Actor,
  b: {
    mode?: string;
    rule?: { key: string; on: boolean };
    level?: { key: string; channel?: string; timeout_min?: number };
    quiet_hours?: boolean;
  },
) {
  if (!can(a, 'escalation.edit'))
    throw new MockError(
      403,
      'forbidden',
      'Only Managers and System Administrators can edit escalation rules.',
    );
  let message = 'Escalation rules updated.';
  if (b.mode) {
    if (b.mode !== 'dynamic' && b.mode !== 'fixed')
      throw new MockError(422, 'invalid_mode', 'Unknown escalation mode.');
    cfg.mode = b.mode;
    message =
      b.mode === 'dynamic'
        ? 'Dynamic escalation on. New alerts are routed from Workforce shifts and the on-call roster.'
        : 'Fixed chain on. New alerts follow the fixed fallback chain.';
  }
  if (b.rule) {
    if (!(b.rule.key in cfg.rules)) throw new MockError(404, 'not_found', 'Unknown routing rule.');
    cfg.rules[b.rule.key] = Boolean(b.rule.on);
    message = `“${RULES.find((r) => r.key === b.rule!.key)!.label}” ${b.rule.on ? 'on' : 'off'}.`;
  }
  if (b.level) {
    const lv = cfg.levels[b.level.key as Level];
    if (!lv) throw new MockError(404, 'not_found', 'Unknown severity rule.');
    if (b.level.channel) {
      const ch = CHANNELS.find((c) => c.key === b.level!.channel);
      if (!ch) throw new MockError(422, 'invalid_channel', 'Unknown channel.');
      if (!ch.available.allowed)
        throw new MockError(409, 'channel_unavailable', ch.available.reason!);
      const has = lv.channels.includes(ch.key);
      if (has && b.level.key === 'crit' && ch.key === 'push')
        throw new MockError(
          409,
          'not_allowed',
          'Critical alerts must notify someone beyond the dashboard; push is the only channel available.',
        );
      lv.channels = has ? lv.channels.filter((c) => c !== ch.key) : [...lv.channels, ch.key];
      message = `${ch.label} ${has ? 'removed from' : 'added to'} ${b.level.key === 'info' ? 'Informational' : b.level.key === 'warn' ? 'Warning' : 'Critical'} alerts.`;
    }
    if (b.level.timeout_min !== undefined) {
      if (lv.timeout === null)
        throw new MockError(422, 'no_timeout', 'Informational alerts do not escalate.');
      const t = Number(b.level.timeout_min);
      if (!Number.isInteger(t) || t < 1 || t > 120)
        throw new MockError(
          422,
          'invalid_timeout',
          'The acknowledgement window must be a whole number of minutes between 1 and 120.',
        );
      lv.timeout = t;
      message = `Escalate after ${t} min without acknowledgement.`;
    }
  }
  if (b.quiet_hours !== undefined) {
    cfg.quiet = Boolean(b.quiet_hours);
    message = `Quiet hours ${cfg.quiet ? 'on' : 'off'}.`;
  }
  auditLog.record(a.name, 'Escalation rule changed', 'Escalation rules', message);
  return { item: view(s, a), message };
}

export function setOncall(s: MockState, a: Actor, id: string, on: boolean) {
  if (!can(a, 'escalation.oncall'))
    throw new MockError(
      403,
      'forbidden',
      'Only Managers and System Administrators can change the on-call roster.',
    );
  const o = cfg.oncall.find((x) => personId(x.name) === id);
  if (!o) throw new MockError(404, 'not_found', 'Unknown person.');
  if (!on && cfg.oncall.filter((x) => x.on).length === 1 && o.on)
    throw new MockError(
      409,
      'not_allowed',
      'At least one person must stay on the 24/7 on-call roster.',
    );
  o.on = Boolean(on);
  auditLog.record(
    a.name,
    'On-call roster changed',
    o.name,
    o.on ? 'Added to 24/7 roster' : 'Removed from 24/7 roster',
  );
  return {
    item: view(s, a),
    message: `${o.name} ${o.on ? 'added to' : 'removed from'} the 24/7 roster.`,
  };
}

/** Delivery audit as the Brain would log it (prototype rows; all simulated). */
export function deliveries() {
  return [
    [
      '09:19',
      'INC-0185',
      'Acknowledgement',
      'Marcus Okafor',
      'INC-0185 · RH 77 %',
      'Acknowledged',
      'ok',
    ],
    [
      '09:15',
      'INC-0185',
      'Push',
      'Marcus Okafor · Supervisor',
      'WARNING · GH2-Z2 RH 77 %',
      'Delivered · read',
      'ok',
    ],
    [
      '08:47',
      'INC-0186',
      'Acknowledgement',
      'Luis Ortega',
      'INC-0186 · EC 2.31',
      'Acknowledged',
      'ok',
    ],
    [
      '08:40',
      'INC-0186',
      'Push',
      'Marcus Okafor · Supervisor',
      'CRITICAL · GH2-Z3 EC 2.31 mS/cm',
      'Delivered',
      'ok',
    ],
    [
      '06:27',
      'INC-0182',
      'Push',
      'Tyler Brooks · Maintenance on-call',
      'L2 escalation · probe offline',
      'Delivered',
      'warn',
    ],
    [
      '06:12',
      'INC-0182',
      'Push',
      'Owen MacLeod · Supervisor',
      'WARNING · SM-GH2-Z3-02 offline',
      'Failed · device unreachable',
      'crit',
    ],
  ].map(([time, incident_id, channel, recipient, message, state, tone]) => ({
    time,
    incident_id,
    channel,
    recipient,
    message,
    state,
    tone,
    origin: 'SIMULATED',
  }));
}
