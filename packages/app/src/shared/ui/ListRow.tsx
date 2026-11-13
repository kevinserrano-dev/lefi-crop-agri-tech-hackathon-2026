import type { ReactNode } from 'react';
import { toneVars, type Tone } from '@lefi/ui';
import styles from './ListRow.module.css';

export interface ListRowProps {
  icon?: string;
  tone?: Tone;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
}

/** Row with tinted icon, title, meta line and trailing content (design: alert lists). */
export function ListRow({ icon, tone = 'info', title, meta, trailing }: ListRowProps) {
  const t = toneVars(tone);
  return (
    <div className={styles.row}>
      {icon && (
        <span className={styles.icon} style={{ background: t.bg, color: t.fg }}>
          {icon}
        </span>
      )}
      <div className={styles.text}>
        <span className={styles.title}>{title}</span>
        {meta && <span className={styles.meta}>{meta}</span>}
      </div>
      {trailing && <span className={styles.trailing}>{trailing}</span>}
    </div>
  );
}
