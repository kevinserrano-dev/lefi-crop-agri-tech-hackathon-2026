import type { Trend } from '@lefi/api';
import { Card, Legend, LineChart, ProvenanceBadge } from '../../shared/ui';
import styles from './dashboard.module.css';

/** Five evenly spaced axis labels from ISO timestamps. */
function ticks(labels: string[], fmt: (d: Date) => string): string[] {
  if (labels.length < 2) return [];
  return [0, 0.25, 0.5, 0.75, 1].map((f) =>
    fmt(new Date(labels[Math.round(f * (labels.length - 1))]!)),
  );
}
const day = (d: Date) => d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
const hhmm = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

const C = { score: '#2E9A63', warn: '#F3DDA8', temp: '#E07A3F', rh: '#3C84C0' };

export function PlantHealthTrendCard({ trend }: { trend: Trend | undefined }) {
  const score = trend?.series.score ?? [];
  const warn = trend?.series.warning_plants_k ?? [];
  return (
    <Card
      title={
        <span className={styles.titleWithTag}>
          Plant health trend {trend && <ProvenanceBadge origin={trend.origin} />}
        </span>
      }
      subtitle="Facility health score · last 30 days"
      actions={
        <Legend
          items={[
            { label: 'Score', color: C.score },
            { label: 'Warning plants (k)', color: C.warn, shape: 'block' },
          ]}
        />
      }
    >
      <LineChart
        leftAxis={{ labels: ['95', '90', '85', '80'] }}
        xLabels={ticks(trend?.labels ?? [], day)}
        series={[
          { values: warn, color: C.warn, min: 0, max: 133.3, kind: 'bars' },
          { values: score, color: C.score, min: 80, max: 95, kind: 'area', endDot: true },
        ]}
      />
    </Card>
  );
}

export function EnvironmentTrendCard({ trend }: { trend: Trend | undefined }) {
  return (
    <Card
      title={
        <span className={styles.titleWithTag}>
          Environmental trends {trend && <ProvenanceBadge origin={trend.origin} />}
        </span>
      }
      subtitle="Facility average · last 24 h"
      actions={
        <Legend
          items={[
            { label: 'Temp °C', color: C.temp },
            { label: 'RH %', color: C.rh },
          ]}
        />
      }
    >
      <LineChart
        leftAxis={{ labels: ['26°', '22°', '18°', '14°'], color: C.temp }}
        rightAxis={{ labels: ['90', '77', '63', '50'], color: C.rh }}
        xLabels={ticks(trend?.labels ?? [], hhmm)}
        series={[
          { values: trend?.series.temp_c ?? [], color: C.temp, min: 14, max: 26 },
          { values: trend?.series.rh_pct ?? [], color: C.rh, min: 50, max: 90 },
        ]}
      />
    </Card>
  );
}
