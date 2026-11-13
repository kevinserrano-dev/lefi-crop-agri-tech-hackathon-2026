import { useQuery } from '@tanstack/react-query';
import { queries } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { Skeleton } from '../../shared/ui';
import { AutomationsCard } from './AutomationsCard';
import { AutonomyCard } from './AutonomyCard';
import { SettingsCard } from './SettingsCard';
import { AiStatusCard, EmergencyCard, ManualModeCard } from './StatusCards';
import styles from './aiControl.module.css';

/** AI Control & Safety (design). */
export function AiControlPage() {
  const q = useQuery(queries.aiControl(usePlatform()));
  if (q.isPending) return <Skeleton height={500} />;
  if (q.isError) return <span className={styles.muted}>{describeError(q.error)}</span>;
  const c = q.data;
  return (
    <>
      <div className={styles.top}>
        <AiStatusCard c={c} />
        <EmergencyCard c={c} />
      </div>
      <ManualModeCard c={c} />
      <AutomationsCard c={c} />
      <AutonomyCard c={c} />
      <SettingsCard c={c} />
    </>
  );
}
