import type { Detection } from '@lefi/api';
import { mascots, severityTone, toneVars } from '@lefi/ui';
import { STATUS } from './presentation';
import styles from './plantHealth.module.css';

export function DetectionList({
  items,
  selected,
  onSelect,
}: {
  items: Detection[];
  selected: string | undefined;
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className={styles.empty}>
        <img src={mascots.calm} alt="" />
        <b>Nothing here</b>
        <span className={styles.muted}>No detections match this filter.</span>
      </div>
    );
  }
  return (
    <>
      {items.map((d) => {
        const st = STATUS[d.status];
        return (
          <button
            key={d.id}
            type="button"
            className={styles.item}
            aria-pressed={d.id === selected}
            onClick={() => onSelect(d.id)}
          >
            <span className={styles.thumb} aria-hidden="true">
              <span style={{ background: toneVars(severityTone[d.severity]).dot }} />
            </span>
            <span className={styles.itemText}>
              <b>{d.finding}</b>
              <span className={styles.muted}>
                {d.zone_id} · {d.plant_id} · {d.confidence} %
              </span>
              <span className={styles.statusTag} style={{ background: st.bg, color: st.fg }}>
                {st.label}
              </span>
            </span>
          </button>
        );
      })}
    </>
  );
}
