import { useQuery } from '@tanstack/react-query';
import { queries } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { Skeleton } from '../../shared/ui';
import { DigestCards } from './DigestCards';
import { HandoverHeader } from './HandoverHeader';
import { ShiftSummaryCard } from './ShiftSummaryCard';
import styles from './handover.module.css';

/** Shift Handover (design): outgoing → incoming, summary, evidence, sign and acknowledge. */
export function HandoverPage() {
  const q = useQuery(queries.handover(usePlatform()));
  if (q.isPending) return <Skeleton height={500} />;
  if (q.isError) return <span className={styles.faint}>{describeError(q.error)}</span>;
  return (
    <>
      <HandoverHeader h={q.data} />
      <ShiftSummaryCard s={q.data.summary} />
      <DigestCards h={q.data} />
    </>
  );
}
