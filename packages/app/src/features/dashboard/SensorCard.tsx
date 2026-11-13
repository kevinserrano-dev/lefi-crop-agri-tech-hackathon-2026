import type { Reading } from '@lefi/api';
import { healthTone, toneVars } from '@lefi/ui';
import { variableIcon } from '../../shared/lib/variables';
import { Icon, Sparkline, SourceTag } from '../../shared/ui';
import styles from './dashboard.module.css';

const STATUS_LABEL = {
  HEALTHY: 'Healthy',
  WARNING: 'Warning',
  CRITICAL: 'Critical',
  UNKNOWN: 'No data',
} as const;

const fmt = (v: number, d: number) => v.toFixed(d);
const rangeText = (r: Reading) =>
  r.range ? `${r.range.min}–${r.range.max} ${r.unit === 'pH' ? '' : r.unit}`.trim() : 'No range';

/** One reading tile (design: "Current conditions"). `stale` forces the STALE state. */
export function SensorCard({ reading, stale }: { reading: Reading; stale: boolean }) {
  const freshness = stale && reading.freshness === 'LIVE' ? 'STALE' : reading.freshness;
  // ADR-012: without current data the health is UNKNOWN, never the last known value.
  const status = freshness === 'LIVE' ? reading.status : 'UNKNOWN';
  const tone = toneVars(healthTone[status]);
  return (
    <div className={styles.sensor} data-status={status} title={reading.sensor_id}>
      <div className={styles.sensorHead}>
        <Icon name={variableIcon(reading.variable)} size={20} color={tone.fg} />
        <SourceTag source={reading.source} origin={reading.origin} freshness={freshness} />
      </div>
      <span className={styles.sensorLabel}>{reading.label}</span>
      <div className={styles.sensorValue}>
        <span>{reading.value === null ? '—' : fmt(reading.value, reading.decimals)}</span>
        <span className={styles.sensorUnit}>{reading.unit}</span>
      </div>
      <Sparkline values={reading.history} color={tone.dot} />
      <div className={styles.sensorFoot}>
        <span>{rangeText(reading)}</span>
        <span style={{ color: tone.fg, fontWeight: 700 }}>{STATUS_LABEL[status]}</span>
      </div>
    </div>
  );
}

/** Irrigation sits where the design shows the pump, but is locked: disabled by design. */
export function IrrigationTile({ reason }: { reason: string | undefined }) {
  return (
    <div className={styles.sensor} title={reason}>
      <div className={styles.sensorHead}>
        <Icon name="water_pump" size={20} color="var(--lefi-off-fg)" />
        <span className={styles.lockTag}>
          <Icon name="lock" size={12} /> DISABLED
        </span>
      </div>
      <span className={styles.sensorLabel}>Irrigation pump</span>
      <div className={styles.sensorValue}>
        <span className={styles.disabledValue}>Disabled</span>
      </div>
      <span className={styles.sensorUnit}>By design · interface only</span>
      <div className={styles.flatLine} />
      <div className={styles.sensorFoot}>
        <span>No pump control</span>
        <span style={{ color: 'var(--lefi-off-fg)', fontWeight: 700 }}>Locked</span>
      </div>
    </div>
  );
}
