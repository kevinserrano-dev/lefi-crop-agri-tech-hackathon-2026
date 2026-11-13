import { useQuery } from '@tanstack/react-query';
import { reviewQueries } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { Button, Skeleton } from '../../shared/ui';
import { useCan } from '../session';
import { useReviewZone, ZoneReview, type ReviewPart } from './ZoneReview';
import styles from './review.module.css';

/** The zone view's health review (Greenhouses & Crops): the newest one, or a button to make it. */
export function ZoneReviewPanel({
  zoneId,
  now,
  part = 'all',
}: {
  zoneId: string;
  now?: string;
  part?: ReviewPart;
}) {
  const platform = usePlatform();
  const allowed = useCan('nav.plantHealth');
  const q = useQuery({ ...reviewQueries.latest(platform, zoneId), enabled: allowed });
  const make = useReviewZone();
  if (!allowed) return null;
  if (!q.data) return <Skeleton height={80} />;
  const [review] = q.data.reviews;
  if (!review && part === 'analysis') return null;
  if (!review)
    return (
      <section className={styles.review} aria-label="Health review">
        <span className={styles.muted}>This zone has not been reviewed yet.</span>
        <div>
          <Button
            size="sm"
            icon="health_and_safety"
            disabled={make.isPending}
            onClick={() => make.mutate(zoneId)}
          >
            Review its health now
          </Button>
        </div>
      </section>
    );
  return <ZoneReview review={review} now={now ?? q.data.brain_time} part={part} />;
}
