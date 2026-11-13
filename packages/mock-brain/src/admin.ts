/**
 * Mock Administration: RBAC matrix (changes apply to the mock sessions at once), device
 * registry is the devices module, system configuration validated per field, audit trail.
 * Values that the installer, firmware or an ADR own are read-only here and say why.
 */
import { PERMS, ROLES, type RoleId } from './design-data.ts';
import { USERS } from './fixtures.ts';
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

const GROUPS: Array<[string, Array<[string, string]>]> = [
  [
    'Navigation',
    [
      ['nav.dashboard', 'Executive dashboard'],
      ['nav.greenhouses', 'Greenhouses & crops'],
      ['nav.environment', 'Environmental monitoring'],
      ['nav.plantHealth', 'AI plant health'],
      ['nav.tasks', 'Tasks'],
      ['nav.workforce', 'Workforce'],
      ['nav.admin', 'Administration'],
      ['nav.alerts', 'Alerts & incidents'],
      ['nav.robots', 'Robot mission center'],
      ['nav.handover', 'Shift handover'],
      ['nav.escalation', 'Escalation rules'],
      ['nav.zones', 'Zones & inventory'],
      ['nav.devices', 'Devices & health'],
      ['nav.aiControl', 'AI control & safety'],
    ],
  ],
  ['Data scope', [['zone.all', 'Access all zones (else assigned only)']]],
  [
    'Crops',
    [
      ['batch.edit', 'Create & edit crop batches'],
      ['plant.observe', 'Log plant observations'],
    ],
  ],
  [
    'Environment',
    [
      ['env.configure', 'Configure operating ranges'],
      ['env.pump', 'Control irrigation pumps (irrigation disabled by design)'],
    ],
  ],
  [
    'AI plant health',
    [
      ['ai.confirm', 'Confirm / reject AI diagnosis'],
      ['ai.request', 'Request human inspection'],
      ['ai.chat', 'Chat with Lefi (reads only what the role can see)'],
    ],
  ],
  [
    'Incidents',
    [
      ['incident.report', 'Report incidents manually'],
      ['incident.ack', 'Acknowledge incidents'],
      ['incident.assign', 'Assign / reassign incidents'],
      ['incident.resolve', 'Resolve incidents'],
      ['incident.close', 'Close incidents'],
    ],
  ],
  [
    'Robot',
    [
      ['robot.command', 'Issue robot movement commands'],
      ['robot.camera', 'Request photos & live video'],
      ['robot.queue', 'Reprioritise / cancel queued missions'],
    ],
  ],
  [
    'Tasks & shifts',
    [
      ['task.all', 'View all crew tasks'],
      ['task.assign', 'Create & assign tasks'],
      ['shift.edit', 'Edit shift assignments'],
      ['task.verify', 'Verify completed work'],
      ['handover.sign', 'Sign shift handover'],
      ['handover.ack', 'Acknowledge shift handover'],
    ],
  ],
  [
    'Administration',
    [
      ['user.manage', 'Manage users, roles & access'],
      ['admin.roles', 'View roles & permissions'],
      ['admin.devices', 'View device registry'],
      ['device.manage', 'Register & edit devices'],
      ['admin.config', 'Edit system configuration'],
      ['admin.audit', 'View audit trail'],
      ['escalation.edit', 'Edit escalation rules'],
    ],
  ],
  [
    'Safety & AI control',
    [
      ['ai.halt', 'Emergency stop · AI & automations'],
      ['ai.resume', 'Resume AI after a stop'],
      ['ai.autonomy', 'Set AI autonomy & AI settings'],
      ['device.ai', 'Isolate devices from AI / pause readings'],
      ['device.power', 'Cut / restore device power (always locked: no actuator)'],
      ['zone.manage', 'Create & edit zones'],
      ['escalation.oncall', 'Manage 24/7 on-call roster'],
    ],
  ],
];
const LABEL = Object.fromEntries(GROUPS.flatMap(([, rows]) => rows));
/** Grants the System Administrator must keep, or nobody could manage access any more. */
const LOCKOUT = new Set(['user.manage', 'nav.admin', 'admin.roles']);

export function permissions(a: Actor) {
  const edit = can(a, 'user.manage')
    ? OK
    : no('Only System Administrators can change permissions.');
  return {
    note: edit.allowed
      ? 'Click any cell to grant or revoke. Changes apply to navigation, data scope and actions immediately.'
      : 'Read-only · only System Administrators can change permissions.',
    can_edit: edit,
    roles: ROLES.map((r) => ({
      id: r.id,
      short: r.short,
      name: r.name,
      users: PEOPLE.filter((p) => p.role === r.id).length,
    })),
    groups: GROUPS.map(([label, rows]) => ({
      label,
      rows: rows.map(([key, l]) => ({
        key,
        label: l,
        roles: PERMS[key] ?? [],
        locked: ROLES.filter((r) => r.id === 'admin' && LOCKOUT.has(key)).map((r) => r.id),
      })),
    })),
  };
}

/** Recompute the mock accounts' permissions so a change applies on their next request. */
function applyToSessions() {
  for (const u of USERS) {
    u.permissions = Object.entries(PERMS)
      .filter(([, roles]) => roles.includes(u.role.id))
      .map(([p]) => p);
  }
}

export function setPermission(
  a: Actor,
  b: { permission?: string; role?: string; granted?: boolean },
) {
  if (!can(a, 'user.manage'))
    throw new MockError(403, 'forbidden', 'Only System Administrators can change permissions.');
  const key = String(b.permission ?? '');
  const role = ROLES.find((r) => r.id === b.role);
  if (!(key in LABEL)) throw new MockError(404, 'not_found', 'Unknown permission.');
  if (!role) throw new MockError(422, 'invalid_role', 'Unknown role.');
  if (role.id === 'admin' && LOCKOUT.has(key) && !b.granted)
    throw new MockError(
      409,
      'lockout',
      `System Administrator must keep “${LABEL[key]}” to prevent lock-out.`,
    );
  const cur = PERMS[key] ?? [];
  PERMS[key] = b.granted
    ? [...new Set([...cur, role.id as RoleId])]
    : cur.filter((r) => r !== role.id);
  applyToSessions();
  auditLog.record(
    a.name,
    'Permission changed',
    role.name,
    `${b.granted ? '+' : '−'} ${LABEL[key]}`,
  );
  return {
    item: permissions(a),
    message: `${role.short}: ${b.granted ? 'granted' : 'removed'} “${LABEL[key]}”. Applies from their next request.`,
  };
}

type Kind = 'text' | 'number' | 'toggle';
interface Field {
  key: string;
  label: string;
  kind: Kind;
  unit: string | null;
  value: string;
  hint: string | null;
  /** null = editable by admin.config; otherwise why it is read-only here. */
  fixed: string | null;
  check?: (v: string) => string | null;
}
const int = (min: number, max: number) => (v: string) =>
  /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max
    ? null
    : `Enter a whole number from ${min} to ${max}.`;
const num = (min: number, max: number) => (v: string) =>
  /^\d+(\.\d+)?$/.test(v) && Number(v) >= min && Number(v) <= max
    ? null
    : `Enter a number from ${min} to ${max}.`;

const SECTIONS: Array<{ title: string; fields: Field[] }> = [
  {
    title: 'Facility & locale',
    fields: [
      {
        key: 'facility',
        label: 'Facility name',
        kind: 'text',
        unit: null,
        value: 'Lefi Farms Leamington (demo)',
        hint: null,
        fixed: null,
        check: (v) => (v.trim().length >= 3 && v.length <= 80 ? null : 'Use 3–80 characters.'),
      },
      {
        key: 'timezone',
        label: 'Time zone',
        kind: 'text',
        unit: null,
        value: 'America/Toronto',
        hint: 'IANA name; the Brain is the time authority (ADR-008)',
        fixed: null,
        check: (v) =>
          Intl.supportedValuesOf('timeZone').includes(v)
            ? null
            : 'Use an IANA time zone, e.g. America/Toronto.',
      },
      {
        key: 'units',
        label: 'Units',
        kind: 'text',
        unit: null,
        value: 'Metric · °C',
        hint: null,
        fixed: 'Fixed: the MQTT contract uses SI units.',
      },
      {
        key: 'date_format',
        label: 'Date format',
        kind: 'text',
        unit: null,
        value: 'YYYY-MM-DD · en-CA',
        hint: null,
        fixed: 'Fixed for this release.',
      },
    ],
  },
  {
    title: 'Data & integrations',
    fields: [
      {
        key: 'broker',
        label: 'MQTT broker',
        kind: 'text',
        unit: null,
        value: 'mqtt://192.168.8.10:1883',
        hint: 'Core node on the local network',
        fixed: 'Set by the installer on the core node (lefi setup); not editable from a client.',
      },
      {
        key: 'publish_interval',
        label: 'Device publish interval',
        kind: 'text',
        unit: null,
        value: '—',
        hint: null,
        fixed: 'Set by the ESP32 firmware, which is not written yet.',
      },
      {
        key: 'retention_months',
        label: 'Data retention',
        kind: 'number',
        unit: 'months',
        value: '',
        hint: 'Not defined yet — required before long runs (ADR-011)',
        fixed: null,
        check: (v) => (v === '' ? null : int(1, 120)(v)),
      },
      {
        key: 'ai_review_threshold',
        label: 'AI review threshold',
        kind: 'number',
        unit: '%',
        value: '60',
        hint: 'Detections below it always go to human review',
        fixed: null,
        check: int(0, 100),
      },
    ],
  },
  {
    title: 'Security',
    fields: [
      {
        key: 'mfa',
        label: 'Require multi-factor authentication',
        kind: 'toggle',
        unit: null,
        value: 'off',
        hint: 'Applies to all roles except kiosk accounts',
        fixed: 'Not available yet: the Brain has no multi-factor authentication.',
      },
      {
        key: 'session_hours',
        label: 'Session timeout',
        kind: 'number',
        unit: 'h',
        value: '12',
        hint: null,
        fixed: null,
        check: int(1, 24),
      },
    ],
  },
  {
    title: 'Operations & safety defaults',
    fields: [
      {
        key: 'stale_min',
        label: 'Stale-data alert after',
        kind: 'number',
        unit: 'min',
        value: '15',
        hint: null,
        fixed: null,
        check: int(1, 120),
      },
      {
        key: 'heartbeat_min',
        label: 'Device heartbeat timeout',
        kind: 'number',
        unit: 'min',
        value: '5',
        hint: null,
        fixed: null,
        check: int(1, 60),
      },
      {
        key: 'robot_speed',
        label: 'Robot max speed near crew',
        kind: 'number',
        unit: 'm/s',
        value: '0.3',
        hint: 'Simulated robot',
        fixed: null,
        check: num(0.1, 0.5),
      },
      {
        key: 'robot_reserve',
        label: 'Robot return-to-dock battery',
        kind: 'number',
        unit: '%',
        value: '25',
        hint: 'Simulated robot',
        fixed: null,
        check: int(10, 80),
      },
      {
        key: 'maint_lead_days',
        label: 'Maintenance reminder lead time',
        kind: 'number',
        unit: 'days',
        value: '14',
        hint: null,
        fixed: null,
        check: int(1, 60),
      },
      {
        key: 'irrigation_offline',
        label: 'Irrigation when AI is offline',
        kind: 'text',
        unit: null,
        value: 'Disabled',
        hint: null,
        fixed: 'Irrigation is interface-only and disabled by design; no actuator is controlled.',
      },
    ],
  },
];
const FIELDS = SECTIONS.flatMap((s) => s.fields);

export function config(a: Actor) {
  const edit = can(a, 'admin.config')
    ? OK
    : no('Only System Administrators can edit the system configuration.');
  return {
    can_edit: edit,
    sections: SECTIONS.map((s) => ({
      title: s.title,
      fields: s.fields.map(({ key, label, kind, unit, value, hint, fixed }) => ({
        key,
        label,
        kind,
        unit,
        value,
        hint: key === 'retention_months' && value ? 'Required before long runs (ADR-011)' : hint,
        editable: fixed ? no(fixed) : edit,
      })),
    })),
    origin: 'SIMULATED',
  };
}

export function saveConfig(a: Actor, b: { values?: Record<string, string> }) {
  if (!can(a, 'admin.config'))
    throw new MockError(
      403,
      'forbidden',
      'Only System Administrators can edit the system configuration.',
    );
  const values = b.values ?? {};
  const changes: string[] = [];
  const errors: Record<string, string> = {};
  for (const [key, raw] of Object.entries(values)) {
    const f = FIELDS.find((x) => x.key === key);
    if (!f) throw new MockError(422, 'unknown_field', `Unknown setting: ${key}.`);
    const v = String(raw).trim();
    if (v === f.value) continue;
    if (f.fixed) throw new MockError(409, 'read_only', `${f.label}: ${f.fixed}`);
    const err = f.check?.(v);
    if (err) errors[key] = err;
    else changes.push(key);
  }
  if (Object.keys(errors).length) {
    const [k, msg] = Object.entries(errors)[0]!;
    throw new MockError(422, 'invalid_config', `${FIELDS.find((x) => x.key === k)!.label}: ${msg}`);
  }
  if (changes.length === 0) return { item: config(a), message: 'Nothing changed.' };
  for (const k of changes) {
    const f = FIELDS.find((x) => x.key === k)!;
    auditLog.record(
      a.name,
      'Configuration updated',
      f.label,
      `${f.value || '—'} → ${String(values[k]).trim() || '—'}`,
    );
    f.value = String(values[k]).trim();
  }
  return {
    item: config(a),
    message: `Configuration saved (${changes.length} change${changes.length === 1 ? '' : 's'}). Recorded in the audit trail.`,
  };
}

export function audit(q: URLSearchParams) {
  return auditLog.list(q.get('q'));
}
