import { useQuery } from '@tanstack/react-query';
import { reviewQueries } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { Card, EmptyState, Skeleton } from '../../shared/ui';
import { MonitoringLine, ReviewBadge } from './ZoneReview';
import styles from './review.module.css';

/**
 * Dashboard: the newest health review of every watched zone, worst first, with when its camera
 * last photographed it and Lefi AI last looked (ADR-089).
 */
export function ZoneMonitoringCard() {
  const platform = usePlatform();
  const q = useQuery(reviewQueries.latest(platform));
  return (
    <Card
      title="Zone health · Lefi AI monitoring"
      actions={
        <a href="#/plant-health" className={styles.muted}>
          AI Plant Health
        </a>
      }
    >
      {q.isError ? (
        <span className={styles.muted}>{describeError(q.error)}</span>
      ) : !q.data ? (
        <Skeleton height={120} />
      ) : q.data.reviews.length === 0 ? (
        <EmptyState mascot="curious" title="No zone reviewed yet" compact>
          Lefi Brain reviews every zone with a crop or a scheduled camera every 30 min.
        </EmptyState>
      ) : (
        <div>
          {q.data.reviews.map((r) => (
            <div key={r.id} className={styles.row}>
              <div className={styles.rowText}>
                <b>{r.zone}</b>
                <MonitoringLine review={r} now={q.data.brain_time} />
                {r.points.find((p) => p.level === 'critical' || p.level === 'attention') && (
                  <span className={styles.muted}>
                    {r.points.find((p) => p.level === 'critical' || p.level === 'attention')?.text}
                  </span>
                )}
              </div>
              <ReviewBadge review={r} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
