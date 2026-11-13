import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { shiftKeys, shiftQueries, shiftsApi, type RosterWeek, type ShiftType } from '@lefi/api';
import { toneVars, type Tone } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { roleColor } from '../../shared/lib/roles';
import {
  Avatar,
  Button,
  Dialog,
  EmptyState,
  FormField,
  Icon,
  Select,
  Skeleton,
  useToast,
} from '../../shared/ui';
import roster from '../workforce/workforce.module.css';
import styles from './people.module.css';

const TONES: Array<{ value: ShiftType['tone']; label: string }> = [
  { value: 'ok', label: 'Green' },
  { value: 'info', label: 'Blue' },
  { value: 'warn', label: 'Amber' },
  { value: 'sim', label: 'Purple' },
  { value: 'off', label: 'Grey' },
];

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function useShiftMutation<A>(fn: (a: A) => Promise<unknown>, ok?: string) {
  const qc = useQueryClient();
  const toast = useToast((t) => t.show);
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: shiftKeys.all });
      if (ok) toast(ok, 'ok');
    },
    onError: (e) => toast(describeError(e), 'bad'),
  });
}

/**
 * Workforce → Shifts against the real Lefi Brain (ADR-094): the shift types people defined, and
 * who works when this week, in the greenhouse's time zone. People with `shift.edit` change a day
 * (a shift, leave or off); Lefi Brain checks and audits it. Handover and escalation read it.
 */
export function ShiftsLive() {
  const platform = usePlatform();
  const [start, setStart] = useState<string>();
  const q = useQuery({ ...shiftQueries.week(platform, start), placeholderData: (p) => p });
  const [types, setTypes] = useState(false);
  if (q.isError)
    return (
      <EmptyState mascot="sad" title="Could not load the shifts">
        {describeError(q.error)}
      </EmptyState>
    );
  if (!q.data) return <Skeleton height={420} />;
  const w = q.data;
  const active = w.types.filter((t) => !t.retired);
  return (
    <>
      <div className={roster.weekHead}>
        <span className={styles.weekNav}>
          <Button
            size="sm"
            variant="ghost"
            icon="chevron_left"
            aria-label="Previous week"
            onClick={() => setStart(addDays(w.start, -7))}
          />
          <b>
            Week of {w.days[0]?.label} – {w.days[6]?.label}
          </b>
          <Button
            size="sm"
            variant="ghost"
            icon="chevron_right"
            aria-label="Next week"
            onClick={() => setStart(addDays(w.start, 7))}
          />
          {start && (
            <Button size="sm" variant="ghost" onClick={() => setStart(undefined)}>
              This week
            </Button>
          )}
        </span>
        <span className={roster.note}>
          <Icon name="schedule" size={17} />
          Greenhouse time · {w.timezone}
          {w.can_edit && (
            <Button size="sm" variant="ghost" icon="tune" onClick={() => setTypes(true)}>
              Shift types &amp; time zone
            </Button>
          )}
        </span>
      </div>
      {active.length === 0 ? (
        <EmptyState mascot="curious" title="No shift types yet">
          {w.can_edit
            ? 'Define your shifts first (for example Day 06:00–14:30, Evening 14:00–22:30), then give people their days.'
            : 'A supervisor or manager defines the shifts.'}
          {w.can_edit && (
            <div>
              <Button icon="add" onClick={() => setTypes(true)}>
                Define shifts
              </Button>
            </div>
          )}
        </EmptyState>
      ) : (
        <RosterGrid w={w} />
      )}
      {types && <TypesDialog w={w} onClose={() => setTypes(false)} />}
    </>
  );
}

function RosterGrid({ w }: { w: RosterWeek }) {
  const platform = usePlatform();
  const byId = new Map(w.types.map((t) => [t.id, t]));
  const assign = useShiftMutation((v: { user: string; day: string; value: string }) =>
    shiftsApi.assign(platform, {
      user_id: v.user,
      day: v.day,
      shift_type_id: v.value === 'off' || v.value === 'leave' ? null : v.value,
      leave: v.value === 'leave',
    }),
  );
  const active = w.types.filter((t) => !t.retired);
  return (
    <div className={roster.rosterCard}>
      <div className={roster.roster} role="table" aria-label="Shifts">
        <div role="row" className={roster.rosterHead}>
          <span>Employee</span>
          {w.days.map((d) => (
            <span key={d.day} className={roster.center}>
              {d.label}
            </span>
          ))}
          <span>Hours</span>
        </div>
        {w.people.map((p) => (
          <div role="row" key={p.id} className={roster.rosterRow}>
            <div className={roster.who}>
              <Avatar name={p.name} size={28} color={roleColor(p.role)} />
              <div className={roster.whoText}>
                <b>{p.name}</b>
                <span className={roster.faint}>{p.role}</span>
              </div>
            </div>
            {p.cells.map((c, i) => {
              const t = c.shift_type_id ? byId.get(c.shift_type_id) : undefined;
              const tone: Tone = c.leave ? 'warn' : t ? (t.tone as Tone) : 'off';
              const v = toneVars(tone);
              const label = c.leave ? 'Leave' : t ? t.name : 'Off';
              const value = c.leave ? 'leave' : (c.shift_type_id ?? 'off');
              const name = `${p.name} · ${w.days[i]?.label}`;
              return w.can_edit ? (
                <select
                  key={c.day}
                  className={`${roster.cell} ${styles.cellSelect}`}
                  style={{ background: v.bg, color: v.fg }}
                  data-today={w.days[i]?.today}
                  aria-label={name}
                  title={t ? `${t.name} ${t.start}–${t.end}` : label}
                  value={value}
                  disabled={assign.isPending}
                  onChange={(e) => assign.mutate({ user: p.id, day: c.day, value: e.target.value })}
                >
                  <option value="off">Off</option>
                  {active.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} {x.start}–{x.end}
                    </option>
                  ))}
                  {t?.retired && <option value={t.id}>{t.name} (retired)</option>}
                  <option value="leave">Leave</option>
                </select>
              ) : (
                <div
                  key={c.day}
                  className={roster.cell}
                  style={{ background: v.bg, color: v.fg }}
                  data-today={w.days[i]?.today}
                  data-locked
                  aria-label={`${name}: ${label}`}
                >
                  <b>{label}</b>
                  {t && (
                    <span>
                      {t.start}–{t.end}
                    </span>
                  )}
                </div>
              );
            })}
            <b className={roster.avail}>{p.hours} h</b>
          </div>
        ))}
        <div role="row" className={roster.coverage}>
          <b>Coverage</b>
          {w.coverage.map((c) => (
            <span key={c.day} className={roster.center}>
              {active.map((t) => `${c.by_type[t.id] ?? 0}`).join(' / ')}
            </span>
          ))}
          <span className={roster.faint}>{active.map((t) => t.name).join(' / ')}</span>
        </div>
      </div>
    </div>
  );
}

function TypesDialog({ w, onClose }: { w: RosterWeek; onClose: () => void }) {
  const platform = usePlatform();
  const [tz, setTz] = useState(w.timezone);
  const [form, setForm] = useState({ name: '', start: '', end: '', tone: 'info' as Tone });
  const saveTz = useShiftMutation(() => shiftsApi.setTimezone(platform, tz), 'Time zone saved');
  const add = useShiftMutation(
    () =>
      shiftsApi.addType(platform, {
        name: form.name,
        start: form.start,
        end: form.end,
        tone: form.tone as ShiftType['tone'],
      }),
    'Shift added',
  );
  const retire = useShiftMutation((id: string) => shiftsApi.retireType(platform, id), 'Retired');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate(undefined, {
      onSuccess: () => setForm({ name: '', start: '', end: '', tone: 'info' }),
    });
  };
  return (
    <Dialog open onClose={onClose} labelledBy="shift-types-title" width={620}>
      <div className={styles.dialogBody}>
        <h2 id="shift-types-title">Shift types &amp; time zone</h2>
        <FormField label="Greenhouse time zone (IANA name, e.g. America/Toronto)">
          <span className={styles.inline}>
            <input value={tz} onChange={(e) => setTz(e.target.value)} maxLength={64} />
            <Button
              size="sm"
              disabled={saveTz.isPending || tz === w.timezone}
              onClick={() => saveTz.mutate(undefined)}
            >
              Save
            </Button>
          </span>
        </FormField>
        <table className={styles.typesTable}>
          <thead>
            <tr>
              <th>Shift</th>
              <th>Hours</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {w.types
              .filter((t) => !t.retired)
              .map((t) => (
                <tr key={t.id}>
                  <td>
                    <span
                      className={styles.swatch}
                      style={{ background: toneVars(t.tone as Tone).dot }}
                    />
                    {t.name}
                  </td>
                  <td>
                    {t.start}–{t.end}
                    {t.overnight ? ' (next day)' : ''} · {t.hours} h
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={retire.isPending}
                      onClick={() => retire.mutate(t.id)}
                    >
                      Retire
                    </Button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        <form className={styles.typeForm} onSubmit={submit} aria-label="New shift type">
          <FormField label="Name">
            <input
              required
              maxLength={40}
              value={form.name}
              placeholder="Day"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </FormField>
          <FormField label="Starts">
            <input
              required
              type="time"
              value={form.start}
              onChange={(e) => setForm({ ...form, start: e.target.value })}
            />
          </FormField>
          <FormField label="Ends">
            <input
              required
              type="time"
              value={form.end}
              onChange={(e) => setForm({ ...form, end: e.target.value })}
            />
          </FormField>
          <FormField label="Colour">
            <Select
              value={form.tone}
              onChange={(e) => setForm({ ...form, tone: e.target.value as Tone })}
            >
              {TONES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </FormField>
          <Button type="submit" icon="add" disabled={add.isPending}>
            Add shift
          </Button>
        </form>
        <div className={styles.dialogFoot}>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
