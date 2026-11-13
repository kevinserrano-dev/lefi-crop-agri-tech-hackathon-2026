import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { reviewKeys, reviewQueries, reviewsApi } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { Skeleton } from '../../shared/ui';
import { ZoneReview } from './ZoneReview';
import styles from './review.module.css';

/**
 * AI Plant Health opens with a review of every watched zone (ADR-089): zones not reviewed in the
 * last 10 min are reviewed again when the screen opens; Lefi AI's summaries arrive afterwards.
 */
export function ZoneReviewsSection() {
  const platform = usePlatform();
  const qc = useQueryClient();
  const refresh = useMutation({
    mutationFn: () => reviewsApi.refresh(platform),
    onSuccess: (data) => qc.setQueryData(reviewKeys.latest(undefined), data),
  });
  const { mutate } = refresh;
  useEffect(() => mutate(), [mutate]);
  const q = useQuery(reviewQueries.latest(platform));
  const data = q.data ?? refresh.data;
  if (!data) {
    if (q.isError || refresh.isError)
      return <span className={styles.muted}>{describeError(q.error ?? refresh.error)}</span>;
    return <Skeleton height={160} />;
  }
  if (data.reviews.length === 0)
    return (
      <span className={styles.muted}>
        No zone to review: zones are reviewed once a crop batch grows in them or a camera
        photographs them on a schedule.
      </span>
    );
  return (
    <div className={styles.list} aria-label="Zone health reviews">
      {data.reviews.map((r) => (
        <ZoneReview key={r.id} review={r} now={data.brain_time} />
      ))}
    </div>
  );
}
