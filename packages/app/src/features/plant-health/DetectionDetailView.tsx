import { useQuery } from '@tanstack/react-query';
import { queries, type DetectionDetail } from '@lefi/api';
import { mascots, severityTone, toneVars } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { ActionButton, Badge, Card, Icon, Skeleton } from '../../shared/ui';
import { BOX_COLOUR, confidenceLevel, LEAF_COLOUR, STATUS } from './presentation';
import { useDetectionActions } from './useDetectionActions';
import styles from './plantHealth.module.css';

const captured = (iso: string) =>
  `${new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })} · ${new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;

export function DetectionDetailView({ id }: { id: string }) {
  const q = useQuery(queries.detection(usePlatform(), id));
  if (q.isPending) return <Skeleton height={600} />;
  if (q.isError) return <span className={styles.muted}>{describeError(q.error)}</span>;
  return <Body d={q.data} />;
}

function Body({ d }: { d: DetectionDetail }) {
  const act = useDetectionActions(d.id);
  const st = STATUS[d.status];
  const conf = confidenceLevel(d.confidence);
  const sevDot = toneVars(severityTone[d.severity]).dot;
  const open = d.status === 'unconfirmed' || d.status === 'inspection';

  return (
    <div className={styles.detail}>
      <Card className={styles.head}>
        <div className={styles.headText}>
          <span className={styles.meta}>
            {d.id} · {captured(d.captured_at)}
          </span>
          <h2 className={styles.title}>{d.finding}</h2>
          <span className={styles.muted}>
            {d.category} · {d.variety} · {d.zone_id} · batch {d.batch} · plant {d.plant_id}
          </span>
        </div>
        <div className={styles.headTags}>
          {d.simulated && (
            <Badge tone="sim" variant="tag">
              Simulated detection
            </Badge>
          )}
          <span className={styles.statusPill} style={{ background: st.bg, color: st.fg }}>
            <Icon name={st.icon} size={18} />
            {st.label}
          </span>
        </div>
      </Card>

      {open && (
        <div className={styles.prediction}>
          <Icon name="psychiatry" size={20} />
          <span>
            <b>This is an AI prediction, not a diagnosis.</b> It is based on camera imagery only and
            must be confirmed by a crop scout or grower before any treatment is applied.
          </span>
        </div>
      )}
      {d.status === 'confirmed' && (
        <div className={styles.confirmed}>
          <Icon name="verified" size={20} color="#9FE0BC" />
          <span>
            <b>Confirmed diagnosis</b> · verified in person by {d.reviewer ?? 'a reviewer'}. This
            record is now part of the plant’s inspection history.
          </span>
        </div>
      )}
      {d.status === 'rejected' && (
        <div className={styles.rejected}>
          <Icon name="block" size={20} />
          <span>
            <b>Rejected</b> by {d.reviewer ?? 'a reviewer'} · false positive sent back for model
            retraining.
          </span>
        </div>
      )}

      <div className={styles.split}>
        <figure className={styles.frame}>
          <div
            className={styles.frameImage}
            role="img"
            aria-label={d.frame.image_url ? `Camera frame of ${d.plant_id}` : 'No image available'}
          >
            {d.frame.image_url && <img src={d.frame.image_url} alt="" />}
            {d.boxes.map((b) => (
              <div
                key={b.label}
                className={styles.box}
                style={{
                  left: `${b.x}%`,
                  top: `${b.y}%`,
                  width: `${b.w}%`,
                  height: `${b.h}%`,
                  borderColor: BOX_COLOUR[b.tone],
                }}
              >
                <span style={{ background: BOX_COLOUR[b.tone] }}>{b.label}</span>
              </div>
            ))}
            <span className={styles.frameLabel}>{d.frame.label}</span>
            {!d.frame.image_url && (
              <span className={styles.noImage}>No real image — placeholder frame</span>
            )}
          </div>
          <figcaption className={styles.frameCaption}>
            <span>Computer-vision detections overlaid · {d.camera}</span>
            <span>{d.frame.resolution}</span>
          </figcaption>
        </figure>

        <div className={styles.column}>
          <Card>
            <div className={styles.confHead}>
              <span className={styles.cardTitle}>AI confidence</span>
              <span className={styles.confValue} style={{ color: conf.color }}>
                {d.confidence} %
              </span>
            </div>
            <div className={styles.track}>
              <div style={{ width: `${d.confidence}%`, background: conf.color }} />
            </div>
            <span className={styles.muted}>
              {conf.label} confidence · review threshold {d.review_threshold} %
            </span>
            <span className={styles.subTitle}>Supporting evidence</span>
            {d.evidence.map((e) => (
              <div key={e} className={styles.evidence}>
                <Icon name="check_small" size={16} color="var(--lefi-green-400)" />
                {e}
              </div>
            ))}
          </Card>
          <Card>
            <span className={styles.cardTitle}>Leaf colour analysis</span>
            <div className={styles.leafBar}>
              {d.leaf_colour.map((l) => (
                <div
                  key={l.key}
                  style={{ width: `${l.pct}%`, background: LEAF_COLOUR[l.key] ?? '#9AA6A0' }}
                />
              ))}
            </div>
            {d.leaf_colour.map((l) => (
              <div key={l.key} className={styles.leafRow}>
                <span>
                  <i style={{ background: LEAF_COLOUR[l.key] ?? '#9AA6A0' }} />
                  {l.label}
                </span>
                <b>{l.pct} %</b>
              </div>
            ))}
          </Card>
        </div>
      </div>

      <div className={styles.pair}>
        <Card>
          <span className={styles.cardTitle}>Estimated growth</span>
          {d.growth.map((g) => (
            <div key={g.metric} className={styles.growthRow}>
              <span className={styles.muted}>{g.metric}</span>
              <span>
                <b>{g.value}</b> <span className={styles.muted}>· {g.delta}</span>
              </span>
            </div>
          ))}
        </Card>
        <Card>
          <span className={styles.cardTitle}>Visible stress symptoms</span>
          {d.symptoms.map((s) => (
            <div key={s} className={styles.symptom}>
              <span style={{ background: sevDot }} />
              {s}
            </div>
          ))}
        </Card>
      </div>

      <Card
        title="Historical image comparison"
        actions={<span className={styles.muted}>{d.comparison.interval}</span>}
      >
        <div className={styles.compare}>
          <div className={styles.compareFrame}>
            <span>{d.comparison.before}</span>
          </div>
          <div className={styles.compareFrame}>
            <span>{d.comparison.after}</span>
          </div>
          <div className={styles.changes}>
            <span className={styles.subTitle}>Detected changes</span>
            {d.comparison.changes.map((c) => (
              <div key={c.metric}>
                <span className={styles.muted}>{c.metric}</span>
                <b>{c.value}</b>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className={styles.recommend}>
        <img src={mascots.curious} alt="" />
        <div className={styles.recText}>
          <span className={styles.recLabel}>
            Recommended action{' '}
            {d.recommendation.simulated && (
              <Badge tone="sim" variant="tag">
                Simulated
              </Badge>
            )}
          </span>
          <span>{d.recommendation.text}</span>
          <span className={styles.recNote}>
            A recommendation is not an action: nothing is treated until a person confirms and the
            validator authorises it.
          </span>
        </div>
        {open && (
          <div className={styles.actions}>
            <ActionButton
              label="Request inspection"
              icon="person_search"
              availability={d.actions.request_inspection}
              busy={act.busy}
              onClick={() => act.inspect.mutate()}
            />
            <ActionButton
              label="Reject"
              icon="block"
              availability={d.actions.reject}
              busy={act.busy}
              onClick={() => act.review.mutate('reject')}
            />
            <ActionButton
              label="Confirm diagnosis"
              icon="verified"
              variant="solid"
              availability={d.actions.confirm}
              busy={act.busy}
              onClick={() => act.review.mutate('confirm')}
            />
          </div>
        )}
      </div>
    </div>
  );
}
