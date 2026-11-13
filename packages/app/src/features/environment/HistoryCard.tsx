import { useQuery } from '@tanstack/react-query';
import { queries, type HistoryRange, type Zone } from '@lefi/api';
import { mascots } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { Card, Icon, LineChart, Segmented, Skeleton } from '../../shared/ui';
import styles from './environment.module.css';

const RANGES: Array<{ value: HistoryRange; label: string }> = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
];

const TICK: Record<HistoryRange, (d: Date) => string> = {
  '24h': (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
  '7d': (d) => d.toLocaleDateString('en-CA', { weekday: 'short', day: 'numeric' }),
  '30d': (d) => d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }),
};

function ticks(labels: string[], range: HistoryRange) {
  if (labels.length < 2) return [];
  return [0, 0.25, 0.5, 0.75, 1].map((f) =>
    TICK[range](new Date(labels[Math.round(f * (labels.length - 1))]!)),
  );
}

/** History of one variable with the operating range as a band (design: Environment chart). */
export function HistoryCard({
  zone,
  variable,
  range,
  onRange,
}: {
  zone: Zone;
  variable: string;
  range: HistoryRange;
  onRange: (r: HistoryRange) => void;
}) {
  const q = useQuery(queries.zoneHistory(usePlatform(), zone.id, variable, range));
  const h = q.data;
  const unit = h?.unit === 'pH' ? '' : ` ${h?.unit ?? ''}`;
  const fmt = (v: number) => v.toFixed(h?.decimals ?? 1);

  let lo = 0;
  let hi = 1;
  if (h && h.values.length) {
    lo = Math.min(h.range?.min ?? Infinity, ...h.values);
    hi = Math.max(h.range?.max ?? -Infinity, ...h.values);
    const pad = (hi - lo) * 0.15;
    lo -= pad;
    hi += pad;
  }
  const color = h?.source === 'estimate' ? 'var(--lefi-sim-dot)' : '#2E9A63';

  return (
    <Card
      title={h ? `${h.label} · ${zone.id}` : zone.id}
      subtitle={
        h
          ? `${zone.greenhouse_name} · ${zone.name}${h.range ? ` · shaded band = operating range ${h.range.min}–${h.range.max}${unit}` : ''}`
          : undefined
      }
      actions={<Segmented label="Period" value={range} onChange={onRange} options={RANGES} />}
    >
      {q.isPending && <Skeleton height={260} />}
      {q.isError && <span className={styles.muted}>{describeError(q.error)}</span>}
      {h?.source === 'estimate' && (
        <div className={styles.estimate}>
          <Icon name="model_training" size={18} />
          Estimated values — no sensor installed for this variable in this zone. Not a measurement;
          not for compliance records.
        </div>
      )}
      {h && h.values.length > 0 && h.stats && (
        <>
          <LineChart
            height={220}
            leftAxis={{ labels: [hi, hi - (hi - lo) / 3, lo + (hi - lo) / 3, lo].map(fmt) }}
            xLabels={ticks(h.labels, range)}
            band={h.range ? { from: h.range.min, to: h.range.max, color: '#54B985' } : undefined}
            series={[{ values: h.values, color, min: lo, max: hi, kind: 'area' }]}
          />
          <div className={styles.stats}>
            <Stat k="Current" v={fmt(h.stats.current)} />
            <Stat k="Average" v={fmt(h.stats.average)} />
            <Stat k="Min" v={fmt(h.stats.min)} />
            <Stat k="Max" v={fmt(h.stats.max)} />
            <Stat k="Time in range" v={`${h.stats.time_in_range_pct} %`} />
          </div>
        </>
      )}
      {h && h.values.length === 0 && (
        <div className={styles.unavailable}>
          <img src={mascots.sleeping} alt="" />
          <span className={styles.unavailableTitle}>Sensor unavailable</span>
          <span className={styles.muted}>{h.unavailable_note ?? 'No data for this period.'}</span>
        </div>
      )}
    </Card>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className={styles.stat}>
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}
