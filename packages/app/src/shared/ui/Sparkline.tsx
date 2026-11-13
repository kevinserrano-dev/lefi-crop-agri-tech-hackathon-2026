/** Tiny trend line (design: sensor cards). Renders nothing for fewer than two points. */
export function Sparkline({
  values,
  color,
  height = 28,
}: {
  values: number[];
  color: string;
  height?: number;
}) {
  if (values.length < 2) return <div style={{ height }} />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const d = values
    .map(
      (v, i) =>
        `${i ? 'L' : 'M'}${((i / (values.length - 1)) * 120).toFixed(1)},${(28 - ((v - lo) / span) * 26 - 1).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg
      viewBox="0 0 120 30"
      preserveAspectRatio="none"
      style={{ width: '100%', height, display: 'block' }}
      aria-hidden="true"
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
