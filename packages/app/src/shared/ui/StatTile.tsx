import type { ReactNode } from 'react';
import { Card } from './Card';
import styles from './StatTile.module.css';

export interface StatTileProps {
  label: string;
  value: ReactNode;
  suffix?: ReactNode;
  footer?: ReactNode;
}

export function StatTile({ label, value, suffix, footer }: StatTileProps) {
  return (
    <Card className={styles.tile}>
      <span className={styles.label}>{label}</span>
      <div className={styles.valueRow}>
        <span className={styles.value}>{value}</span>
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </div>
      {footer && <div className={styles.footer}>{footer}</div>}
    </Card>
  );
}
