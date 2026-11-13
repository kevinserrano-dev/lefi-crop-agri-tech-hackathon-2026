export function Skeleton({ height = 120, radius = 16 }: { height?: number; radius?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{ height, borderRadius: radius, background: 'var(--lefi-skeleton)' }}
    />
  );
}
