import type { ReactNode } from 'react';
import styles from './LineChart.module.css';

export interface ChartSeries {
  values: number[];
  color: string;
  /** Value range mapped to the plot height. */
  min: number;
  max: number;
  kind?: 'line' | 'area' | 'bars';
  /** Draw a dot on the last point that has a value. */
  endDot?: boolean;
  /** Dashed stroke (e.g. a projection). */
  dashed?: boolean;
}

export interface LineChartProps {
  series: ChartSeries[];
  /** Shaded band with dashed edges (design: operating range), in the first series' scale. */
  band?: { from: number; to: number; color: string };
  /** Plot height in viewBox units (default 200). */
  height?: number;
  xLabels: string[];
  leftAxis?: { labels: string[]; color?: string };
  rightAxis?: { labels: string[]; color?: string };
  legend?: ReactNode;
}

const W = 640;

const yAt = (H: number) => (v: number, lo: number, hi: number) =>
  Math.max(0, Math.min(H, H - ((v - lo) / (hi - lo)) * H));
const x = (i: number, n: number) => (i / (n - 1)) * W;

/** Non-finite values (NaN) are gaps: the line restarts after them. */
function linePath(s: ChartSeries, H: number) {
  const y = yAt(H);
  let pen = 'M';
  const parts: string[] = [];
  s.values.forEach((v, i) => {
    if (!Number.isFinite(v)) {
      pen = 'M';
      return;
    }
    parts.push(`${pen}${x(i, s.values.length).toFixed(1)},${y(v, s.min, s.max).toFixed(1)}`);
    pen = 'L';
  });
  return parts.join(' ');
}

const lastPoint = (values: number[]) => {
  for (let i = values.length - 1; i >= 0; i--) if (Number.isFinite(values[i])) return i;
  return -1;
};

const firstPoint = (values: number[]) => Math.max(0, values.findIndex(Number.isFinite));

function barsPath(s: ChartSeries, H: number) {
  const y = yAt(H);
  const n = s.values.length;
  return s.values
    .map((v, i) => {
      const cx = x(i, n) - 6;
      const h = H - y(v, s.min, s.max);
      const w = i === 0 || i === n - 1 ? 6 : 12;
      return `M${Math.max(0, cx).toFixed(1)},${(H - h).toFixed(1)}h${w}V${H}h-${w}Z`;
    })
    .join(' ');
}

/** Lightweight SVG time-series chart matching the design's trend cards. */
export function LineChart({
  series,
  xLabels,
  leftAxis,
  rightAxis,
  band,
  height = 200,
}: LineChartProps) {
  const H = height;
  const y = yAt(H);
  const grid = [0.5, H / 3, (2 * H) / 3, H - 0.5].map((g) => `M0,${g.toFixed(1)}H${W}`).join('');
  const s0 = series[0];
  const by1 = band && s0 ? y(band.to, s0.min, s0.max) : 0;
  const by2 = band && s0 ? y(band.from, s0.min, s0.max) : 0;
  return (
    <div className={styles.wrap}>
      {leftAxis && <Axis labels={leftAxis.labels} color={leftAxis.color} />}
      <div className={styles.plot}>
        <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img" aria-label="Trend chart">
          {band && s0 && (
            <rect
              x="0"
              y={by1}
              width={W}
              height={Math.max(0, by2 - by1)}
              fill={band.color}
              fillOpacity="0.09"
            />
          )}
          <path d={grid} stroke="#EDF1EE" strokeWidth="1" fill="none" />
          {band && s0 && (
            <>
              <line x1="0" x2={W} y1={by1} y2={by1} stroke={band.color} strokeDasharray="4 4" />
              <line x1="0" x2={W} y1={by2} y2={by2} stroke={band.color} strokeDasharray="4 4" />
            </>
          )}
          {series.map((s, i) => {
            if (s.values.length < 2) return null;
            if (s.kind === 'bars') return <path key={i} d={barsPath(s, H)} fill={s.color} />;
            const d = linePath(s, H);
            const li = lastPoint(s.values);
            const last = s.values[li] ?? s.min;
            return (
              <g key={i}>
                {s.kind === 'area' && (
                  <path
                    d={`${d} L${x(li, s.values.length).toFixed(1)},${H} L${x(firstPoint(s.values), s.values.length).toFixed(1)},${H} Z`}
                    fill={s.color}
                    fillOpacity="0.12"
                  />
                )}
                <path
                  d={d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2.4"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={s.dashed ? '6 6' : undefined}
                />
                {s.endDot && li >= 0 && (
                  <circle
                    cx={x(li, s.values.length)}
                    cy={y(last, s.min, s.max)}
                    r="5"
                    fill="#fff"
                    stroke={s.color}
                    strokeWidth="2.5"
                  />
                )}
              </g>
            );
          })}
        </svg>
        <div className={styles.xLabels}>
          {xLabels.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
      </div>
      {rightAxis && <Axis labels={rightAxis.labels} color={rightAxis.color} />}
    </div>
  );
}

function Axis({ labels, color }: { labels: string[]; color?: string | undefined }) {
  return (
    <div className={styles.axis} style={color ? { color } : undefined}>
      {labels.map((l) => (
        <span key={l}>{l}</span>
      ))}
    </div>
  );
}

export function Legend({
  items,
}: {
  items: Array<{ label: string; color: string; shape?: 'line' | 'block' }>;
}) {
  return (
    <div className={styles.legend}>
      {items.map((it) => (
        <span key={it.label}>
          <span
            className={it.shape === 'block' ? styles.block : styles.line}
            style={{ background: it.color }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}
