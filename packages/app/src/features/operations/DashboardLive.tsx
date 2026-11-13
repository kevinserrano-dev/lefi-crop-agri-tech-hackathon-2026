import { useQuery } from '@tanstack/react-query';
import { operationsQueries, type Overview } from '@lefi/api';
import { toneVars } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { screenPath } from '../../app/screenPath';
import { goTo } from '../../shared/lib/assistant';
import { describeError } from '../../shared/lib/errors';
import { greeting } from '../../shared/lib/time';
import { Badge, Card, Chip, EmptyState, Ring, Skeleton, StatTile } from '../../shared/ui';
import { useCan, useSession } from '../session';
import { ZoneMonitoringCard } from '../health-review';
import {
  ActiveAlertsCard,
  CurrentConditionsCard,
  EnvironmentTrendCard,
  FollowUpsCard,
  LefiSummaryCard,
  PlantHealthTrendCard,
  RobotsCard,
  TeamActivityCard,
} from './DashboardLiveCards';
import { siteStatus, zoneConditions } from './dashboardModel';
import d from '../dashboard/dashboard.module.css';

const n = (v: number) => v.toLocaleString('en-CA');

/**
 * Executive Dashboard against the real Lefi Brain, in the layout of the design (ADR-070, ADR-077):
 * every tile, chart and sentence comes from `/overview` and `/overview/trends`. What Lefi Brain
 * does not have yet (AI summaries, tasks, robots, shifts) says so instead of showing anything.
 */
export function DashboardLive() {
  const platform = usePlatform();
  const q = useQuery(operationsQueries.overview(platform));
  const trends = useQuery(operationsQueries.overviewTrends(platform));
  const { data: session } = useSession();
  const seesHealth = useCan('nav.plantHealth');
  if (q.isError)
    return (
      <EmptyState mascot="sad" title="Could not load the overview">
        {describeError(q.error)}
      </EmptyState>
    );
  if (!q.data) return <Skeleton height={520} />;
  const o = q.data;
  const now = o.brain_time;
  const firstName = session?.user.display_name.split(' ')[0] ?? '';
  const go = (id: string) => goTo(screenPath(id));
  const time = new Date(now).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  return (
    <>
      <div className={d.header}>
        <div className={d.headerText}>
          <h1>
            {greeting(now)}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <span>
            {[
              `${n(o.places.greenhouses)} ${o.places.greenhouses === 1 ? 'greenhouse' : 'greenhouses'}`,
              `${n(o.places.zones)} ${o.places.zones === 1 ? 'zone' : 'zones'}`,
              `Lefi Brain time ${time}`,
              'updated every 15 s',
            ].join(' · ')}
          </span>
        </div>
        <div className={d.focus}>
          <Chip
            label={
              o.alerts.unacknowledged
                ? `${o.alerts.unacknowledged} alerts to acknowledge`
                : 'No alert to acknowledge'
            }
            tone={o.alerts.critical ? 'crit' : o.alerts.unacknowledged ? 'warn' : 'ok'}
            onClick={() => go('alerts')}
          />
          <Chip
            label={`${o.plant_health.open_requests} ${o.plant_health.open_requests === 1 ? 'inspection' : 'inspections'} asked`}
            tone={o.plant_health.open_requests ? 'warn' : 'ok'}
            onClick={() => go('plantHealth')}
          />
          <Chip
            label={`${o.people.signed_in_now} signed in now`}
            tone="info"
            onClick={() => go('workforce')}
          />
        </div>
      </div>

      <div className={d.kpis}>
        <StatusTile o={o} />
        <ZonesTile o={o} />
        <StatTile
          label="Plants"
          value={n(o.places.plants)}
          footer={`${o.places.crop_plants} in ${o.places.active_crops} ${o.places.active_crops === 1 ? 'crop batch' : 'crop batches'} · ${o.crops.length} ${o.crops.length === 1 ? 'crop' : 'crops'}`}
        />
        <ConditionTile o={o} />
      </div>

      <div className={d.row2}>
        <LefiSummaryCard o={o} />
        <ActiveAlertsCard o={o} />
      </div>

      {seesHealth && <ZoneMonitoringCard />}

      <CurrentConditionsCard o={o} trends={trends.data} />

      <div className={d.row2}>
        <PlantHealthTrendCard trends={trends.data} error={trends.error} />
        <EnvironmentTrendCard trends={trends.data} error={trends.error} />
      </div>

      <div className={d.row3}>
        <FollowUpsCard o={o} />
        <RobotsCard />
        <TeamActivityCard o={o} />
      </div>
    </>
  );
}

/** Dark tile of the design: greenhouse status with the share of sensors receiving data. */
function StatusTile({ o }: { o: Overview }) {
  const s = siteStatus(o);
  const pct = s.coverage === null ? null : Math.round(s.coverage * 100);
  const color = s.tone === 'ok' ? 'var(--lefi-green-400)' : toneVars(s.tone).dot;
  return (
    <Card variant="dark" className={d.scoreTile}>
      <Ring value={s.coverage ?? 0} color={color}>
        <span className={d.ringValue}>{pct ?? '—'}</span>
        <span className={d.ringSub}>{pct === null ? 'no sensors' : '% receiving'}</span>
      </Ring>
      <div className={d.scoreText}>
        <span className={d.scoreLabel}>Greenhouse status</span>
        <span className={d.scoreBody}>
          <b style={{ color: s.tone === 'ok' ? '#9FE0BC' : '#FFD27A' }}>{s.word}</b> · {s.receiving}{' '}
          of {s.enabled} sensors receiving · {o.devices.online} of {o.devices.total} devices online
          {o.alerts.active > 0 && ` · ${o.alerts.active} active alerts`}
        </span>
      </div>
    </Card>
  );
}

function ZonesTile({ o }: { o: Overview }) {
  const z = zoneConditions(o);
  return (
    <StatTile
      label="Active zones"
      value={z.active}
      suffix={`of ${o.places.zones} · ${o.places.greenhouses} ${o.places.greenhouses === 1 ? 'greenhouse' : 'greenhouses'}`}
      footer={
        <>
          <Badge tone="ok">{z.clear} no alerts</Badge>
          <Badge tone="warn">{z.warning} warning</Badge>
          <Badge tone="crit">{z.critical} critical</Badge>
        </>
      }
    />
  );
}

/** Plant condition as people recorded it: never an AI detection (none exists, ADR-070). */
function ConditionTile({ o }: { o: Overview }) {
  const h = o.plant_health;
  const cells = [
    { v: h.healthy, label: 'Healthy', tone: 'ok' as const },
    { v: h.watch, label: 'Watch', tone: 'warn' as const },
    { v: h.problem, label: 'Problem', tone: 'crit' as const },
  ];
  const total = h.healthy + h.watch + h.problem + h.not_checked;
  return (
    <Card className={d.conditionTile}>
      <span className={d.tileLabel}>Plant condition</span>
      <div className={d.conditionBar} role="img" aria-label="Plant condition distribution">
        {total === 0 ? (
          <div style={{ width: '100%', background: 'var(--lefi-skeleton)' }} />
        ) : (
          [...cells, { v: h.not_checked, label: 'Not checked', tone: 'off' as const }].map((c) => (
            <div
              key={c.label}
              style={{ width: `${(c.v / total) * 100}%`, background: toneVars(c.tone).dot }}
            />
          ))
        )}
      </div>
      <div className={d.conditionGrid}>
        {cells.map((c) => (
          <div key={c.label}>
            <span className={d.conditionValue} style={{ color: toneVars(c.tone).fg }}>
              {n(c.v)}
            </span>
            <span className={d.conditionLabel}>{c.label}</span>
          </div>
        ))}
      </div>
      <span className={d.muted}>{h.not_checked} not checked · recorded by people</span>
    </Card>
  );
}
