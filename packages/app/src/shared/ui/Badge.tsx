import type { ReactNode } from 'react';
import { toneVars, type Tone } from '@lefi/ui';
import { Icon } from './Icon';
import styles from './Badge.module.css';

export interface BadgeProps {
  tone: Tone;
  children: ReactNode;
  icon?: string;
  /** Small uppercase tag (LIVE, SIM, AI-GENERATED). */
  variant?: 'pill' | 'tag';
  dot?: boolean;
  title?: string;
}

export function Badge({ tone, children, icon, variant = 'pill', dot, title }: BadgeProps) {
  const t = toneVars(tone);
  return (
    <span
      className={`${styles.badge} ${styles[variant]}`}
      style={{ background: t.bg, color: t.fg }}
      title={title}
    >
      {dot && <span className={styles.dot} style={{ background: t.dot }} />}
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}

/** Counter used in the sidebar and notification bell. */
export function CountBadge({ tone, count }: { tone: Tone; count: number | string }) {
  const t = toneVars(tone);
  return (
    <span className={styles.count} style={{ background: t.bg, color: t.fg }}>
      {count}
    </span>
  );
}
