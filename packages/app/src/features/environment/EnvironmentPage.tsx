import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { queries, type HistoryRange } from '@lefi/api';
import { healthTone, toneVars } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { Skeleton, ToggleGroup } from '../../shared/ui';
import { useBrainStatus } from '../shell';
import { HistoryCard } from './HistoryCard';
import { MetricCards } from './MetricCards';
import { OperatingRangesCard } from './OperatingRangesCard';
import { ConnectivityCard, IrrigationPumpCard } from './SideCards';
import styles from './environment.module.css';

/** Environmental Monitoring (design). */
export function EnvironmentPage() {
  const platform = usePlatform();
  const brain = useBrainStatus();
  const zones = useQuery(queries.zones(platform));
  const search = useSearch({ strict: false }) as { zone?: string };
  const [zoneSel, setZone] = useState<string | undefined>(search.zone);
  const [seen, setSeen] = useState(search.zone);
  if (search.zone !== seen) {
    setSeen(search.zone);
    if (search.zone) setZone(search.zone);
  }
  const [variable, setVariable] = useState('temp');
  const [range, setRange] = useState<HistoryRange>('24h');

  const zone =
    zones.data?.find((z) => z.id === zoneSel) ??
    zones.data?.find((z) => z.id === 'GH1-Z2') ??
    zones.data?.[0];
  const readings = useQuery({
    ...queries.zoneReadings(platform, zone?.id ?? ''),
    enabled: Boolean(zone),
  });

  if (zones.isPending) return <Skeleton height={400} />;
  if (zones.isError || !zone)
    return <span className={styles.muted}>{describeError(zones.error)}</span>;

  const r = readings.data ?? [];
  const counts = {
    live: r.filter((x) => x.origin === 'LIVE' && x.source === 'sensor' && x.value !== null).length,
    sim: r.filter((x) => (x.origin === 'SIMULATED' || x.source === 'estimate') && x.value !== null)
      .length,
    na: r.filter((x) => x.value === null).length,
  };

  return (
    <>
      <div className={styles.toolbar}>
        <ToggleGroup
          label="Zone"
          value={zone.id}
          onChange={setZone}
          options={zones.data.map((z) => ({
            value: z.id,
            label: z.id,
            dot: toneVars(healthTone[z.health]).dot,
          }))}
        />
        <div className={styles.legend}>
          <span>
            <i style={{ background: 'var(--lefi-ok-dot)' }} />
            {counts.live} live
          </span>
          <span>
            <i style={{ background: 'var(--lefi-sim-dot)' }} />
            {counts.sim} simulated / estimated
          </span>
          <span>
            <i style={{ background: 'var(--lefi-off-dot)' }} />
            {counts.na} unavailable
          </span>
        </div>
      </div>

      {readings.isPending ? (
        <Skeleton height={150} />
      ) : (
        <MetricCards
          readings={r}
          selected={variable}
          onSelect={setVariable}
          stale={!brain.connected}
          brainTime={brain.brainTime}
        />
      )}

      <div className={styles.main}>
        <HistoryCard zone={zone} variable={variable} range={range} onRange={setRange} />
        <div className={styles.sideCol}>
          <IrrigationPumpCard zone={zone} />
          <ConnectivityCard zone={zone} />
        </div>
      </div>

      <OperatingRangesCard />
    </>
  );
}
