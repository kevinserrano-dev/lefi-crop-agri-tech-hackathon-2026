import { useQuery } from '@tanstack/react-query';
import { operationsQueries } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { goTo } from '../../shared/lib/assistant';
import { describeError } from '../../shared/lib/errors';
import { Button, Icon, Skeleton } from '../../shared/ui';
import { screenPath } from '../../app/screenPath';
import { useCan } from '../session';
import { OtherCharts, ValueCard } from './EnvironmentLive';
import styles from './environment.module.css';

/**
 * A zone's sensors at a glance (Greenhouses & Crops → zone, ADR-092): one card per value Lefi
 * Brain has now and the last 24 h of every measurement, from the same `/environment` data as
 * Environmental Monitoring. Sensors are grouped by the zone each one measures in (ADR-083), not by
 * the zone its device is installed in. Returns null without `nav.environment` (the caller then
 * shows the plain sensor list).
 */
export function ZoneEnvironment({ zoneId }: { zoneId: string }) {
  const platform = usePlatform();
  const allowed = useCan('nav.environment');
  const q = useQuery({
    ...operationsQueries.environment(platform, zoneId, '24h'),
    enabled: allowed,
    refetchInterval: 15_000,
  });
  if (!allowed) return null;
  if (q.isError)
    return (
      <p className={styles.muted}>Could not load this zone’s sensors: {describeError(q.error)}</p>
    );
  if (!q.data) return <Skeleton height={180} />;
  const e = q.data;
  const withData = e.values.filter((v) => v.value !== null);
  const off = e.values.length - withData.length;
  const open = () => goTo(screenPath('environment'));
  return (
    <section className={styles.zonePanel} aria-label="Sensors of this zone">
      <div className={styles.zonePanelHead}>
        <span className={styles.strong}>
          <Icon name="sensors" size={18} /> Sensors now · last 24 h
        </span>
        <Button size="sm" variant="ghost" icon="monitoring" onClick={open}>
          Environmental Monitoring
        </Button>
      </div>
      {e.values.length === 0 ? (
        <p className={styles.muted}>
          No sensor measures in this zone yet. In Devices &amp; Health, give a device this zone and
          assign its sensors to it.
        </p>
      ) : withData.length === 0 ? (
        <p className={styles.muted}>
          The {off} sensor{off === 1 ? '' : 's'} of this zone have no current data (device off or
          not reporting): see Devices &amp; Health.
        </p>
      ) : (
        <div className={styles.cards}>
          {withData.map((v) => (
            <ValueCard
              key={`${v.sensor_id}:${v.variable}`}
              v={v}
              selected={false}
              twin={withData.filter((x) => x.variable === v.variable).length > 1}
              brainTime={e.brain_time}
              onSelect={open}
            />
          ))}
        </div>
      )}
      {withData.length > 0 && off > 0 && (
        <span className={styles.muted}>
          {off} more sensor value{off === 1 ? '' : 's'} without current data.
        </span>
      )}
      <OtherCharts series={e.series} window={e.window} onSelect={open} />
    </section>
  );
}
