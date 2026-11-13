import type { RobotLive } from '@lefi/api';
import styles from './robots.module.css';

/** Live floor map (design). Rows and plant markers are drawn from the zone geometry the Brain sends. */
export function FloorMap({ live }: { live: RobotLive }) {
  const { map, robot } = live;
  const rows: string[] = [];
  const dots: string[] = [];
  for (const z of map.zones) {
    for (let i = 0; ; i++) {
      const x = z.x + 35 + i * 45;
      if (x > z.x + z.w - 15) break;
      rows.push(`M${x},${z.y + 16}V${z.y + z.h - 16}`);
      for (let y = z.y + 27; y < z.y + z.h - 18; y += 21)
        dots.push(`M${x - 3.4},${y}a3.4,3.4 0 1,0 6.8,0a3.4,3.4 0 1,0 -6.8,0`);
    }
  }
  const path = map.route.length
    ? `M${robot.position.x},${robot.position.y} ${map.route.map((p) => `L${p.x},${p.y}`).join(' ')}`
    : '';
  const target = live.mission ? map.targets.find((t) => t.id === live.mission!.target) : undefined;

  return (
    <div className={styles.map}>
      <div className={styles.mapHead}>
        <div className={styles.mapTitle}>
          <span>{map.title}</span>
          <span>{map.subtitle}</span>
        </div>
        <div className={styles.mapLegend}>
          <span>
            <i style={{ background: '#54B985' }} />
            Plants
          </span>
          <span>
            <i className={styles.dash} />
            Planned path
          </span>
          <span>
            <i style={{ background: '#3C84C0' }} />
            Crew
          </span>
          <span>
            <i style={{ background: '#E0A21B' }} />
            Restricted
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${map.width} ${map.height}`}
        className={styles.svg}
        role="img"
        aria-label="Simulated floor map with robot position"
      >
        <rect x="0" y="0" width={map.width} height={map.height} fill="#0F2620" />
        <rect x="70" y={map.aisle_y - 24} width="915" height="48" rx="6" fill="#16332A" />
        <text
          x="760"
          y={map.aisle_y + 5}
          fill="#4F7B69"
          fontSize="12"
          fontFamily="JetBrains Mono"
          letterSpacing="3"
        >
          MAIN AISLE
        </text>
        {map.zones.map((z) => (
          <g key={z.id}>
            <rect
              x={z.x}
              y={z.y}
              width={z.w}
              height={z.h}
              rx="12"
              fill="#14302A"
              stroke="#24493C"
            />
            {z.restricted && (
              <rect
                x={z.x}
                y={z.y}
                width={z.w}
                height={z.h}
                rx="12"
                fill="none"
                stroke="#E0A21B"
                strokeWidth="2"
                strokeDasharray="10 8"
                opacity="0.7"
              />
            )}
            <text
              x={z.x + 14}
              y={z.y < 200 ? z.y - 8 : z.y + z.h + 20}
              fill={z.restricted ? '#E0A21B' : '#8FB8A3'}
              fontSize="12"
              fontWeight="700"
              fontFamily="Manrope"
            >
              {z.label}
            </text>
          </g>
        ))}
        <path
          d={rows.join('')}
          stroke="#1F4538"
          strokeWidth="16"
          strokeLinecap="round"
          fill="none"
        />
        <path d={dots.join('')} fill="#54B985" opacity="0.85" />
        <rect
          x={map.dock.x - 30}
          y={map.dock.y - 28}
          width="56"
          height="56"
          rx="10"
          fill="#1C3F33"
          stroke="#54B985"
          strokeDasharray="4 4"
        />
        <text
          x={map.dock.x - 20}
          y={map.dock.y + 44}
          fill="#9FE0BC"
          fontSize="11"
          fontWeight="700"
          fontFamily="JetBrains Mono"
        >
          DOCK
        </text>
        {map.targets.map((t) => (
          <g key={t.id}>
            <circle
              cx={t.x}
              cy={t.y}
              r="11"
              fill="none"
              stroke={t.allowed ? (target?.id === t.id ? '#FFFFFF' : '#C9E3D5') : '#E0A21B'}
              strokeWidth={target?.id === t.id ? 2.5 : 1.5}
            />
            <text
              x={t.x + 14}
              y={t.y - 12}
              fill={t.allowed ? '#E6F2EB' : '#E0A21B'}
              fontSize="12"
              fontWeight="700"
              fontFamily="JetBrains Mono"
            >
              {t.id}
            </text>
          </g>
        ))}
        {map.crew.map((c) => (
          <g key={c.label}>
            <circle cx={c.x} cy={c.y} r="6" fill="#3C84C0" />
            <text x={c.x + 10} y={c.y + 4} fill="#8EC1E8" fontSize="11" fontFamily="Manrope">
              {c.label}
            </text>
          </g>
        ))}
        {path && (
          <path
            d={path}
            fill="none"
            stroke="#E6F2EB"
            strokeWidth="2"
            strokeDasharray="6 6"
            opacity="0.8"
          />
        )}
        <g transform={`translate(${robot.position.x},${robot.position.y})`}>
          <circle r="16" fill="#54B985" opacity="0.25" />
          <circle r="10" fill="#E6F2EB" stroke="#163D32" strokeWidth="3" />
        </g>
      </svg>
      <div className={styles.mapFoot}>
        <span>
          Position{' '}
          <b>
            x {robot.position_m.x.toFixed(1)} m · y {robot.position_m.y.toFixed(1)} m
          </b>
        </span>
        <span>
          Location <b>{robot.location}</b>
        </span>
        <span>
          Speed <b>{robot.speed_mps.toFixed(2)} m/s</b>
        </span>
        <span>
          Remaining <b>{robot.remaining_m === null ? '—' : `${robot.remaining_m} m`}</b>
        </span>
      </div>
    </div>
  );
}
