import type { ReactNode } from 'react';
import styles from './KpiTile.module.css';

/** Small KPI card (design: incidents and devices headers). */
export function KpiTile({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string | undefined;
  color?: string;
}) {
  return (
    <div className={styles.kpi}>
      <span>{label}</span>
      <b style={color ? { color } : undefined}>{value ?? '—'}</b>
    </div>
  );
}

export function KpiRow({ children, min = 180 }: { children: ReactNode; min?: number }) {
  return (
    <div
      className={styles.row}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))` }}
    >
      {children}
    </div>
  );
}
