import type { CSSProperties } from 'react';
import styles from './Icon.module.css';

export interface IconProps {
  /** Material Symbols Rounded ligature name, e.g. `sensors`. */
  name: string;
  size?: number;
  filled?: boolean;
  color?: string;
  className?: string;
}

export function Icon({ name, size = 20, filled = false, color, className }: IconProps) {
  const style: CSSProperties = {
    fontSize: size,
    color,
    fontVariationSettings: `'FILL' ${filled ? 1 : 0}`,
  };
  return (
    <span aria-hidden="true" className={`${styles.icon} ${className ?? ''}`} style={style}>
      {name}
    </span>
  );
}
