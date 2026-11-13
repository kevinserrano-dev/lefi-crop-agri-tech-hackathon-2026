import type { DashboardSummary } from '@lefi/api';
import { Badge, Card, Ring, StatTile } from '../../shared/ui';
import styles from './dashboard.module.css';

const n = (v: number) => v.toLocaleString('en-CA');
const signed = (v: number) => (v > 0 ? `+${v}` : `${v === 0 ? '±0' : '−' + Math.abs(v)}`);

export function HealthScoreTile({ score }: { score: DashboardSummary['health_score'] }) {
  return (
    <Card variant="dark" className={styles.scoreTile}>
      <Ring value={score ? score.value / 100 : 0}>
        <span className={styles.ringValue}>{score ? score.value : '—'}</span>
        <span className={styles.ringSub}>/ 100</span>
      </Ring>
      <div className={styles.scoreText}>
        <span className={styles.scoreLabel}>Greenhouse health score</span>
        {score ? (
          <span className={styles.scoreBody}>
            {score.label} ·{' '}
            <b style={{ color: score.delta_day < 0 ? '#FFD27A' : '#9FE0BC' }}>
              {signed(score.delta_day)}
            </b>{' '}
            vs yesterday,{' '}
            <b style={{ color: score.delta_30d < 0 ? '#FFD27A' : '#9FE0BC' }}>
              {signed(score.delta_30d)}
            </b>{' '}
            vs 30-day avg
          </span>
        ) : (
          <span className={styles.scoreBody}>Unknown — no current data</span>
        )}
      </div>
    </Card>
  );
}

export function ActiveZonesTile({
  zones,
  greenhouses,
}: {
  zones: DashboardSummary['zones'];
  greenhouses: number;
}) {
  return (
    <StatTile
      label="Active zones"
      value={zones.active}
      suffix={`of ${zones.total} · ${greenhouses} greenhouses`}
      footer={
        <>
          <Badge tone="ok">{zones.healthy} healthy</Badge>
          <Badge tone="warn">{zones.warning} warning</Badge>
          <Badge tone="crit">{zones.critical} critical</Badge>
        </>
      }
    />
  );
}

export function TotalPlantsTile({ plants }: { plants: DashboardSummary['plants'] }) {
  return (
    <StatTile
      label="Total plants"
      value={n(plants.total)}
      footer={`${plants.batches} crop batches · ${plants.varieties} varieties · ${plants.harvest_ready_week} harvest-ready this week`}
    />
  );
}

export function PlantConditionTile({
  condition,
}: {
  condition: DashboardSummary['plant_condition'];
}) {
  const total = condition.healthy + condition.warning + condition.critical || 1;
  const pct = (v: number) => `${((v / total) * 100).toFixed(1)}%`;
  const cells = [
    {
      v: condition.healthy,
      label: 'Healthy',
      color: 'var(--lefi-ok-dot)',
      fg: 'var(--lefi-ok-fg)',
    },
    {
      v: condition.warning,
      label: 'Warning',
      color: 'var(--lefi-warn-dot)',
      fg: 'var(--lefi-warn-fg)',
    },
    {
      v: condition.critical,
      label: 'Critical',
      color: 'var(--lefi-crit-dot)',
      fg: 'var(--lefi-crit-fg)',
    },
  ];
  return (
    <Card className={styles.conditionTile}>
      <span className={styles.tileLabel}>Plant condition</span>
      <div className={styles.conditionBar} role="img" aria-label="Plant condition distribution">
        {cells.map((c) => (
          <div key={c.label} style={{ width: pct(c.v), background: c.color }} />
        ))}
      </div>
      <div className={styles.conditionGrid}>
        {cells.map((c) => (
          <div key={c.label}>
            <span className={styles.conditionValue} style={{ color: c.fg }}>
              {n(c.v)}
            </span>
            <span className={styles.conditionLabel}>{c.label}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
