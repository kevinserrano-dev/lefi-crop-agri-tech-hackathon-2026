import type { Reading } from '@lefi/api';
import { healthTone, toneVars } from '@lefi/ui';
import { variableIcon } from '../../shared/lib/variables';
import { timeAgo } from '../../shared/lib/time';
import { Icon, SourceTag } from '../../shared/ui';
import styles from './environment.module.css';

const STATUS_LABEL = {
  HEALTHY: 'Healthy',
  WARNING: 'Warning',
  CRITICAL: 'Critical',
  UNKNOWN: 'No data',
} as const;
const hms = (iso: string) => new Date(iso).toLocaleTimeString('en-GB');

function lastLabel(r: Reading, brainTime: string | undefined): string {
  if (!r.received_at) return 'Never reported';
  if (r.value === null) return `Last seen ${hms(r.received_at).slice(0, 5)}`;
  if (r.source === 'estimate') return `Model estimate · ${hms(r.received_at).slice(0, 5)}`;
  return `${hms(r.received_at)} · ${timeAgo(r.received_at, brainTime)}`;
}

/** Selectable metric cards (design: Environment top row). */
export function MetricCards({
  readings,
  selected,
  onSelect,
  stale,
  brainTime,
}: {
  readings: Reading[];
  selected: string;
  onSelect: (variable: string) => void;
  stale: boolean;
  brainTime: string | undefined;
}) {
  return (
    <div className={styles.cards}>
      {readings.map((r) => {
        const freshness = stale && r.freshness === 'LIVE' ? 'STALE' : r.freshness;
        const status = freshness === 'LIVE' ? r.status : 'UNKNOWN';
        const t = toneVars(healthTone[status]);
        return (
          <button
            key={r.variable}
            type="button"
            className={styles.card}
            aria-pressed={r.variable === selected}
            data-critical={status === 'CRITICAL'}
            onClick={() => onSelect(r.variable)}
          >
            <div className={styles.cardHead}>
              <Icon name={variableIcon(r.variable)} size={20} color={t.fg} />
              <SourceTag source={r.source} origin={r.origin} freshness={freshness} />
            </div>
            <span className={styles.cardLabel}>{r.label}</span>
            <div className={styles.cardValue}>
              <span>{r.value === null ? '—' : r.value.toFixed(r.decimals)}</span>
              <span className={styles.unit}>{r.unit}</span>
            </div>
            <span className={styles.cardStatus} style={{ color: t.fg }}>
              {STATUS_LABEL[status]}
            </span>
            <span className={styles.cardLast}>{lastLabel(r, brainTime)}</span>
          </button>
        );
      })}
    </div>
  );
}
