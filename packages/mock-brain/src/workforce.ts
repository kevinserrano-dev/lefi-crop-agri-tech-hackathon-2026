/**
 * Mock Workforce: the prototype's fake crew (directory, zone access, notification
 * preferences, weekly shifts) plus a small audit trail. Other mock modules (escalation)
 * read people from here so a change in one screen shows in the others.
 * Phones use the fictional 555-01xx range; emails are @leficrop.ca fixtures.
 */
import { email, ROLES, ZONES, type RoleId } from './design-data.ts';
import { MockError } from './incidents.ts';
import * as auditLog from './audit.ts';

interface Actor {
  name: string;
  permissions: string[];
}
const can = (a: Actor, p: string) => a.permissions.includes(p);
const OK = { allowed: true, reason: null as string | null };
const no = (reason: string) => ({ allowed: false, reason });
const role = (r: RoleId) => ROLES.find((x) => x.id === r)!;
export const personId = (name: string) => name.toLowerCase().replace(/[^a-z]+/g, '-');

export type ShiftCode = 'D' | 'E' | 'O' | 'P';
export interface Person {
  name: string;
  role: RoleId;
  zones: string[];
  shift: 'Day' | 'Evening' | null;
  status: string;
  last: string;
  phone: string;
  email: string;
  week: ShiftCode[];
  notify: Record<string, [boolean, boolean, boolean]>;
}

const ROWS: Array<[string, RoleId, string[], 'Day' | 'Evening' | null, string, string]> = [
  ['Priya Raman', 'admin', ['All'], 'Day', 'On shift', '09:40'],
  ['Daniel Tremblay', 'manager', ['All'], 'Day', 'On shift', '09:41'],
  ['Sofia Marchetti', 'grower', ['All'], 'Day', 'On shift', '09:12'],
  ['Marcus Okafor', 'supervisor', ['GH-1', 'GH-2'], 'Day', 'On shift', '09:30'],
  [
    'Owen MacLeod',
    'supervisor',
    ['GH-1', 'GH-2', 'GH-3'],
    'Evening',
    'Off shift',
    'Yesterday 22:31',
  ],
  ['Hana Kim', 'scout', ['All'], 'Day', 'On shift', '09:38'],
  ['Fatima Haddad', 'scout', ['GH-2', 'GH-3'], 'Evening', 'Off shift', 'Yesterday 21:58'],
  ['Luis Ortega', 'maint', ['All'], 'Day', 'On shift', '09:35'],
  ['Tyler Brooks', 'maint', ['All'], 'Evening', 'Off shift', 'Yesterday 22:10'],
  ['Amrit Gill', 'worker', ['GH1-Z2', 'GH1-Z3'], 'Day', 'On shift', '09:20'],
  ['Mei Chen', 'worker', ['GH3-P1', 'GH3-P2'], 'Day', 'On shift', '08:55'],
  ['Jean-Luc Gagnon', 'worker', ['GH2-Z1', 'GH2-Z2'], 'Day', 'On break', '09:02'],
  ['Grace Nwosu', 'worker', ['GH1-Z1', 'GH1-Z4'], null, 'PTO', '5 days ago'],
];

const NOTIFY_EVENTS: Array<[string, string]> = [
  ['crit', 'Critical alerts'],
  ['warn', 'Warnings'],
  ['ai', 'AI detections'],
  ['task', 'Task assignments'],
  ['shift', 'Shift changes'],
];
const NOTIFY_CHANNELS = [
  { key: 'app', label: 'In-app', available: OK },
  {
    key: 'email',
    label: 'Email',
    available: no(
      'No mail server is configured. Email needs external infrastructure and is disabled by default (offline-first).',
    ),
  },
  {
    key: 'sms',
    label: 'SMS',
    available: no(
      'No SMS gateway is configured. SMS needs external infrastructure and is disabled by default (offline-first).',
    ),
  },
];

export const PEOPLE: Person[] = ROWS.map(([name, r, zones, shift, status, last], i) => {
  const base: ShiftCode = shift === 'Evening' ? 'E' : 'D';
  const off = [(5 + (i % 3)) % 7, (6 + (i % 3)) % 7];
  return {
    name,
    role: r,
    zones,
    shift,
    status,
    last,
    phone: `(519) 555-01${String(10 + i * 7).padStart(2, '0')}`,
    email: email(name),
    week: Array.from({ length: 7 }, (_, d) =>
      status === 'PTO' ? (d < 5 ? 'P' : 'O') : off.includes(d) ? 'O' : base,
    ),
    notify: Object.fromEntries(
      NOTIFY_EVENTS.map(([k]) => [k, [true, false, false]]),
    ) as Person['notify'],
  };
});

function record(a: Actor, action: string, target: string, detail: string) {
  auditLog.record(a.name, action, target, detail);
}

/** Role catalogue (OD-9: the design's 7 roles until the Brain defines its own). */
export const roles = () => ROLES.map((r) => ({ id: r.id, name: r.name, short: r.short }));

export const findPerson = (name: string) => PEOPLE.find((p) => p.name === name);
function byId(id: string) {
  const p = PEOPLE.find((x) => personId(x.name) === id);
  if (!p) throw new MockError(404, 'not_found', 'Unknown person.');
  return p;
}

const ZONE_IDS = ZONES.map((z) => z.id as string);
const hasZone = (p: Person, id: string) =>
  p.zones.includes(id) ||
  (id !== 'All' && p.zones.includes(ZONES.find((z) => z.id === id)?.gh ?? ''));

function weekDays(now: Date) {
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

/** Paid hours: an 8.5 h shift includes a 30-min unpaid break (assumption; see docs/design). */
const hours = (p: Person) => p.week.filter((c) => c === 'D' || c === 'E').length * 8;

function row(p: Person) {
  return {
    id: personId(p.name),
    name: p.name,
    email: p.email,
    role_id: p.role,
    role_name: role(p.role).name,
    zones: p.zones,
    status: p.status,
  };
}

export function list(q: URLSearchParams) {
  const text = (q.get('q') ?? '').toLowerCase();
  const r = q.get('role');
  return PEOPLE.filter((p) => !r || r === 'all' || p.role === r)
    .filter(
      (p) => !text || `${p.name} ${p.email} ${role(p.role).name}`.toLowerCase().includes(text),
    )
    .map(row);
}

export function detail(a: Actor, id: string) {
  const p = byId(id);
  const self = p.name === a.name;
  const manage = can(a, 'user.manage');
  const lock = no('Only System Administrators can manage users, roles and access.');
  return {
    ...row(p),
    phone: p.phone,
    last_active: p.last,
    zone_access: ['All', ...ZONE_IDS].map((z) => ({
      id: z,
      label: z === 'All' ? 'All zones' : z,
      on: hasZone(p, z),
    })),
    roles: ROLES.map((x) => ({ id: x.id, label: x.name })),
    notifications: {
      channels: NOTIFY_CHANNELS,
      events: NOTIFY_EVENTS.map(([key, label]) => ({ key, label, on: p.notify[key]! })),
      can_edit: self || manage ? OK : no('You can only change your own notification preferences.'),
    },
    recent: auditLog.about(p.name).slice(0, 4),
    actions: {
      change_role: !manage
        ? lock
        : self
          ? no('You cannot change your own role (prevents lock-out).')
          : OK,
      edit_zones: manage ? OK : lock,
      deactivate: !manage
        ? lock
        : self
          ? no('You cannot deactivate your own account.')
          : p.status === 'Deactivation pending'
            ? no('Deactivation is already waiting for a second administrator.')
            : OK,
    },
    origin: 'SIMULATED',
  };
}

export function update(
  a: Actor,
  id: string,
  b: { role?: string; zone?: string; notify?: { event: string; channel: string } },
) {
  const p = byId(id);
  const d = detail(a, id);
  let message = 'Saved.';
  if (b.role) {
    if (!d.actions.change_role.allowed)
      throw new MockError(
        can(a, 'user.manage') ? 409 : 403,
        'not_allowed',
        d.actions.change_role.reason!,
      );
    if (!ROLES.some((r) => r.id === b.role))
      throw new MockError(422, 'invalid_role', 'Unknown role.');
    const old = role(p.role).name;
    p.role = b.role as RoleId;
    record(a, 'Role assigned', p.name, `${old} → ${role(p.role).name}`);
    message = `${p.name} is now ${role(p.role).name}. Permissions apply from their next request.`;
  }
  if (b.zone) {
    if (!d.actions.edit_zones.allowed)
      throw new MockError(403, 'forbidden', d.actions.edit_zones.reason!);
    if (b.zone !== 'All' && !ZONE_IDS.includes(b.zone))
      throw new MockError(422, 'invalid_zone', 'Unknown zone.');
    const on = hasZone(p, b.zone);
    let z = p.zones.filter((x) => x !== b.zone);
    if (!on) z = b.zone === 'All' ? ['All'] : [...z.filter((x) => x !== 'All'), b.zone];
    else if (b.zone !== 'All' && p.zones.includes(ZONES.find((x) => x.id === b.zone)!.gh)) {
      // Removing one zone from a whole-greenhouse grant: keep the greenhouse's other zones.
      const gh = ZONES.find((x) => x.id === b.zone)!.gh;
      z = [
        ...z.filter((x) => x !== gh),
        ...ZONES.filter((x) => x.gh === gh && x.id !== b.zone).map((x) => x.id),
      ];
    } else if (b.zone === 'All') z = [];
    if (z.length === 0)
      throw new MockError(409, 'not_allowed', 'Everyone needs access to at least one zone.');
    p.zones = z;
    record(
      a,
      'Zone access changed',
      p.name,
      `${on ? '−' : '+'} ${b.zone === 'All' ? 'All zones' : b.zone}`,
    );
    message = `Zone access for ${p.name} updated.`;
  }
  if (b.notify) {
    if (!d.notifications.can_edit.allowed)
      throw new MockError(403, 'forbidden', d.notifications.can_edit.reason!);
    const ch = NOTIFY_CHANNELS.findIndex((c) => c.key === b.notify!.channel);
    if (ch < 0 || !(b.notify.event in p.notify))
      throw new MockError(422, 'invalid', 'Unknown notification setting.');
    if (!NOTIFY_CHANNELS[ch]!.available.allowed)
      throw new MockError(409, 'channel_unavailable', NOTIFY_CHANNELS[ch]!.available.reason!);
    if (b.notify.event === 'crit' && ch === 0 && p.notify.crit![0])
      throw new MockError(
        409,
        'not_allowed',
        'In-app critical alerts stay on: it is the only channel that can reach this person.',
      );
    p.notify[b.notify.event]![ch] = !p.notify[b.notify.event]![ch];
    message = 'Notification preferences saved.';
  }
  return { item: detail(a, id), message };
}

/** Revokes the person's sessions now; deactivation itself waits for a second administrator. */
export function deactivate(a: Actor, id: string) {
  const d = detail(a, id);
  if (!d.actions.deactivate.allowed)
    throw new MockError(
      can(a, 'user.manage') ? 409 : 403,
      'not_allowed',
      d.actions.deactivate.reason!,
    );
  const p = byId(id);
  p.status = 'Deactivation pending';
  record(a, 'Sessions revoked', p.name, 'Deactivation requested · needs a second administrator');
  return {
    item: detail(a, id),
    message: `${p.name}’s sessions were revoked. Deactivation needs a second administrator’s approval.`,
    revoked: p.name,
  };
}

export function invite(a: Actor, b: { name?: string; email?: string; role?: string }) {
  if (!can(a, 'user.manage'))
    throw new MockError(403, 'forbidden', 'Only System Administrators can invite users.');
  const name = String(b.name ?? '').trim();
  const mail = String(b.email ?? '')
    .trim()
    .toLowerCase();
  if (name.length < 3) throw new MockError(422, 'invalid_name', 'Enter the person’s full name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail))
    throw new MockError(422, 'invalid_email', 'Enter a valid email address.');
  if (!ROLES.some((r) => r.id === b.role))
    throw new MockError(422, 'invalid_role', 'Choose a role.');
  if (PEOPLE.some((p) => p.email === mail || p.name === name))
    throw new MockError(409, 'duplicate', 'This person is already in the directory.');
  PEOPLE.push({
    name,
    role: b.role as RoleId,
    zones: ['All'],
    shift: null,
    status: 'Invited',
    last: '—',
    phone: '—',
    email: mail,
    week: Array(7).fill('O') as ShiftCode[],
    notify: Object.fromEntries(
      NOTIFY_EVENTS.map(([k]) => [k, [true, false, false]]),
    ) as Person['notify'],
  });
  record(a, 'User invited', name, role(b.role as RoleId).name);
  return {
    item: row(PEOPLE.at(-1)!),
    message: `${name} was added as Invited. No email is sent: they activate the account by signing in on the local network.`,
  };
}

const CELL: Record<ShiftCode, { label: string; time: string }> = {
  D: { label: 'Day', time: '06:00–14:30' },
  E: { label: 'Evening', time: '14:00–22:30' },
  O: { label: 'Off', time: '' },
  P: { label: 'PTO', time: 'Approved' },
};

export function shifts(a: Actor, now: Date) {
  const days = weekDays(now);
  const today = (now.getDay() + 6) % 7;
  const fmt = (d: Date) => d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  const edit = can(a, 'shift.edit')
    ? OK
    : no('View only — your role cannot edit shift assignments.');
  return {
    title: `Week of ${fmt(days[0]!)} – ${fmt(days[6]!)}, ${days[6]!.getFullYear()}`,
    note: edit.allowed
      ? 'Click a cell to cycle Day → Evening → Off. Changes are logged.'
      : edit.reason,
    can_edit: edit,
    days: days.map((d, i) => ({
      label: `${d.toLocaleDateString('en-CA', { weekday: 'short' })} ${d.getDate()}`,
      today: i === today,
    })),
    rows: PEOPLE.map((p) => {
      const h = hours(p);
      return {
        id: personId(p.name),
        name: p.name,
        role_id: p.role,
        role_label: role(p.role).short,
        hours: h,
        availability:
          p.status === 'PTO'
            ? 'PTO this week'
            : h > 40
              ? 'Overtime risk'
              : p.status === 'Invited'
                ? 'Not active yet'
                : 'Available',
        availability_tone:
          p.status === 'PTO' ? 'warn' : h > 40 ? 'crit' : p.status === 'Invited' ? 'off' : 'ok',
        cells: p.week.map((c) => ({ code: c, ...CELL[c] })),
      };
    }),
    coverage: days.map((_, i) => ({
      day: PEOPLE.filter((p) => p.week[i] === 'D').length,
      evening: PEOPLE.filter((p) => p.week[i] === 'E').length,
    })),
    origin: 'SIMULATED',
  };
}

export function cycleShift(a: Actor, now: Date, id: string, day: number) {
  if (!can(a, 'shift.edit'))
    throw new MockError(403, 'forbidden', 'Your role cannot edit shift assignments.');
  const p = byId(id);
  if (!Number.isInteger(day) || day < 0 || day > 6)
    throw new MockError(422, 'invalid_day', 'Unknown day.');
  const c = p.week[day]!;
  if (c === 'P')
    throw new MockError(
      409,
      'not_allowed',
      'Approved PTO can only be changed from the leave request.',
    );
  const nx: ShiftCode = c === 'D' ? 'E' : c === 'E' ? 'O' : 'D';
  p.week[day] = nx;
  const label = shifts(a, now).days[day]!.label;
  record(a, 'Shift changed', p.name, `${label}: ${CELL[c].label} → ${CELL[nx].label}`);
  return { item: shifts(a, now), message: `${p.name} · ${label}: ${CELL[nx].label}.` };
}
