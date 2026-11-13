import type { SimRobotPose, SimScene } from '@lefi/api';
import styles from './robotsLive.module.css';

const PAD = 0.4; // metres around the scene bounds
const PLANT: Record<string, string> = {
  lettuce: '#7CC35A',
  basil: '#3E8F3A',
  tomato: '#D9442F',
};

export interface MapProps {
  scene: SimScene;
  pose: SimRobotPose | null;
  /** Where the robot has been (oldest first), in scene metres. */
  trail: Array<{ x: number; y: number }>;
  target?: string | null;
  selected?: string | null;
  onPick?: (stationId: string) => void;
}

/**
 * The simulated greenhouse seen from above (ADR-091), drawn from the scene Lefi Brain serves: the
 * benches, the plants (stations a mission can go to and decorative ones), the robot's pose and its
 * trail. +x points right and +y up, as in the simulator.
 */
export function SceneMap({ scene, pose, trail, target, selected, onPick }: MapProps) {
  const b = scene.bounds;
  const x0 = b.x_min - PAD;
  const y0 = b.y_min - PAD;
  const w = b.x_max - b.x_min + 2 * PAD;
  const h = b.y_max - b.y_min + 2 * PAD;
  // SVG y grows downwards: flip so +y is up.
  const X = (x: number) => x - x0;
  const Y = (y: number) => h - (y - y0);
  const trailPath =
    trail.length > 1 ? 'M' + trail.map((p) => `${X(p.x)},${Y(p.y)}`).join(' L') : '';
  const goal = scene.stations.find((s) => s.id === target);

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={styles.map}
      role="img"
      aria-label="Simulated greenhouse seen from above, with the robot's position"
    >
      <rect x={0} y={0} width={w} height={h} fill="#10261F" />
      <rect
        x={X(b.x_min)}
        y={Y(b.y_max)}
        width={b.x_max - b.x_min}
        height={b.y_max - b.y_min}
        rx={0.08}
        fill="#183A2F"
        stroke="#2C5847"
        strokeWidth={0.02}
      />
      <rect
        x={X(b.x_min + 0.2)}
        y={Y(0.45)}
        width={b.x_max - b.x_min - 0.4}
        height={0.9}
        fill="#1F4A3B"
      />
      {scene.benches.map((bn) => (
        <g key={bn.id}>
          <rect
            x={X(bn.x - bn.length / 2)}
            y={Y(bn.y + bn.width / 2)}
            width={bn.length}
            height={bn.width}
            rx={0.04}
            fill="#8A6A45"
            stroke="#B48D5E"
            strokeWidth={0.015}
          />
          <text
            x={X(bn.x + bn.length / 2) - 0.08}
            y={Y(bn.y) + 0.06}
            textAnchor="end"
            className={styles.mapLabel}
          >
            {bn.label}
          </text>
        </g>
      ))}
      {scene.decor_plants.map((p, i) => (
        <circle
          key={i}
          cx={X(p.x)}
          cy={Y(p.y)}
          r={0.09}
          fill={PLANT[p.kind] ?? '#5FAE4A'}
          opacity={0.55}
        />
      ))}
      {goal && (
        <line
          x1={pose ? X(pose.x) : X(scene.start.x)}
          y1={pose ? Y(pose.y) : Y(scene.start.y)}
          x2={X(goal.approach.x)}
          y2={Y(goal.approach.y)}
          stroke="#E8C547"
          strokeWidth={0.025}
          strokeDasharray="0.08 0.06"
        />
      )}
      {trailPath && (
        <path d={trailPath} fill="none" stroke="#5BC0EB" strokeWidth={0.03} opacity={0.8} />
      )}
      {scene.stations.map((s) => {
        const dock = s.kind === 'dock';
        const active = s.id === target;
        const sel = s.id === selected;
        return (
          <g
            key={s.id}
            className={onPick ? styles.station : undefined}
            onClick={onPick ? () => onPick(s.id) : undefined}
            role={onPick ? 'button' : undefined}
            aria-label={onPick ? `Choose ${s.label}` : undefined}
          >
            {dock ? (
              <rect
                x={X(s.x) - 0.15}
                y={Y(s.y) - 0.3}
                width={0.3}
                height={0.6}
                rx={0.04}
                fill="#1F74D8"
              />
            ) : (
              <circle
                cx={X(s.x)}
                cy={Y(s.y)}
                r={0.13}
                fill={PLANT[s.kind] ?? '#5FAE4A'}
                stroke={active ? '#E8C547' : sel ? '#FFFFFF' : '#0B1D17'}
                strokeWidth={active || sel ? 0.04 : 0.02}
              />
            )}
            <circle
              cx={X(s.approach.x)}
              cy={Y(s.approach.y)}
              r={0.035}
              fill="none"
              stroke="#E8C547"
              strokeWidth={0.012}
              opacity={0.7}
            />
            <text
              x={X(s.x)}
              y={dock ? Y(s.y) + 0.45 : Y(s.y) + (s.y > 0 ? -0.2 : 0.3)}
              textAnchor="middle"
              className={styles.mapLabel}
            >
              {s.label}
            </text>
          </g>
        );
      })}
      {pose && (
        <g
          transform={`translate(${X(pose.x)},${Y(pose.y)}) rotate(${-pose.yaw_deg})`}
          aria-label={`Robot at x ${pose.x.toFixed(2)} m, y ${pose.y.toFixed(2)} m`}
        >
          <circle r={0.24} fill="#E9F1F7" opacity={0.18} />
          <circle r={0.16} fill="#F4F7FA" stroke="#0E1A22" strokeWidth={0.02} />
          <path d="M0.27,0 L0.08,0.1 L0.08,-0.1 Z" fill="#5BC0EB" />
        </g>
      )}
    </svg>
  );
}
