import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queries } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { Card, Segmented, Skeleton } from '../../shared/ui';
import { IrrigationTile, SensorCard } from './SensorCard';
import styles from './dashboard.module.css';

export function CurrentConditionsCard({
  zoneIds,
  connected,
}: {
  zoneIds: string[];
  connected: boolean;
}) {
  const platform = usePlatform();
  const [selected, setSelected] = useState(zoneIds[0] ?? '');
  const zoneId = zoneIds.includes(selected) ? selected : (zoneIds[0] ?? '');
  const readings = useQuery({
    ...queries.zoneReadings(platform, zoneId),
    enabled: Boolean(zoneId),
  });
  const irrigation = useQuery(queries.irrigation(platform));
  const placeholders = readings.data?.some((r) => r.range?.is_placeholder);

  return (
    <Card
      title="Current conditions"
      subtitle="Live sensor readings · updated every 10 s"
      actions={
        <Segmented
          label="Zone"
          value={zoneId}
          onChange={setSelected}
          options={zoneIds.map((z) => ({ value: z, label: z }))}
        />
      }
    >
      {readings.isPending && <Skeleton height={170} radius={14} />}
      {readings.isError && !readings.data && (
        <span className={styles.muted}>{describeError(readings.error)}</span>
      )}
      {readings.data && (
        <div className={styles.sensorGrid}>
          {readings.data.map((r) => (
            <SensorCard key={`${r.sensor_id}:${r.variable}`} reading={r} stale={!connected} />
          ))}
          <IrrigationTile reason={irrigation.data?.reason} />
        </div>
      )}
      {placeholders && (
        <span className={styles.placeholderNote}>
          Operating ranges are placeholders until an agronomist confirms the crop profile.
        </span>
      )}
    </Card>
  );
}
