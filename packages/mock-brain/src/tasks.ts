/**
 * Mock tasks & work orders (prototype TASKS0 + TEXTRA). FAKE prototype content. Shared by the
 * dashboard, device maintenance and AI inspection requests. Lifecycle:
 * Open → In progress → Awaiting verification → Verified (or back to In progress).
 */
import { TASKS, ZONES, type RoleId } from './design-data.ts';
import { MockError } from './incidents.ts';

export type Status = 'Open' | 'In progress' | 'Awaiting verification' | 'Verified';

export interface MockTask {
  id: string;
  title: string;
  zone: string;
  assignee: string;
  due: string;
  priority: string;
  status: string;
  createdBy?: 'ai' | 'human';
  incident?: string | null;
  type?: 'Task' | 'Work order';
  source?: string;
  notes?: string;
  evidence?: string[];
  verifiedBy?: string | null;
}

const SOURCE: Record<string, string> = {
  'T-1174': 'Maintenance plan',
  'T-1184': 'AI detection AI-1028-0142',
  'T-1183': 'Harvest plan',
  'T-1182': 'Device alert',
  'T-1181': 'AI detection AI-1028-0137',
  'T-1180': 'Supervisor',
  'T-1179': 'Sensor alert',
  'T-1178': 'Weekly IPM',
  'T-1177': 'Supervisor',
};
const EXTRA: Record<string, Partial<MockTask>> = {
  'T-1174': {
    notes: 'Belt replaced and tension checked. Fan running at 1,420 rpm.',
    evidence: ['IMG-4790 · new belt fitted'],
  },
  'T-1184': { createdBy: 'ai', incident: 'INC-0184' },
  'T-1182': { createdBy: 'ai', incident: 'INC-0182', type: 'Work order' },
  'T-1181': { createdBy: 'ai', incident: 'INC-0186' },
  'T-1180': { incident: 'INC-0181' },
  'T-1179': { createdBy: 'ai', incident: 'INC-0186', type: 'Work order' },
};

const tasks: MockTask[] = [
  ...TASKS.map((t) => ({ ...t, source: SOURCE[t.id] ?? 'Supervisor', ...EXTRA[t.id] })),
  {
    id: 'T-1176',
    title: 'Seed trays for batch B-2629',
    zone: 'GH3-P1',
    assignee: 'Mei Chen',
    due: 'Oct 27',
    priority: 'Normal',
    status: 'Verified',
    source: 'Production plan',
    notes: '128 trays seeded, lot 4441. Germination chamber set to 20 °C.',
    evidence: ['IMG-4711 · seeded trays'],
    verifiedBy: 'Owen MacLeod',
  },
  {
    id: 'T-1175',
    title: 'Transplant row 3 to rafts',
    zone: 'GH1-Z3',
    assignee: 'Amrit Gill',
    due: 'Oct 27',
    priority: 'Normal',
    status: 'Verified',
    source: 'Production plan',
    notes: 'Row 3 transplanted, 3,400 plugs. 12 culls discarded.',
    evidence: ['IMG-4702 · row 3'],
    verifiedBy: 'Marcus Okafor',
  },
];
let next = 1190;

export const allTasks = () => tasks;

/** Used by device maintenance and AI inspection requests. */
export function addTask(t: Omit<MockTask, 'id'>): MockTask {
  const task: MockTask = { id: `T-${next++}`, createdBy: 'human', type: 'Task', ...t };
  tasks.unshift(task);
  return task;
}

interface Actor {
  name: string;
  role: RoleId;
  permissions: string[];
}
const can = (a: Actor, p: string) => a.permissions.includes(p);
/** Without `task.all` a user only sees their own tasks (design). */
export const scoped = (a: Actor) =>
  can(a, 'task.all') ? tasks : tasks.filter((t) => t.assignee === a.name);

const FILTER: Record<string, (t: MockTask) => boolean> = {
  open: (t) => t.status === 'Open',
  in_progress: (t) => t.status === 'In progress',
  awaiting: (t) => t.status === 'Awaiting verification',
  verified: (t) => t.status === 'Verified',
  pending: (t) => t.status !== 'Verified',
};

function row(t: MockTask) {
  return {
    id: t.id,
    title: t.title,
    zone_id: t.zone,
    assignee: t.assignee,
    due_label: t.due,
    priority: t.priority.toLowerCase(),
    status: t.status,
    created_by: t.createdBy ?? 'human',
    incident_id: t.incident ?? null,
    type: t.type ?? 'Task',
    origin: 'SIMULATED',
  };
}

function availability(t: MockTask, a: Actor) {
  const owner = t.assignee === a.name || can(a, 'task.assign');
  const ownerGate = (ok: boolean, why: string) =>
    !owner
      ? { allowed: false, reason: `Only the assignee or a supervisor can change ${t.id}.` }
      : ok
        ? { allowed: true, reason: null }
        : { allowed: false, reason: why };
  const verifyGate = (ok: boolean) =>
    !can(a, 'task.verify')
      ? { allowed: false, reason: 'Requires permission: Verify completed work' }
      : ok
        ? { allowed: true, reason: null }
        : { allowed: false, reason: 'Only work awaiting verification can be verified.' };
  return {
    start: ownerGate(t.status === 'Open', `${t.id} is ${t.status.toLowerCase()}.`),
    submit: ownerGate(t.status === 'In progress', 'Start the work first.'),
    verify: verifyGate(t.status === 'Awaiting verification'),
    return: verifyGate(t.status === 'Awaiting verification'),
    attach_photo: {
      allowed: false,
      reason: 'Photo upload is not available yet: the Brain has no file store.',
    },
  };
}

const detail = (t: MockTask, a: Actor) => ({
  ...row(t),
  source: t.source ?? '—',
  notes: t.notes ?? null,
  evidence: (t.evidence ?? []).map((label) => ({ label, image_url: null })),
  verified_by: t.verifiedBy ?? null,
  actions: availability(t, a),
});

export function list(a: Actor, q: URLSearchParams) {
  const pred = FILTER[q.get('filter') ?? 'all'];
  const text = (q.get('q') ?? '').toLowerCase();
  return scoped(a)
    .filter((t) => !pred || pred(t))
    .filter(
      (t) => !text || `${t.id} ${t.title} ${t.zone} ${t.assignee}`.toLowerCase().includes(text),
    )
    .map(row);
}

export function summary(a: Actor) {
  const s = scoped(a);
  return {
    scope_label: can(a, 'task.all')
      ? `All crew tasks in your zones · ${s.length} total`
      : `Assigned to you · ${s.length} tasks · read-only for other crew`,
    counts: {
      open: s.filter(FILTER.open!).length,
      in_progress: s.filter(FILTER.in_progress!).length,
      awaiting: s.filter(FILTER.awaiting!).length,
      verified: s.filter(FILTER.verified!).length,
      all: s.length,
    },
    can_create: can(a, 'task.assign')
      ? { allowed: true, reason: null }
      : { allowed: false, reason: 'Requires permission: Create & assign tasks' },
  };
}

export const pendingCount = (a: Actor) => scoped(a).filter(FILTER.pending!).length;

const find = (a: Actor, id: string) => {
  const t = scoped(a).find((x) => x.id === id);
  if (!t) throw new MockError(404, 'not_found', `Task ${id} not found.`);
  return t;
};

export const get = (a: Actor, id: string) => detail(find(a, id), a);

export function create(
  a: Actor,
  body: { title?: string; zone_id?: string; assignee?: string; priority?: string },
  people: string[],
) {
  if (!can(a, 'task.assign'))
    throw new MockError(403, 'forbidden', 'Requires permission: Create & assign tasks');
  const title = String(body.title ?? '').trim();
  if (!title) throw new MockError(422, 'invalid_title', 'Add a task title first.');
  if (!ZONES.some((z) => z.id === body.zone_id))
    throw new MockError(422, 'invalid_zone', 'Choose a zone.');
  if (!people.includes(String(body.assignee)))
    throw new MockError(422, 'invalid_assignee', 'Choose someone from the roster.');
  const priority =
    ['Normal', 'High', 'Critical'].find(
      (p) => p.toLowerCase() === String(body.priority).toLowerCase(),
    ) ?? 'Normal';
  const t = addTask({
    title,
    zone: body.zone_id!,
    assignee: body.assignee!,
    due: 'Today 17:00',
    priority,
    status: 'Open',
    source: a.name,
  });
  return { item: row(t), message: `${t.id} assigned to ${t.assignee}.` };
}

export function transition(a: Actor, id: string, body: { action?: string; notes?: string }) {
  const t = find(a, id);
  const action = body.action as 'start' | 'submit' | 'verify' | 'return';
  if (!['start', 'submit', 'verify', 'return'].includes(action))
    throw new MockError(422, 'invalid_action', 'Unknown action.');
  const av = availability(t, a)[action];
  if (!av.allowed) {
    const perm =
      action === 'verify' || action === 'return'
        ? !can(a, 'task.verify')
        : t.assignee !== a.name && !can(a, 'task.assign');
    throw new MockError(
      perm ? 403 : 409,
      perm ? 'forbidden' : 'invalid_state',
      av.reason ?? 'Not allowed.',
    );
  }
  let message: string;
  if (action === 'start') {
    t.status = 'In progress';
    message = `${t.id} started.`;
  } else if (action === 'submit') {
    const notes = String(body.notes ?? '').trim();
    if (notes.length < 8)
      throw new MockError(
        422,
        'notes_required',
        'Add completion notes before submitting for verification.',
      );
    t.status = 'Awaiting verification';
    t.notes = notes;
    message = `${t.id} sent to the supervisor for verification.`;
  } else if (action === 'verify') {
    t.status = 'Verified';
    t.verifiedBy = a.name;
    message = `${t.id} verified.`;
  } else {
    t.status = 'In progress';
    message = `${t.id} returned to the assignee.`;
  }
  return { item: detail(t, a), message };
}
