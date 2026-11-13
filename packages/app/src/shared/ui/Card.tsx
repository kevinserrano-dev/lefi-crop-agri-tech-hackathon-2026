import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';
import styles from './Card.module.css';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Right side of the header (badge, link, tabs). */
  actions?: ReactNode;
  variant?: 'default' | 'dark' | 'accent';
  children?: ReactNode;
}

export function Card({
  title,
  subtitle,
  actions,
  variant = 'default',
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <section className={cx(styles.card, styles[variant], className)} {...rest}>
      {(title || actions) && (
        <header className={styles.header}>
          <div className={styles.heading}>
            {title && <h2 className={styles.title}>{title}</h2>}
            {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
