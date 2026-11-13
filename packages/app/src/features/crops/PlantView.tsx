import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { queries } from '@lefi/api';
import { toneVars } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import {
  ActionButton,
  Badge,
  Button,
  Dialog,
  Icon,
  Skeleton,
  Sparkline,
  TextArea,
  useToast,
} from '../../shared/ui';
import { STATUS as DETECTION_STATUS } from '../plant-health/presentation';
import { PhotoPlaceholder } from './parts';
import { useCropActions } from './useCropActions';
import styles from './crops.module.css';

/** Plant profile: estimates (simulated), environment vs placeholder ranges, detections, notes. */
export function PlantView({ id }: { id: string }) {
  const q = useQuery(queries.plant(usePlatform(), id));
  const navigate = useNavigate();
  const toast = useToast((s) => s.show);
  const [observing, setObserving] = useState(false);
  if (q.isPending) return <Skeleton height={500} />;
  if (q.isError) return <span className={styles.faint}>{describeError(q.error)}</span>;
  const p = q.data;
  const t = toneVars(p.health.tone);
  const est = p.estimates_simulated ? 'Simulated estimate' : 'Estimate';
  return (
    <div className={styles.plantLayout}>
      <div className={styles.stack}>
        <section className={styles.cardFlush}>
          <PhotoPlaceholder label={p.id} height={260} />
          <div className={`${styles.pad} ${styles.rowBetween}`}>
            <div className={styles.titleBlock}>
              <span className={styles.plantId}>{p.id}</span>
              <span className={styles.faint}>
                {p.variety} · {p.row}
              </span>
            </div>
            <ActionButton
              label="Log observation"
              icon="edit_note"
              variant="solid"
              availability={p.actions.observe}
              onClick={() =>
                p.actions.observe.allowed
                  ? setObserving(true)
                  : toast(p.actions.observe.reason ?? 'Not allowed.', 'bad')
              }
            />
          </div>
        </section>
        <section className={styles.card}>
          <span className={styles.cardTitle}>
            Environmental observations{' '}
            {p.ranges_placeholder && (
              <Badge
                tone="warn"
                variant="tag"
                title="Crop thresholds are placeholders until an agronomist provides them"
              >
                Placeholder ranges
              </Badge>
            )}
          </span>
          {p.environment.map((e) => (
            <div key={e.label} className={styles.kv}>
              <span>{e.label}</span>
              <span>
                <b>{e.value}</b>{' '}
                <span
                  style={{
                    color: e.note === 'Within range' ? 'var(--lefi-ok-fg)' : 'var(--lefi-warn-fg)',
                  }}
                >
                  {e.note}
                </span>
              </span>
            </div>
          ))}
        </section>
      </div>
      <div className={styles.stack}>
        <div className={styles.tiles4}>
          <div className={styles.tile}>
            <span>Health score</span>
            <b style={{ color: t.fg }}>{p.health.value}</b>
            <span style={{ color: t.fg }}>
              {p.health.label} · {p.estimates_simulated ? 'simulated' : 'estimate'}
            </span>
          </div>
          <div className={styles.tile}>
            <span>Growth stage</span>
            <b className={styles.tileSmall}>{p.stage}</b>
            <span>
              {p.age_days} days · sown {p.sown}
            </span>
          </div>
          <div className={styles.tile}>
            <span>Height</span>
            <b>{p.height_cm} cm</b>
            <span>{est}</span>
          </div>
          <div className={styles.tile}>
            <span>Leaf count</span>
            <b>~{p.leaves}</b>
            <span>{est}</span>
          </div>
        </div>
        <section className={`${styles.card} ${styles.split}`}>
          <div className={styles.stack8}>
            <span className={styles.cardTitle}>Growth progress</span>
            <span className={styles.score}>
              {p.progress} % <span className={styles.faint}>to harvest</span>
            </span>
            <div className={styles.bar}>
              <div style={{ width: `${p.progress}%` }} />
            </div>
            <span className={styles.faint}>
              {p.batch_id} · {p.zone_id} {p.zone_name} · {p.greenhouse_name}
            </span>
          </div>
          <div className={styles.stack8}>
            <span className={styles.cardTitle}>Health · 14 days</span>
            <Sparkline values={p.health_14d} color="#2E9A63" height={60} />
          </div>
        </section>
        <section className={styles.card}>
          <div className={styles.rowBetween}>
            <span className={styles.cardTitle}>AI detections</span>
            {p.detections.length > 0 && (
              <Button
                variant="link"
                onClick={() =>
                  void navigate({ to: '/plant-health', search: { detection: p.detections[0]!.id } })
                }
              >
                Open AI Plant Health
              </Button>
            )}
          </div>
          {p.detections.length === 0 && (
            <span className={styles.faint}>
              No detections recorded for this plant. There is no vision model connected.
            </span>
          )}
          {p.detections.map((d) => {
            const st = DETECTION_STATUS[d.status];
            return (
              <div key={d.id} className={styles.detRow}>
                <span className={styles.mono}>{d.id}</span>
                <div className={styles.titleBlock}>
                  <b>{d.finding}</b>
                  <span className={styles.faint}>
                    {d.source} · confidence {d.confidence} %
                  </span>
                </div>
                <span className={styles.pill} style={{ background: st.bg, color: st.fg }}>
                  {st.label}
                </span>
              </div>
            );
          })}
        </section>
        <section className={styles.card}>
          <span className={styles.cardTitle}>Inspection history</span>
          {p.observations.map((o) => (
            <div key={`${o.at}-${o.who}-${o.note}`} className={styles.obs}>
              <Icon name="person_check" size={18} color="var(--lefi-green-400)" />
              <div className={styles.titleBlock}>
                <span>
                  <b>{o.who}</b>{' '}
                  <span className={styles.faint}>
                    · {o.role} · {o.at}
                  </span>
                </span>
                <span className={styles.obsNote}>{o.note}</span>
              </div>
            </div>
          ))}
        </section>
      </div>
      <ObservationDialog
        key={observing ? 'open' : 'closed'}
        plantId={p.id}
        open={observing}
        onClose={() => setObserving(false)}
      />
    </div>
  );
}

function ObservationDialog({
  plantId,
  open,
  onClose,
}: {
  plantId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { observe } = useCropActions();
  const [note, setNote] = useState('');
  return (
    <Dialog open={open} onClose={onClose} labelledBy="obs-title" width={520}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          observe.mutate({ id: plantId, note }, { onSuccess: onClose });
        }}
      >
        <div className={styles.dialogHead}>
          <span id="obs-title" className={styles.dialogTitle}>
            Log observation · {plantId}
          </span>
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </div>
        <TextArea
          aria-label="Observation"
          rows={5}
          value={note}
          placeholder="What did you see? Colour, turgor, pests, roots…"
          onChange={(e) => setNote(e.target.value)}
        />
        <div className={styles.dialogFoot}>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={observe.isPending}>
            Save observation
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
