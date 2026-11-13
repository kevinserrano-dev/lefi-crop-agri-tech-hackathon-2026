import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';
import { Icon } from './Icon';
import styles from './Button.module.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'link' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: string;
  block?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  block,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(styles.btn, styles[variant], styles[size], block && styles.block, className)}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 17 : 19} />}
      {children}
    </button>
  );
}
