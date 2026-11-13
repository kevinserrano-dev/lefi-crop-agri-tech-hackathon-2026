import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  tasksApi,
  taskKeys,
  taskQueries,
  type NewBrainTask,
  type TaskItem,
  type TaskList,
  type TaskPhotoMeta,
  type TaskStatusFilter,
} from '@lefi/api';
import type { Tone } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { stamp, timeAgo } from '../../shared/lib/time';
import {
  Banner,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  FormField,
  Icon,
  ProvenanceBadge,
  SearchInput,
  Segmented,
  Select,
  Skeleton,
  TextArea,
  useToast,
  type Column,
} from '../../shared/ui';
import { useBrainNow, usePlaces } from '../live/common';
import { AlertInsightPanel } from '../health-review';
import { Pill } from '../tasks/TaskTable';
import design from '../tasks/tasks.module.css';
import styles from './tasks.module.css';

const KIND: Record<TaskItem['kind'], string> = {
  inspect_plants: 'Inspect plants',
  check_environment: 'Check conditions',
  check_sensor: 'Check a sensor',
  check_device: 'Check a device',
  check_system: 'Check Lefi Brain',
  robot_inspection: 'Robot inspection',
  other: 'Task',
};

const PRIORITY: Record<TaskItem['priority'], { label: string; tone: Tone }> = {
  urgent: { label: 'Critical', tone: 'crit' },
  high: { label: 'High', tone: 'warn' },
  normal: { label: 'Normal', tone: 'info' },
  low: { label: 'Low', tone: 'off' },
};

export const STATUS: Record<TaskItem['status'], { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'off' },
  in_progress: { label: 'In progress', tone: 'info' },
  awaiting: { label: 'Awaiting verification', tone: 'warn' },
  verified: { label: 'Verified', tone: 'ok' },
  done: { label: 'Done', tone: 'ok' },
  cancelled: { label: 'Cancelled', tone: 'off' },
};

const ORIGIN: Record<TaskItem['source'], { short: string; long: string; ai: boolean }> = {
  rule: { short: 'Rule', long: 'From a Lefi Brain alert', ai: false },
  ai: { short: 'AI', long: 'AI-generated · Lefi AI, to confirm', ai: true },
  person: { short: 'Human', long: 'Human-assigned', ai: false },
};

type Tab = Extract<TaskStatusFilter, 'open' | 'in_progress' | 'awaiting' | 'verified' | 'all'>;

const WORKING = new Set<TaskItem['status']>(['open', 'in_progress']);
const ACTIVE = new Set<TaskItem['status']>(['open', 'in_progress', 'awaiting']);

function useTaskMutation<A>(fn: (a: A) => Promise<unknown>, ok: string) {
  const qc = useQueryClient();
  const toast = useToast((t) => t.show);
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: taskKeys.all });
      toast(ok, 'ok');
    },
    onError: (e) => toast(describeError(e), 'bad'),
  });
}

function OriginTag({ task, long }: { task: TaskItem; long?: boolean }) {
  const o = ORIGIN[task.source];
  return (
    <span className={design.origin} data-ai={o.ai}>
      <span className={design.icon}>
        {o.ai ? 'smart_toy' : task.source === 'rule' ? 'rule' : 'person'}
      </span>
      {long ? o.long : o.short}
    </span>
  );
}

const who = (t: TaskItem) =>
  t.assignee === 'robot'
    ? 'Robot (waits)'
    : (t.assigned_to_name ?? (t.for_role ? `Waiting · any ${t.for_role}` : 'Unassigned'));

const matches = (t: TaskItem, q: string) =>
  !q ||
  [t.title, t.number, t.zone, t.alert_number, t.assigned_to_name, t.for_role]
    .filter(Boolean)
    .some((x) => x!.toLowerCase().includes(q));

/**
 * Tasks & Work Orders against the real Lefi Brain (ADR-089, ADR-093), in the design's layout:
 * tabs by status with counts, search, the table and the selected task. Lefi Brain makes tasks from
 * its alerts and gives them to a person of the right role; people make the others. Work marked
 * done waits for someone with `task.verify`, who verifies it or returns it with what is missing.
 * Robot inspections wait: no robot is connected yet, and the screen says so.
 */
export function TasksLive() {
  const platform = usePlatform();
  const now = useBrainNow();
  const [tab, setTab] = useState<Tab>('open');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const q = useQuery(taskQueries.list(platform, tab));
  if (q.isError)
    return (
      <EmptyState mascot="sad" title="Could not load tasks">
        {describeError(q.error)}
      </EmptyState>
    );
  if (!q.data) return <Skeleton height={520} />;
  const t = q.data;
  const c = t.counts;
  const needle = search.trim().toLowerCase();
  const rows = t.tasks.filter((x) => matches(x, needle));
  const current = rows.find((x) => x.id === selected) ?? rows[0];
  const columns: Column<TaskItem>[] = [
    {
      key: 'id',
      header: 'ID',
      width: '78px',
      render: (r) => <span className={design.monoMuted}>{r.number ?? '—'}</span>,
    },
    {
      key: 'task',
      header: 'Task',
      width: 'minmax(220px, 2.4fr)',
      render: (r) => (
        <div className={design.titleCell}>
          <span className={design.title}>{r.title}</span>
          <div className={design.tags}>
            <OriginTag task={r} />
            <span className={design.monoFaint}>{r.alert_number ?? '—'}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'zone',
      header: 'Zone',
      width: '0.8fr',
      render: (r) => <span className={design.mono}>{r.zone ?? '—'}</span>,
    },
    {
      key: 'who',
      header: 'Assignee',
      width: '1.1fr',
      render: (r) => (
        <span className={r.assigned_to_name ? undefined : styles.muted}>{who(r)}</span>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      width: '90px',
      render: (r) => <Pill tone={PRIORITY[r.priority].tone}>{PRIORITY[r.priority].label}</Pill>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '130px',
      render: (r) => <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>,
    },
  ];
  return (
    <div className={styles.stack}>
      <div className={design.toolbar}>
        <Segmented
          label="Task status"
          value={tab}
          onChange={(v) => {
            setTab(v);
            setSelected(undefined);
          }}
          options={[
            { value: 'open', label: `Open · ${c.open}` },
            { value: 'in_progress', label: `In progress · ${c.in_progress}` },
            { value: 'awaiting', label: `Awaiting verification · ${c.awaiting}` },
            { value: 'verified', label: `Verified · ${c.verified}` },
            { value: 'all', label: `All · ${c.all}` },
          ]}
        />
        <div className={design.rowGap}>
          <SearchInput
            placeholder="Search tasks"
            aria-label="Search tasks"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {t.can_create && (
            <Button icon="add" onClick={() => setCreating(true)}>
              New task
            </Button>
          )}
        </div>
      </div>
      <span className={design.scope}>
        {t.can_see_all
          ? `All crew tasks · ${c.all} total`
          : `Your tasks and those waiting for your role · ${c.all} total`}
        {t.tasks.some((x) => x.origin === 'SIMULATED') && (
          <>
            {' '}
            · <ProvenanceBadge origin="SIMULATED" /> made from simulated data
          </>
        )}
      </span>
      {c.robot > 0 && (
        <Banner tone="info" icon="smart_toy" title="Robot inspections are waiting">
          {t.robot.reason}
        </Banner>
      )}
      <div className={styles.layout}>
        <section className={styles.tableCard}>
          <DataTable
            label="Tasks"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => setSelected(r.id)}
            selectedKey={current?.id}
            minWidth={720}
          >
            {rows.length === 0 && (
              <EmptyState mascot="sleeping" title="No tasks here" compact>
                {needle
                  ? 'Nothing matches the search.'
                  : tab === 'open'
                    ? 'Lefi Brain makes a task when an alert needs someone to go and look.'
                    : 'Nothing in this tab. Try “All”.'}
              </EmptyState>
            )}
          </DataTable>
        </section>
        {current && <TaskPanel key={current.id} task={current} list={t} now={now} />}
      </div>
      <NewTaskDialog open={creating} list={t} onClose={() => setCreating(false)} />
    </div>
  );
}

const localInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function TaskPanel({ task, list, now }: { task: TaskItem; list: TaskList; now?: string }) {
  const platform = usePlatform();
  const [note, setNote] = useState('');
  const id = task.id;
  const start = useTaskMutation(() => tasksApi.start(platform, id), 'Task started');
  const done = useTaskMutation(
    () => tasksApi.complete(platform, id, note),
    'Sent for verification',
  );
  const verify = useTaskMutation(() => tasksApi.verify(platform, id, note), 'Work verified');
  const back = useTaskMutation(
    () => tasksApi.sendBack(platform, id, note),
    'Returned to the assignee',
  );
  const cancel = useTaskMutation(() => tasksApi.cancel(platform, id, note), 'Task cancelled');
  const assign = useTaskMutation(
    (user: string | null) => tasksApi.assign(platform, id, user),
    'Assignee changed',
  );
  const update = useTaskMutation(
    (body: Parameters<typeof tasksApi.update>[2]) => tasksApi.update(platform, id, body),
    'Task updated',
  );
  const manage = list.can_create && ACTIVE.has(task.status);
  const working = WORKING.has(task.status);
  return (
    <aside className={design.panel} aria-label={`Task ${task.number ?? task.title}`}>
      <div className={design.panelHead}>
        <div className={design.panelTitle}>
          <span className={design.monoMuted}>
            {task.number ?? 'Task'} · {KIND[task.kind]}
          </span>
          <span className={design.panelName}>{task.title}</span>
        </div>
        <Pill tone={STATUS[task.status].tone}>{STATUS[task.status].label}</Pill>
      </div>

      <div className={design.facts}>
        <div>
          <span>Origin</span>
          <OriginTag task={task} long />
        </div>
        <div>
          <span>Priority</span>
          {manage ? (
            <Select
              aria-label="Priority"
              value={task.priority}
              onChange={(e) => update.mutate({ priority: e.target.value as TaskItem['priority'] })}
            >
              {Object.entries(PRIORITY).map(([k, p]) => (
                <option key={k} value={k}>
                  {p.label}
                </option>
              ))}
            </Select>
          ) : (
            <b style={{ color: `var(--lefi-${PRIORITY[task.priority].tone}-fg)` }}>
              {PRIORITY[task.priority].label}
            </b>
          )}
        </div>
        <div>
          <span>Assignee</span>
          {list.can_create && working && task.assignee === 'person' ? (
            <Select
              aria-label="Assignee"
              value={task.assigned_to ?? ''}
              onChange={(e) => assign.mutate(e.target.value || null)}
            >
              <option value="">
                {task.for_role ? `Waiting · any ${task.for_role}` : 'Unassigned'}
              </option>
              {list.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.role}
                </option>
              ))}
            </Select>
          ) : (
            <b>{who(task)}</b>
          )}
        </div>
        <div>
          <span>Due</span>
          {manage ? (
            <input
              type="datetime-local"
              aria-label="Due"
              value={localInput(task.due_at)}
              onChange={(e) =>
                e.target.value
                  ? update.mutate({ due_at: new Date(e.target.value).toISOString() })
                  : update.mutate({ clear_due: true })
              }
            />
          ) : (
            <b>{task.due_at ? stamp(task.due_at) : 'Not set'}</b>
          )}
        </div>
        <div className={design.wide}>
          <span>Source</span>
          <span>
            {task.created_by} · {timeAgo(task.created_at, now)}
            {task.zone ? ` · ${task.zone}` : ''}{' '}
            <ProvenanceBadge origin={task.origin as 'LIVE' | 'SIMULATED'} />
          </span>
        </div>
      </div>

      {task.status === 'in_progress' && task.review_note && (
        <Banner tone="warn" icon="undo" title="Returned by the verifier">
          {task.review_note}
        </Banner>
      )}
      {task.assignee === 'person' && !task.assigned_to_name && task.for_role && working && (
        <Banner tone="warn" icon="pending_actions" title={`Waiting for a ${task.for_role}`}>
          Nobody holds this task yet. Lefi Brain gives it to the active {task.for_role} with the
          fewest tasks as soon as there is one; a supervisor or manager can assign it now.
        </Banner>
      )}
      {task.robot_note && (
        <Banner tone="info" icon="smart_toy" title="Waiting for a robot">
          {task.robot_note}
        </Banner>
      )}
      {task.detail && <p className={styles.detail}>{task.detail}</p>}

      {task.alert_id && (
        <>
          <a className={design.incident} href="#/alerts">
            <Icon name="crisis_alert" size={18} />
            Related incident {task.alert_number ?? ''}
            <span className={design.grow} />
            <Icon name="chevron_right" size={18} />
          </a>
          <AlertInsightPanel alertId={task.alert_id} now={now} />
        </>
      )}

      <PhotoEvidence task={task} canAdd={ACTIVE.has(task.status)} />

      {task.outcome && (
        <section className={design.section}>
          <span className={design.sectionLabel}>Completion notes</span>
          <span className={design.notes}>{task.outcome}</span>
          {task.completed_by && (
            <span className={styles.muted}>
              {task.completed_by}
              {task.completed_at ? ` · ${timeAgo(task.completed_at, now)}` : ''}
            </span>
          )}
        </section>
      )}

      {(working || (task.status === 'awaiting' && list.can_verify)) && (
        <TextArea
          aria-label="Note"
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            task.status === 'awaiting'
              ? 'Note for the assignee (required to return the work)'
              : 'Completion notes — what was done, readings, parts used'
          }
        />
      )}
      {task.status === 'open' && task.assignee === 'person' && (
        <Button
          variant="secondary"
          icon="play_arrow"
          disabled={start.isPending}
          onClick={() => start.mutate(undefined)}
        >
          Start work
        </Button>
      )}
      {working && (
        <Button icon="send" disabled={done.isPending} onClick={() => done.mutate(undefined)}>
          Submit for verification
        </Button>
      )}
      {task.status === 'awaiting' && list.can_verify && (
        <div className={design.verifyRow}>
          <Button
            variant="secondary"
            icon="undo"
            disabled={back.isPending || !note.trim()}
            onClick={() => back.mutate(undefined)}
          >
            Return to assignee
          </Button>
          <Button
            icon="verified"
            disabled={verify.isPending}
            onClick={() => verify.mutate(undefined)}
          >
            Verify work
          </Button>
        </div>
      )}
      {task.status === 'awaiting' && !list.can_verify && (
        <span className={styles.muted}>A supervisor or manager verifies this work.</span>
      )}
      {task.status === 'verified' && (
        <div className={design.verified}>
          <Icon name="verified" size={19} />
          Verified by {task.verified_by ?? 'a supervisor'}
          {task.verified_at ? ` · ${timeAgo(task.verified_at, now)}` : ''}
          {task.review_note ? ` · ${task.review_note}` : ''}
        </div>
      )}
      {task.status === 'cancelled' && task.closed_at && (
        <span className={styles.muted}>
          Cancelled by {task.closed_by} {timeAgo(task.closed_at, now)}
          {task.outcome ? `: ${task.outcome}` : ''}
        </span>
      )}
      {manage && (
        <Button
          size="sm"
          variant="ghost"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate(undefined)}
        >
          Cancel task
        </Button>
      )}
    </aside>
  );
}

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',', 2)[1] ?? '');
    r.onerror = () => reject(new Error('Could not read the photo'));
    r.readAsDataURL(file);
  });

/** Photo evidence (JPEG or PNG, ≤ 5 MB), kept by Lefi Brain with who attached it. */
function PhotoEvidence({ task, canAdd }: { task: TaskItem; canAdd: boolean }) {
  const platform = usePlatform();
  const qc = useQueryClient();
  const toast = useToast((t) => t.show);
  const photos = useQuery({
    queryKey: taskKeys.photos(task.id),
    queryFn: () => tasksApi.photos(platform, task.id),
  });
  const add = useMutation({
    mutationFn: async (file: File) => tasksApi.addPhoto(platform, task.id, await toBase64(file)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: taskKeys.photos(task.id) });
      toast('Photo attached', 'ok');
    },
    onError: (e) => toast(describeError(e), 'bad'),
  });
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) add.mutate(file);
  };
  const list = photos.data ?? [];
  return (
    <section className={design.section}>
      <div className={design.sectionHead}>
        <span className={design.sectionLabel}>Photo evidence</span>
        {canAdd && (
          <label className={styles.attach}>
            <Icon name="add_a_photo" size={16} /> {add.isPending ? 'Attaching…' : 'Attach photo'}
            <input
              type="file"
              accept="image/jpeg,image/png"
              aria-label="Attach photo"
              onChange={pick}
              hidden
            />
          </label>
        )}
      </div>
      {list.length === 0 ? (
        <span className={design.faint}>No evidence attached yet.</span>
      ) : (
        <div className={design.evidence}>
          {list.map((p) => (
            <Thumb key={p.id} photo={p} />
          ))}
        </div>
      )}
    </section>
  );
}

function Thumb({ photo }: { photo: TaskPhotoMeta }) {
  const platform = usePlatform();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: taskKeys.photo(photo.id),
    queryFn: () => tasksApi.photo(platform, photo.id),
    staleTime: Infinity,
  });
  const src = q.data ? `data:${q.data.content_type};base64,${q.data.image_base64}` : undefined;
  const caption = `${photo.uploaded_by} · ${stamp(photo.uploaded_at)}${photo.note ? ` · ${photo.note}` : ''}`;
  return (
    <>
      <button
        type="button"
        className={styles.thumb}
        title={caption}
        aria-label={`Photo by ${photo.uploaded_by}`}
        onClick={() => setOpen(true)}
      >
        {src ? <img src={src} alt="" /> : <Skeleton height={80} />}
      </button>
      {open && src && (
        <Dialog open onClose={() => setOpen(false)} labelledBy={`ph-${photo.id}`} width={820}>
          <div className={styles.viewer}>
            <span id={`ph-${photo.id}`} className={styles.muted}>
              {caption}
            </span>
            <img src={src} alt={caption} />
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function NewTaskDialog({
  open,
  list,
  onClose,
}: {
  open: boolean;
  list: TaskList;
  onClose: () => void;
}) {
  const platform = usePlatform();
  const places = usePlaces();
  const [form, setForm] = useState<NewBrainTask>({
    title: '',
    kind: 'other',
    assignee: 'person',
    priority: 'normal',
  });
  const [due, setDue] = useState('');
  const make = useTaskMutation((b: NewBrainTask) => tasksApi.create(platform, b), 'Task created');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    make.mutate(
      {
        ...form,
        detail: form.detail || null,
        zone_id: form.zone_id || null,
        assigned_to: form.assignee === 'person' ? form.assigned_to || null : null,
        due_at: due ? new Date(due).toISOString() : null,
      },
      { onSuccess: onClose },
    );
  };
  const set = (k: keyof NewBrainTask, v: string) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Dialog open={open} onClose={onClose} labelledBy="new-task-title">
      <form className={styles.form} onSubmit={submit} aria-label="New task">
        <h2 id="new-task-title">New task</h2>
        <FormField label="Title">
          <input
            className={styles.input}
            required
            maxLength={140}
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
          />
        </FormField>
        <FormField label="Details">
          <TextArea
            rows={3}
            maxLength={1000}
            value={form.detail ?? ''}
            onChange={(e) => set('detail', e.target.value)}
          />
        </FormField>
        <FormField label="Kind">
          <Select value={form.kind} onChange={(e) => set('kind', e.target.value)}>
            {Object.entries(KIND).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="For">
          <Select value={form.assignee} onChange={(e) => set('assignee', e.target.value)}>
            <option value="person">A person</option>
            <option value="robot">The robot (waits until one is connected)</option>
          </Select>
        </FormField>
        {form.assignee === 'person' && (
          <FormField label="Assignee">
            <Select
              value={form.assigned_to ?? ''}
              onChange={(e) => set('assigned_to', e.target.value)}
            >
              <option value="">Nobody yet</option>
              {list.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.role}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        <FormField label="Priority">
          <Select value={form.priority} onChange={(e) => set('priority', e.target.value)}>
            {Object.entries(PRIORITY).map(([k, p]) => (
              <option key={k} value={k}>
                {p.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Due (optional)">
          <input
            className={styles.input}
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </FormField>
        <FormField label="Zone">
          <Select value={form.zone_id ?? ''} onChange={(e) => set('zone_id', e.target.value)}>
            <option value="">No zone</option>
            {(places.data?.zones ?? []).map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </Select>
        </FormField>
        <div className={styles.buttons}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={make.isPending || !form.title.trim()}>
            Create
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
