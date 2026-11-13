import type { ReactNode } from 'react';
import { toneVars, type Tone } from '@lefi/ui';
import styles from './Banner.module.css';

export interface BannerProps {
  tone: Tone;
  icon: string;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}

/** Page-wide notice (design: AI banner; also used for "Brain connection lost"). */
export function Banner({ tone, icon, title, children, action }: BannerProps) {
  const t = toneVars(tone);
  return (
    <div role="status" className={styles.banner} style={{ background: t.bg, borderColor: t.dot }}>
      <span className={styles.icon} style={{ background: t.fg }}>
        {icon}
      </span>
      <div className={styles.text}>
        <b style={{ color: t.fg }}>{title}</b>
        {children && <span className={styles.body}>{children}</span>}
      </div>
      {action}
    </div>
  );
}
