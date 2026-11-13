import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queries, type BatchDetail } from '@lefi/api';
import { toneVars } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { ActionButton, Badge, LineChart, Skeleton, useToast } from '../../shared/ui';
import { BatchDialog } from './BatchDialog';
import type { Go } from './nav';
import { HealthPill, num, PhotoPlaceholder } from './parts';
import styles from './crops.module.css';

/** Measured + projected height on one axis (projected drawn dashed, starting at today). */
function GrowthChart({ g }: { g: BatchDetail['growth'] }) {
  const n = g.span_days + 1;
  const measured = [...g.measured, ...Array(n - g.measured.length).fill(NaN)] as number[];
  const projected = [...Array(g.measured.length - 1).fill(NaN), ...g.projected] as number[];
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => `Day ${Math.round(g.span_days * f)}`);
  return (
    <LineChart
      height={160}
      xLabels={ticks}
      series={[
        { values: projected, color: '#9AA6A0', min: 0, max: g.max_cm, dashed: true },
        { values: measured, color: '#2E9A63', min: 0, max: g.max_cm, endDot: true },
      ]}
    />
  );
}

/** Crop batch: facts, growth timeline, height curve and tracked plants. */
export function BatchView({ gh, zone, id, go }: { gh: string; zone: string; id: string; go: Go }) {
  const q = useQuery(queries.batch(usePlatform(), id));
  const toast = useToast((s) => s.show);
  const [editing, setEditing] = useState(false);
  if (q.isPending) return <Skeleton height={400} />;
  if (q.isError) return <span className={styles.faint}>{describeError(q.error)}</span>;
  const b = q.data;
  return (
    <>
      <div className={styles.batchTiles}>
        <div className={styles.batchHero}>
          <span className={styles.heroEyebrow}>Crop batch</span>
          <span className={styles.heroTitle}>
            {b.id} · {b.variety}
          </span>
          <span className={styles.heroSub}>
            {b.lot} · {b.zone_id} · sown {b.sown}
          </span>
        </div>
        <div className={styles.tile}>
          <span>Plants</span>
          <b>{num(b.plants)}</b>
        </div>
        <div className={styles.tile}>
          <span>Age · stage</span>
          <b>Day {b.day}</b>
          <span>{b.stage}</span>
        </div>
        <div className={styles.tile}>
          <span>{b.target_label}</span>
          <b>{b.target}</b>
        </div>
        <div className={styles.tile}>
          <span>Health (avg)</span>
          <b style={{ color: toneVars(b.health.tone).fg }}>{b.health.value}</b>
        </div>
      </div>
      <div className={styles.twoCol}>
        <section className={styles.card}>
          <div className={styles.rowBetween}>
            <span className={styles.cardTitle}>Growth timeline</span>
            <ActionButton
              label="Edit batch"
              icon="edit"
              availability={b.actions.edit}
              onClick={() =>
                b.actions.edit.allowed
                  ? setEditing(true)
                  : toast(b.actions.edit.reason ?? 'Not allowed.', 'bad')
              }
            />
          </div>
          <ol className={styles.timeline}>
            {b.timeline.map((s) => (
              <li key={s.label} data-state={s.state}>
                <span className={styles.tlDot} />
                <div className={styles.tlBody}>
                  <div className={styles.titleBlock}>
                    <b>{s.label}</b>
                    <span className={styles.faint}>
                      {s.state === 'current'
                        ? `Current · day ${b.day}`
                        : s.state === 'done'
                          ? 'Completed'
                          : 'Planned'}
                    </span>
                  </div>
                  <span className={styles.mono}>
                    Day {s.day} · {s.date}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section className={styles.card}>
          <div className={styles.rowBetween}>
            <div className={styles.titleBlock}>
              <span className={styles.cardTitle}>
                Average plant height{' '}
                {b.growth.simulated && (
                  <Badge tone="sim" variant="tag">
                    Simulated
                  </Badge>
                )}
              </span>
              <span className={styles.faint}>
                Estimated from imaging once a vision pipeline exists · cm
              </span>
            </div>
            <div className={styles.legend}>
              <span>
                <i className={styles.legendSolid} /> Measured
              </span>
              <span>
                <i className={styles.legendDashed} /> Projected
              </span>
            </div>
          </div>
          <GrowthChart g={b.growth} />
        </section>
      </div>
      <section className={styles.card}>
        <div className={styles.rowBetween}>
          <span className={styles.cardTitle}>Tracked plants</span>
          <span className={styles.faint}>
            {b.plants_tracked.length} sentinel plants · select to open the profile
          </span>
        </div>
        <div className={styles.plantGrid}>
          {b.plants_tracked.map((p) => (
            <button
              key={p.id}
              type="button"
              className={styles.plantCard}
              onClick={() => go({ level: 'plant', gh, zone, batch: b.id, plant: p.id })}
            >
              <div className={styles.plantPhoto}>
                <PhotoPlaceholder label="photo" height={90} />
                <span className={styles.ghBadge}>
                  <HealthPill h={p.health} />
                </span>
              </div>
              <div className={styles.plantText}>
                <span className={styles.monoStrong}>{p.id}</span>
                <span className={styles.faint}>{p.row}</span>
              </div>
            </button>
          ))}
        </div>
      </section>
      <BatchDialog
        key={editing ? `edit-${b.id}` : 'closed'}
        open={editing}
        onClose={() => setEditing(false)}
        batch={b}
      />
    </>
  );
}
