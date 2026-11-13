import { useMutation, useQueryClient } from '@tanstack/react-query';
import { reviewKeys, reviewsApi, type HealthReview } from '@lefi/api';
import { toneVars } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { timeAgo } from '../../shared/lib/time';
import { Badge, Button, Icon, ProvenanceBadge, useToast } from '../../shared/ui';
import { BAND, POINT_TONE, REVIEW_HEALTH, TRIGGER, rangeText } from './presentation';
import styles from './review.module.css';

export function ReviewBadge({ review }: { review: HealthReview | undefined }) {
  if (!review) return <Badge tone="off">Not reviewed</Badge>;
  const h = REVIEW_HEALTH[review.status];
  return (
    <Badge tone={h.tone} dot title={h.hint}>
      {h.label}
    </Badge>
  );
}

/** One line on the zone's camera monitoring: when it was last photographed and looked at. */
export function MonitoringLine({ review, now }: { review: HealthReview; now?: string }) {
  const c = review.camera;
  if (c.cameras === 0) return <span className={styles.muted}>No camera looks at this zone</span>;
  const parts = [
    c.last_scan_at ? `Photographed ${timeAgo(c.last_scan_at, now)}` : 'Never photographed',
    c.last_analysis_at
      ? `Lefi AI looked ${timeAgo(c.last_analysis_at, now)}`
      : c.ai_on
        ? 'Lefi AI has not looked yet'
        : 'Lefi AI does not look at its photos',
    c.next_scan_at ? `next ${timeAgo(c.next_scan_at, now).replace(' ago', '')}` : null,
  ].filter(Boolean);
  return <span className={styles.muted}>{parts.join(' · ')}</span>;
}

export function useReviewZone() {
  const platform = usePlatform();
  const qc = useQueryClient();
  const toast = useToast((t) => t.show);
  return useMutation({
    mutationFn: (zoneId: string) => reviewsApi.review(platform, zoneId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reviewKeys.all });
      toast('Zone reviewed; Lefi AI’s summary follows when it is ready', 'ok');
    },
    onError: (e) => toast(describeError(e), 'bad'),
  });
}

/** Which part of a review to show: everything, the status at the top of a zone (`summary`), or
 * the analysis that follows its sensors (`analysis`: points, recommendations, Lefi AI). */
export type ReviewPart = 'all' | 'summary' | 'analysis';

/**
 * A zone's health review (ADR-089): composed by Lefi Brain from the zone's sensors against its
 * crop's published profile, Lefi AI's last look at a photo, active alerts and people's records.
 * Lefi AI's own summary is shown apart and labelled; findings from photos are "to confirm".
 */
export function ZoneReview({
  review,
  now,
  compact,
  part = 'all',
}: {
  review: HealthReview;
  now?: string;
  compact?: boolean;
  part?: ReviewPart;
}) {
  const again = useReviewZone();
  if (part === 'analysis') return <ReviewAnalysis review={review} compact={compact} />;
  return (
    <section className={styles.review} aria-label={`Health review of ${review.zone}`}>
      <header className={styles.head}>
        <div className={styles.title}>
          <Icon name="health_and_safety" size={20} />
          <b>{review.zone}</b>
          <ReviewBadge review={review} />
          {review.origins.map((o) => (
            <ProvenanceBadge key={o} origin={o as 'LIVE' | 'SIMULATED'} />
          ))}
        </div>
        <div className={styles.actions}>
          <span className={styles.muted}>
            Reviewed {timeAgo(review.created_at, now)} · {TRIGGER[review.trigger] ?? review.trigger}
            {review.trigger === 'person' ? ` ${review.requested_by}` : ''}
          </span>
          <Button
            size="sm"
            variant="ghost"
            icon="refresh"
            disabled={again.isPending}
            onClick={() => again.mutate(review.zone_id)}
          >
            Review now
          </Button>
        </div>
      </header>
      <MonitoringLine review={review} now={now} />
      {review.crops.length > 0 && (
        <div className={styles.crops}>
          {review.crops.map((cr) => (
            <span key={cr.crop + (cr.stage ?? '')}>
              <b>{cr.crop}</b> · {cr.plants} plants
              {cr.stage ? ` · ${cr.stage.replace(/_/g, ' ')}` : ''} ·{' '}
              {cr.profile ? `profile ${cr.profile}` : 'no published profile'}
            </span>
          ))}
        </div>
      )}
      {review.measurements.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Measurement</th>
              <th>Now</th>
              <th>Optimal for the crop</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {review.measurements.map((m) => (
              <tr key={m.measurement + m.crop}>
                <td>
                  {m.label}
                  {m.verification !== 'verified' && (
                    <span className={styles.faint} title="How the profile's value was verified">
                      {' '}
                      · {m.verification}
                    </span>
                  )}
                </td>
                <td>{m.value == null ? '—' : `${m.value} ${m.unit}`}</td>
                <td>{rangeText(m)}</td>
                <td>
                  <Badge tone={BAND[m.band].tone}>{BAND[m.band].label}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {part === 'all' && <ReviewAnalysis review={review} compact={compact} bare />}
    </section>
  );
}

/** The review's findings, points, recommendations and Lefi AI's summary. */
function ReviewAnalysis({
  review,
  compact,
  bare,
}: {
  review: HealthReview;
  compact?: boolean;
  bare?: boolean;
}) {
  const c = review.camera;
  const body = (
    <>
      {!compact && c.findings.length > 0 && (
        <div className={styles.findings}>
          <span className={styles.label}>Lefi AI on the last photo · to confirm</span>
          {c.findings.map((f, i) => (
            <span key={i}>
              <Badge
                tone={f.severity === 'high' ? 'crit' : f.severity === 'medium' ? 'warn' : 'info'}
              >
                {f.label}
              </Badge>{' '}
              {Math.round(f.confidence * 100)} % sure · {f.description}
            </span>
          ))}
        </div>
      )}
      <ul className={styles.points}>
        {review.points.map((p, i) => (
          <li key={i}>
            <span
              className={styles.dot}
              style={{ background: toneVars(POINT_TONE[p.level] ?? 'off').dot }}
            />
            {p.text}
          </li>
        ))}
      </ul>
      {review.recommendations.length > 0 && (
        <div className={styles.recs}>
          <span className={styles.label}>Recommended · composed by Lefi Brain from the facts</span>
          <ul>
            {review.recommendations.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      <AiPart review={review} />
    </>
  );
  if (bare) return body;
  return (
    <section className={styles.review} aria-label={`Health analysis of ${review.zone}`}>
      {body}
    </section>
  );
}

function AiPart({ review }: { review: HealthReview }) {
  const ai = review.ai;
  if (ai.status === 'pending')
    return <span className={styles.muted}>Lefi AI is writing its summary…</span>;
  if (ai.status !== 'done')
    return (
      <span className={styles.muted}>
        Lefi AI’s summary is not available
        {ai.status === 'invalid' ? ' (its answer did not fit and is not shown)' : ''}
        {ai.error ? `: ${ai.error}` : ''}
      </span>
    );
  return (
    <div className={styles.ai}>
      <span className={styles.label}>
        <Icon name="auto_awesome" size={14} /> Lefi AI · {ai.model ?? 'model unknown'} · from the
        facts above, to check
      </span>
      <p>{ai.summary}</p>
      {ai.recommendations.length > 0 && (
        <ul>
          {ai.recommendations.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
