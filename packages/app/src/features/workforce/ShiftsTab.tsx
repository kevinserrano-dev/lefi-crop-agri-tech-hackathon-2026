import { useQuery } from '@tanstack/react-query';
import { queries } from '@lefi/api';
import { toneVars } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { roleColor } from '../../shared/lib/roles';
import { Avatar, Icon, ProvenanceBadge, Skeleton } from '../../shared/ui';
import { SHIFT_TONE } from './presentation';
import { useWorkforceActions } from './useWorkforceActions';
import styles from './workforce.module.css';

/** Weekly roster: click a cell to cycle Day → Evening → Off (the Brain validates and logs it). */
export function ShiftsTab() {
  const q = useQuery(queries.shifts(usePlatform()));
  const act = useWorkforceActions();
  if (q.isPending) return <Skeleton height={500} />;
  if (q.isError) return <span className={styles.faint}>{describeError(q.error)}</span>;
  const w = q.data;
  return (
    <>
      <div className={styles.weekHead}>
        <span className={styles.cardTitle}>
          {w.title} <ProvenanceBadge origin={w.origin} />
        </span>
        <span className={styles.note}>
          <Icon name={w.can_edit.allowed ? 'edit_calendar' : 'lock'} size={17} />
          {w.note}
        </span>
      </div>
      <div className={styles.rosterCard}>
        <div className={styles.roster} role="table" aria-label="Shifts and availability">
          <div role="row" className={styles.rosterHead}>
            <span>Employee</span>
            {w.days.map((d) => (
              <span key={d.label} className={styles.center}>
                {d.label}
              </span>
            ))}
            <span>Availability</span>
          </div>
          {w.rows.map((r) => (
            <div role="row" key={r.id} className={styles.rosterRow}>
              <div className={styles.who}>
                <Avatar name={r.name} size={28} color={roleColor(r.role_id)} />
                <div className={styles.whoText}>
                  <b>{r.name}</b>
                  <span className={styles.faint}>
                    {r.role_label} · {r.hours} h
                  </span>
                </div>
              </div>
              {r.cells.map((c, d) => {
                const t = toneVars(SHIFT_TONE[c.code] ?? 'off');
                return (
                  <button
                    key={d}
                    type="button"
                    className={styles.cell}
                    style={{ background: t.bg, color: t.fg }}
                    data-today={w.days[d]?.today}
                    data-locked={!w.can_edit.allowed}
                    aria-label={`${r.name} · ${w.days[d]?.label}: ${c.label}`}
                    title={w.can_edit.reason ?? undefined}
                    onClick={act.guarded(w.can_edit, () =>
                      act.cycleShift.mutate({ id: r.id, day: d }),
                    )}
                  >
                    <b>{c.label}</b>
                    <span>{c.time}</span>
                  </button>
                );
              })}
              <b style={{ color: toneVars(r.availability_tone).fg }} className={styles.avail}>
                {r.availability}
              </b>
            </div>
          ))}
          <div role="row" className={styles.coverage}>
            <b>Coverage (day / eve)</b>
            {w.coverage.map((c, i) => (
              <span key={i} className={styles.center}>
                {c.day} / {c.evening}
              </span>
            ))}
            <span />
          </div>
        </div>
      </div>
    </>
  );
}
