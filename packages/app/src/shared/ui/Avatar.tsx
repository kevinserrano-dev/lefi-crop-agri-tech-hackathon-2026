import { initials } from '../lib/format';

export function Avatar({
  name,
  size = 36,
  color = 'var(--lefi-forest-800)',
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  return (
    <div
      title={name}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.36),
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {initials(name)}
    </div>
  );
}
