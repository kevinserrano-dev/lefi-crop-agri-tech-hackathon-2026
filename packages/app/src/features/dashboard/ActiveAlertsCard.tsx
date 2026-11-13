import type { Alert } from '@lefi/api';
import { severityTone } from '@lefi/ui';
import { clock, timeAgo } from '../../shared/lib/time';
import { Badge, Card, ListRow } from '../../shared/ui';
import { alertIcon } from '../alerts/alertIcon';
import styles from './dashboard.module.css';

export function ActiveAlertsCard({
  alerts,
  allowed,
  brainTime,
}: {
  alerts: Alert[] | undefined;
  allowed: boolean;
  brainTime: string | undefined;
}) {
  const critical = alerts?.filter((a) => a.severity === 'critical').length ?? 0;
  return (
    <Card
      title="Active alerts"
      actions={critical > 0 && <Badge tone="crit">{critical} critical</Badge>}
    >
      {!allowed && <span className={styles.muted}>Your role cannot view alerts.</span>}
      {allowed && alerts?.length === 0 && <span className={styles.muted}>No open alerts.</span>}
      {alerts?.slice(0, 4).map((a) => (
        <ListRow
          key={a.id}
          icon={alertIcon(a)}
          tone={severityTone[a.severity]}
          title={a.title}
          meta={`${a.zone_id ?? a.device_id ?? 'System'} · ${clock(a.created_at)}`}
          trailing={timeAgo(a.created_at, brainTime)}
        />
      ))}
    </Card>
  );
}
