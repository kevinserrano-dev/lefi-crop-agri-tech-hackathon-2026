import type { ReactNode } from 'react';

/** Circular progress (design: health score ring). `value` in 0..1. */
export function Ring({
  value,
  size = 96,
  track = '#2B5A4B',
  color = 'var(--lefi-green-400)',
  children,
}: {
  value: number;
  size?: number;
  track?: string;
  color?: string;
  children?: ReactNode;
}) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg
        viewBox="0 0 120 120"
        width={size}
        height={size}
        style={{ transform: 'rotate(-90deg)' }}
        aria-hidden="true"
      >
        <circle cx="60" cy="60" r={r} fill="none" stroke={track} strokeWidth="12" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${(v * c).toFixed(1)} ${c.toFixed(1)}`}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </div>
    </div>
  );
}
