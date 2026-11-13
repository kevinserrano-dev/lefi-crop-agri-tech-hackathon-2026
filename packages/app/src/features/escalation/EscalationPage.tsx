import { useQuery } from '@tanstack/react-query';
import { queries } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { Skeleton } from '../../shared/ui';
import { FallbackChainCard, LiveEscalationCard } from './ChainCards';
import { DeliveryAudit } from './DeliveryAudit';
import { LevelCards } from './LevelCards';
import { OnCallCard } from './OnCallCard';
import { RoutingCard } from './RoutingCard';
import styles from './escalation.module.css';

/** Escalation Rules (design): routing, on-call, per-severity rules, fallback chain, audit. */
export function EscalationPage() {
  const q = useQuery(queries.escalation(usePlatform()));
  if (q.isPending) return <Skeleton height={500} />;
  if (q.isError) return <span className={styles.faint}>{describeError(q.error)}</span>;
  const c = q.data;
  return (
    <>
      <span className={styles.text}>{c.note}</span>
      <div className={styles.top}>
        <RoutingCard c={c} />
        <OnCallCard c={c} />
      </div>
      <LevelCards c={c} />
      <div className={styles.bottom}>
        <FallbackChainCard c={c} />
        <LiveEscalationCard c={c} />
      </div>
      <DeliveryAudit />
    </>
  );
}
