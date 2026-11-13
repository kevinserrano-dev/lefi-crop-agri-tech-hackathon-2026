import type { ReactNode } from 'react';
import type { HealthScore } from '@lefi/api';
import { toneVars } from '@lefi/ui';
import styles from './crops.module.css';

export const num = (n: number) => n.toLocaleString('en-CA');

/** Health pill; scores are simulated while no vision model exists (the page says so). */
export function HealthPill({ h, withLabel }: { h: HealthScore; withLabel?: boolean }) {
  const t = toneVars(h.tone);
  return (
    <span className={styles.pill} style={{ background: t.bg, color: t.fg }}>
      {withLabel ? `${h.label} · ${h.value}` : h.value}
    </span>
  );
}

/** Hatched frame where a photo would be; there are no real images yet. */
export function PhotoPlaceholder({ label, height }: { label: string; height?: number | string }) {
  return (
    <div className={styles.photo} style={{ height }} role="img" aria-label={`No image: ${label}`}>
      <span>No image · {label}</span>
    </div>
  );
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <span>{label}</span>
      <b>{children}</b>
    </div>
  );
}
