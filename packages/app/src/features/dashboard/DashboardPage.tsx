import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { queries } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError, isForbidden } from '../../shared/lib/errors';
import { greeting, timeAgo } from '../../shared/lib/time';
import { Chip, Skeleton } from '../../shared/ui';
import { screenPath } from '../../app/screenPath';
import { RestrictedState, useCan, useSession } from '../session';
import { useBrainStatus } from '../shell';
import { ActiveAlertsCard } from './ActiveAlertsCard';
import { PendingTasksCard, RobotCard, ShiftActivityCard } from './BottomCards';
import { CurrentConditionsCard } from './CurrentConditionsCard';
import { ActiveZonesTile, HealthScoreTile, PlantConditionTile, TotalPlantsTile } from './KpiTiles';
import { LefiSummaryCard } from './LefiSummaryCard';
import { EnvironmentTrendCard, PlantHealthTrendCard } from './TrendCards';
import styles from './dashboard.module.css';

/** Executive Dashboard (design: "Lefi Crop AI Main" → Dashboard). */
export function DashboardPage() {
  const platform = usePlatform();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const brain = useBrainStatus();
  const can = {
    alerts: useCan('nav.alerts'),
    tasks: useCan('nav.tasks'),
    robots: useCan('nav.robots'),
  };

  const summary = useQuery(queries.dashboard(platform));
  const alerts = useQuery({ ...queries.alerts(platform), enabled: can.alerts });
  const tasks = useQuery({ ...queries.tasks(platform), enabled: can.tasks });
  const robots = useQuery({ ...queries.robots(platform), enabled: can.robots });
  const ai = useQuery(queries.aiSummary(platform));
  const health = useQuery(queries.healthTrend(platform));
  const env = useQuery(queries.environmentTrend(platform));
  const shift = useQuery(queries.shiftNow(platform));
  const activity = useQuery(queries.activity(platform));
  const zones = useQuery(queries.zones(platform));
  const focusZone = (
    zones.data?.find((z) => z.health === 'CRITICAL') ??
    zones.data?.find((z) => z.health === 'WARNING')
  )?.id;

  if (summary.isError && isForbidden(summary.error)) {
    return <RestrictedState roleName={session?.role.name} permission="nav.dashboard" />;
  }

  const s = summary.data;
  const firstName = session?.user.display_name.split(' ')[0] ?? '';
  const lastSync = summary.dataUpdatedAt ? new Date(summary.dataUpdatedAt).toISOString() : null;
  const goScreen = (id: string, search: Record<string, string> = {}) =>
    void navigate({ to: screenPath(id), search });

  return (
    <>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <h1>
            {greeting(brain.brainTime)}, {firstName}
          </h1>
          <span>
            {s
              ? [
                  s.site_name,
                  `${s.greenhouse_count} greenhouses`,
                  s.shift && `${s.shift.name} ${s.shift.start}–${s.shift.end}`,
                  lastSync && `Last sync ${timeAgo(lastSync, undefined)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : '…'}
          </span>
        </div>
        <div className={styles.focus}>
          {s?.focus.map((f) => (
            <Chip
              key={f.label}
              label={f.label}
              tone={f.tone}
              onClick={() => goScreen(f.screen, f.search)}
            />
          ))}
        </div>
      </div>

      {summary.isPending ? (
        <div className={styles.kpis}>
          <Skeleton />
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : s ? (
        <div className={styles.kpis}>
          <HealthScoreTile score={brain.connected ? s.health_score : null} />
          <ActiveZonesTile zones={s.zones} greenhouses={s.greenhouse_count} />
          <TotalPlantsTile plants={s.plants} />
          <PlantConditionTile condition={s.plant_condition} />
        </div>
      ) : (
        <span className={styles.muted}>{describeError(summary.error)}</span>
      )}

      <div className={styles.row2}>
        <LefiSummaryCard summary={ai.data} ai={brain.data?.ai} focusZone={focusZone} />
        <ActiveAlertsCard alerts={alerts.data} allowed={can.alerts} brainTime={brain.brainTime} />
      </div>

      {s && s.condition_zones.length > 0 && (
        <CurrentConditionsCard zoneIds={s.condition_zones} connected={brain.connected} />
      )}

      <div className={styles.row2}>
        <PlantHealthTrendCard trend={health.data} />
        <EnvironmentTrendCard trend={env.data} />
      </div>

      <div className={styles.row3}>
        <PendingTasksCard tasks={tasks.data} allowed={can.tasks} />
        <RobotCard robots={robots.data} allowed={can.robots} />
        <ShiftActivityCard shift={shift.data} activity={activity.data} />
      </div>
    </>
  );
}
