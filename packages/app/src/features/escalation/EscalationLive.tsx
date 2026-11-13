import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  escalationApi,
  escalationKeys,
  escalationQueries,
  shiftKeys,
  shiftQueries,
  shiftsApi,
  type RoutingCategory,
  type RoutingPolicy,
  type RoutingView,
} from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { roleColor } from '../../shared/lib/roles';
import { stamp } from '../../shared/lib/time';
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Icon,
  Segmented,
  Select,
  Skeleton,
  Switch,
  useToast,
} from '../../shared/ui';
import styles from './escalation.module.css';

const ROLE_LABEL: Record<string, string> = {
  admin: 'System administrator',
  manager: 'Manager',
  grower: 'Grower',
  supervisor: 'Supervisor',
  scout: 'Scout',
  maint: 'Maintenance',
  worker: 'Worker',
};

function useMut<A>(fn: (a: A) => Promise<unknown>, ok: string, keys: readonly unknown[][]) {
  const qc = useQueryClient();
  const toast = useToast((t) => t.show);
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const k of keys) void qc.invalidateQueries({ queryKey: k });
      toast(ok, 'ok');
    },
    onError: (e) => toast(describeError(e), 'bad'),
  });
}

const policyOf = (v: RoutingView): RoutingPolicy => {
  const p = v.policy;
  return {
    mode: p.mode,
    roles: p.roles,
    match_role: p.match_role,
    skip_unavailable: p.skip_unavailable,
    warnings: p.warnings,
    quiet: p.quiet,
    quiet_start: p.quiet_start,
    quiet_end: p.quiet_end,
    delays: p.delays,
    fixed: p.fixed,
  };
};

/**
 * Escalation Rules against the real Lefi Brain (ADR-096), in the design's layout: who receives an
 * alert (resolved from Workforce shifts and the on-call roster, ADR-094), the rules people set,
 * the 24/7 on-call roster and the log of every routing decision. Alerts reach people only inside
 * Lefi Crop's apps: SMS and voice are shown as not available (no phone service offline).
 */
export function EscalationLive() {
  const q = useQuery(escalationQueries.view(usePlatform()));
  if (q.isError)
    return (
      <EmptyState mascot="sad" title="Could not load escalation">
        {describeError(q.error)}
      </EmptyState>
    );
  if (!q.data) return <Skeleton height={520} />;
  const v = q.data;
  return (
    <>
      <span className={styles.text}>
        {v.can_edit
          ? 'Managers and System Administrators edit these rules; every change is audited.'
          : 'Read-only · only Managers and System Administrators can edit escalation rules.'}
      </span>
      {!v.policy.set_by_person && (
        <div className={styles.notice}>
          <Icon name="info" size={18} />
          These are Lefi Brain’s starting values: review them and save to make them yours.
        </div>
      )}
      <div className={styles.top}>
        <RoutingCard v={v} />
        <OnCallCard />
      </div>
      <Deliveries v={v} />
    </>
  );
}

function RoutingCard({ v }: { v: RoutingView }) {
  const platform = usePlatform();
  const [category, setCategory] = useState<RoutingCategory>('environment');
  const slots = useMemo(() => {
    const now = new Date(v.brain_time);
    const at = (h: number) => new Date(now.getTime() + h * 3_600_000);
    const fmt = (d: Date) =>
      d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    return [
      { value: 'now', label: `Now · ${fmt(now)}`, at: undefined },
      { value: '8', label: fmt(at(8)), at: at(8).toISOString() },
      { value: '16', label: fmt(at(16)), at: at(16).toISOString() },
    ];
  }, [v.brain_time]);
  const [slot, setSlot] = useState('now');
  const at = slots.find((s) => s.value === slot)?.at;
  const preview = useQuery(escalationQueries.preview(platform, category, at));
  const save = useMut(
    (p: RoutingPolicy) => escalationApi.setPolicy(platform, p),
    'Escalation rules saved',
    [[...escalationKeys.all]],
  );
  const p = policyOf(v);
  const mode = p.mode ?? 'dynamic';
  const set = (patch: Partial<RoutingPolicy>) => save.mutate({ ...p, ...patch });
  const can = v.can_edit;
  return (
    <section className={styles.card}>
      <div className={styles.rowBetween}>
        <div className={styles.titleBlock}>
          <span className={styles.cardTitle}>Who receives the alert · dynamic escalation</span>
          <span className={styles.faint}>
            Configured here · resolved live from Workforce shifts and the on-call roster
          </span>
        </div>
        <Segmented<'dynamic' | 'fixed'>
          label="Escalation mode"
          value={mode}
          onChange={(m) => can && m !== mode && set({ mode: m })}
          options={[
            { value: 'dynamic', label: 'Dynamic · roster' },
            { value: 'fixed', label: 'Fixed chain' },
          ]}
        />
      </div>
      <span className={styles.text}>
        {mode === 'dynamic'
          ? 'For every alert Lefi Brain checks who is on shift right now, their role, skips anyone unavailable, works up the ranks (supervisor, manager) and finally the 24/7 on-call roster. Each routing decision is logged with its reason.'
          : 'Alerts go to the people below in this order, then to the 24/7 on-call roster. Each routing decision is logged.'}
      </span>
      {mode === 'fixed' && <FixedChain v={v} p={p} onSave={set} />}
      <div className={styles.previewBar}>
        <span className={styles.eyebrow}>Preview · critical alert</span>
        <Select
          aria-label="Incident type"
          value={category}
          onChange={(e) => setCategory(e.target.value as RoutingCategory)}
        >
          {Object.entries(v.categories).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
        <Segmented
          label="Time of the alert"
          value={slot}
          onChange={setSlot}
          options={slots.map(({ value, label }) => ({ value, label }))}
        />
      </div>
      {!preview.data ? (
        <Skeleton height={150} />
      ) : preview.data.steps.length === 0 ? (
        <span className={styles.faint}>
          Nobody would be told at that time: nobody is on shift and the 24/7 on-call roster is
          empty. Set shifts in Workforce → Shifts and people on call here.
        </span>
      ) : (
        <div className={styles.list} aria-label="Escalation preview">
          {preview.data.steps.map((s) => (
            <div key={s.level} className={styles.step}>
              <span className={styles.level}>L{s.level}</span>
              <div className={styles.stepText}>
                <b>
                  {s.name} <span className={styles.role}>· {ROLE_LABEL[s.role] ?? s.role}</span>
                </b>
                <span className={styles.faint}>{s.reason}</span>
              </div>
              <div className={styles.stepWhen}>
                <span className={styles.channel}>In the apps</span>
                <span className={styles.mono}>
                  {s.after_min === 0 ? 'Immediately' : `+${s.after_min} min if no ack`}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className={styles.resolver}>
        {v.channels.map((ch) => (
          <Badge
            key={ch.key}
            tone={ch.available ? 'ok' : 'off'}
            variant="tag"
            title={ch.reason ?? ch.label}
          >
            {ch.available ? 'In the apps' : `${ch.label} · not available`}
          </Badge>
        ))}
      </div>
      <div className={styles.list}>
        <Rule
          label="Match incident type to role"
          hint={Object.entries(p.roles)
            .map(([k, r]) => `${v.categories[k] ?? k} → ${ROLE_LABEL[r] ?? r}`)
            .join(' · ')}
          on={p.match_role}
          can={can}
          onChange={() => set({ match_role: !p.match_role })}
        />
        {can && p.match_role && <RoleMap v={v} p={p} onSave={set} />}
        <Rule
          label="Skip people on leave or off shift"
          hint="Reads Workforce shifts in real time"
          on={p.skip_unavailable}
          can={can}
          onChange={() => set({ skip_unavailable: !p.skip_unavailable })}
        />
        <Rule
          label="Escalate warnings too"
          hint="Critical alerts are always escalated"
          on={p.warnings}
          can={can}
          onChange={() => set({ warnings: !p.warnings })}
        />
        <Rule
          label="Warnings wait for the next shift at night"
          hint={`Only critical alerts wake people ${p.quiet_start}–${p.quiet_end} (greenhouse time, ${v.timezone})`}
          on={p.quiet}
          can={can}
          onChange={() => set({ quiet: !p.quiet })}
        />
        <div className={styles.toggleRow}>
          <div className={styles.stepText}>
            <b>Time to acknowledge before the next level</b>
            <span className={styles.faint}>
              Minutes after the previous level: {p.delays.slice(1).join(' · ') || '—'}
            </span>
          </div>
          {can && (
            <Select
              aria-label="Minutes between levels"
              value={String(p.delays[1] ?? 5)}
              onChange={(e) => {
                const m = Number(e.target.value);
                set({ delays: [0, m, m * 2] });
              }}
            >
              {[2, 5, 10, 15, 30].map((m) => (
                <option key={m} value={m}>
                  {m} min, then {m * 2} min
                </option>
              ))}
            </Select>
          )}
        </div>
        <div className={styles.toggleRow}>
          <div className={styles.stepText}>
            <b>Prefer staff checked in on site</b>
            <span className={styles.faint}>
              Not available: the mobile app has no on-site check-in yet
            </span>
          </div>
          <Switch
            label="Prefer staff checked in on site"
            on={false}
            disabled
            onChange={() => undefined}
          />
        </div>
      </div>
    </section>
  );
}

function Rule({
  label,
  hint,
  on,
  can,
  onChange,
}: {
  label: string;
  hint: string;
  on: boolean;
  can: boolean;
  onChange: () => void;
}) {
  return (
    <div className={styles.toggleRow}>
      <div className={styles.stepText}>
        <b>{label}</b>
        <span className={styles.faint}>{hint}</span>
      </div>
      <Switch
        label={label}
        on={on}
        disabled={!can}
        title={can ? undefined : 'Only Managers and System Administrators edit escalation rules'}
        onChange={can ? onChange : () => undefined}
      />
    </div>
  );
}

function RoleMap({
  v,
  p,
  onSave,
}: {
  v: RoutingView;
  p: RoutingPolicy;
  onSave: (patch: Partial<RoutingPolicy>) => void;
}) {
  return (
    <div className={styles.previewBar}>
      {Object.entries(v.categories).map(([k, label]) => (
        <label key={k} className={styles.faint}>
          {label}{' '}
          <Select
            aria-label={`Role for ${label}`}
            value={p.roles[k as RoutingCategory]}
            onChange={(e) =>
              onSave({ roles: { ...p.roles, [k]: e.target.value } as RoutingPolicy['roles'] })
            }
          >
            {v.roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r] ?? r}
              </option>
            ))}
          </Select>
        </label>
      ))}
    </div>
  );
}

function FixedChain({
  v,
  p,
  onSave,
}: {
  v: RoutingView;
  p: RoutingPolicy;
  onSave: (patch: Partial<RoutingPolicy>) => void;
}) {
  const [add, setAdd] = useState('');
  const people = v.people.map((x) => ({ id: x.id ?? '', name: x.name ?? '', role: x.role ?? '' }));
  const names = new Map(people.map((x) => [x.id, x]));
  const chain = p.fixed ?? [];
  return (
    <div className={styles.list} aria-label="Fixed chain">
      {chain.length === 0 && (
        <span className={styles.faint}>Add the people who are told first, in order.</span>
      )}
      {chain.map((id, i) => (
        <div key={id} className={styles.step}>
          <span className={styles.level}>{i + 1}</span>
          <div className={styles.stepText}>
            <b>{names.get(id)?.name ?? 'a former user'}</b>
            <span className={styles.faint}>{ROLE_LABEL[names.get(id)?.role ?? ''] ?? ''}</span>
          </div>
          {v.can_edit && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onSave({ fixed: chain.filter((x) => x !== id) })}
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      {v.can_edit && (
        <div className={styles.previewBar}>
          <Select
            aria-label="Add to the chain"
            value={add}
            onChange={(e) => setAdd(e.target.value)}
          >
            <option value="">Add a person…</option>
            {people
              .filter((x) => !chain.includes(x.id))
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} · {ROLE_LABEL[x.role] ?? x.role}
                </option>
              ))}
          </Select>
          <Button
            size="sm"
            disabled={!add}
            onClick={() => {
              onSave({ fixed: [...chain, add] });
              setAdd('');
            }}
          >
            Add
          </Button>
        </div>
      )}
    </div>
  );
}

function OnCallCard() {
  const platform = usePlatform();
  const q = useQuery(shiftQueries.oncall(platform));
  const [adding, setAdding] = useState('');
  const keys = [[...shiftKeys.all], [...escalationKeys.all]];
  const member = useMut(
    (a: { id: string; on: boolean; contact: string | null }) =>
      shiftsApi.setMember(platform, a.id, a.on, a.contact),
    'On-call roster saved',
    keys,
  );
  const primary = useMut(
    (a: { day: string; id: string | null }) => shiftsApi.setPrimary(platform, a.day, a.id),
    'Primary on call saved',
    keys,
  );
  if (!q.data) return <Skeleton height={300} />;
  const o = q.data;
  const enabled = o.members.filter((m) => m.enabled);
  return (
    <section className={styles.card}>
      <span className={styles.cardTitle}>24/7 on-call roster</span>
      <span className={styles.text}>
        People who agreed to receive critical alerts outside their shift. Lefi Brain tells today’s
        primary first, then the backups, inside the apps.
      </span>
      <div className={styles.list}>
        {o.members.length === 0 && (
          <span className={styles.faint}>Nobody is on the on-call roster yet.</span>
        )}
        {o.members.map((m) => (
          <div key={m.user_id} className={styles.toggleRow}>
            <Avatar name={m.name} size={32} color={roleColor(m.role)} />
            <div className={styles.stepText}>
              <b className={styles.nameLine}>
                {m.name}
                {m.primary_today && <span className={styles.primary}>Primary today</span>}
              </b>
              <span className={styles.faint}>
                {ROLE_LABEL[m.role] ?? m.role}
                {m.contact ? ` · ${m.contact}` : ''}
              </span>
            </div>
            <Switch
              label={`${m.name} on the 24/7 roster`}
              on={m.enabled}
              disabled={!o.can_edit}
              onChange={() =>
                member.mutate({ id: m.user_id, on: !m.enabled, contact: m.contact ?? null })
              }
            />
          </div>
        ))}
        {o.can_edit && o.candidates.length > 0 && (
          <div className={styles.previewBar}>
            <Select
              aria-label="Add to the on-call roster"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
            >
              <option value="">Add a person…</option>
              {o.candidates.map((c) => (
                <option key={c.user_id} value={c.user_id}>
                  {c.name} · {ROLE_LABEL[c.role] ?? c.role}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              disabled={!adding}
              onClick={() => {
                member.mutate({ id: adding, on: true, contact: null });
                setAdding('');
              }}
            >
              Add
            </Button>
          </div>
        )}
      </div>
      <span className={styles.eyebrowRule}>This week · primary on-call</span>
      <div className={styles.week}>
        {o.days.map((d) =>
          o.can_edit ? (
            <label key={d.day} className={styles.day} data-today={d.today}>
              <b>{d.label}</b>
              <select
                aria-label={`Primary on call ${d.label}`}
                value={d.user_id ?? ''}
                onChange={(e) => primary.mutate({ day: d.day, id: e.target.value || null })}
              >
                <option value="">—</option>
                {enabled.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name.split(' ')[0]}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div key={d.day} className={styles.day} data-today={d.today}>
              <b>{d.label}</b>
              <span>{d.name?.split(' ')[0] ?? '—'}</span>
            </div>
          ),
        )}
      </div>
    </section>
  );
}

function Deliveries({ v }: { v: RoutingView }) {
  return (
    <section className={styles.tableCard}>
      <div className={styles.tableHead}>
        <span className={styles.cardTitle}>Escalation log</span>
        <span className={styles.faint}>
          Every routing decision Lefi Brain made, with its reason
        </span>
      </div>
      {v.deliveries.length === 0 ? (
        <span className={styles.faint}>No alert has been escalated yet.</span>
      ) : (
        <div className={styles.list}>
          {v.deliveries.map((d, i) => (
            <div key={`${d.at}-${i}`} className={styles.step}>
              <span className={styles.level}>L{d.level}</span>
              <div className={styles.stepText}>
                <b>
                  {d.user}{' '}
                  <span className={styles.role}>
                    · {d.alert ?? ''} {d.title ?? ''}
                  </span>
                </b>
                <span className={styles.faint}>{d.reason}</span>
              </div>
              <div className={styles.stepWhen}>
                <span className={styles.channel}>In the apps</span>
                <span className={styles.mono}>{stamp(d.at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
