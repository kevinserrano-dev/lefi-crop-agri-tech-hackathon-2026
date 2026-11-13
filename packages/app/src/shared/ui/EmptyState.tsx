import type { ReactNode } from 'react';
import { mascots, type MascotState } from '@lefi/ui';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  mascot?: MascotState;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

/** Full-card message with the Lefi mascot (design: "Access restricted"). */
export function EmptyState({ mascot = 'calm', title, children, action, compact }: EmptyStateProps) {
  return (
    <div className={`${styles.wrap} ${compact ? styles.compact : ''}`}>
      <img src={mascots[mascot]} alt="" className={styles.mascot} />
      <h2 className={styles.title}>{title}</h2>
      {children && <div className={styles.body}>{children}</div>}
      {action}
    </div>
  );
}
