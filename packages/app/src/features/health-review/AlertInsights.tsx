import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { insightKeys, insightQueries, insightsApi, type AlertInsight } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { timeAgo } from '../../shared/lib/time';
import { Badge, Button, Icon, ProvenanceBadge, Skeleton, useToast } from '../../shared/ui';
import { useCan } from '../session';
import styles from './review.module.css';

const SEVERITY_TONE = { critical: 'crit', warning: 'warn', info: 'info' } as const;

function useAskAgain() {
  const platform = usePlatform();
  const qc = useQueryClient();
  const toast = useToast((t) => t.show);
  return useMutation({
    mutationFn: (alertId: string) => insightsApi.ask(platform, alertId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: insightKeys.all });
      toast('Lefi AI is analysing the alert again with the facts of now', 'ok');
    },
    onError: (e) => toast(describeError(e), 'bad'),
  });
}

/**
 * Lefi AI's analysis of one alert (ADR-092): an orientative diagnosis, possible causes,
 * recommendations, corrective actions for people and the role it suggests. Written from the facts
 * Lefi Brain holds; labelled "to check"; it never decides, assigns or moves anything (the tasks
 * shown are the ones Lefi Brain's rules made).
 */
export function InsightCard({
  insight: i,
  now,
  showAlert = true,
}: {
  insight: AlertInsight;
  now?: string;
  showAlert?: boolean;
}) {
  const again = useAskAgain();
  return (
    <article className={styles.insight} aria-label={`Lefi AI analysis: ${i.alert_title}`}>
      <header className={styles.head}>
        <div className={styles.title}>
          <Icon name="auto_awesome" size={18} />
          {showAlert ? <b>{i.alert_title}</b> : <b>Lefi AI’s analysis</b>}
          {showAlert && (
            <Badge tone={SEVERITY_TONE[i.alert_severity as keyof typeof SEVERITY_TONE] ?? 'info'}>
              {i.alert_severity}
            </Badge>
          )}
          <ProvenanceBadge origin={i.origin as 'LIVE' | 'SIMULATED'} />
        </div>
        <div className={styles.actions}>
          <span className={styles.faint}>
            {i.ai_at ? `Written ${timeAgo(i.ai_at, now)}` : `Asked ${timeAgo(i.created_at, now)}`}
            {i.model ? ` · ${i.model}` : ''}
          </span>
          <Button
            size="sm"
            variant="ghost"
            icon="refresh"
            disabled={again.isPending || i.status === 'pending'}
            onClick={() => again.mutate(i.alert_id)}
          >
            Analyse again
          </Button>
        </div>
      </header>
      {i.status === 'pending' ? (
        <span className={styles.muted}>Lefi AI is analysing this alert…</span>
      ) : i.status !== 'done' ? (
        <span className={styles.muted}>
          Lefi AI’s analysis is not available
          {i.status === 'invalid' ? ' (its answer did not fit and is not shown)' : ''}
          {i.error ? `: ${i.error}` : ''}
        </span>
      ) : (
        <>
          <span className={styles.label}>
            Orientative diagnosis · Lefi AI · from Lefi Brain’s facts, to check
          </span>
          <p className={styles.diagnosis}>{i.diagnosis}</p>
          <div className={styles.insightGrid}>
            <List title="Possible causes" items={i.causes} />
            <List title="Recommendations" items={i.recommendations} />
            <List title="Corrective actions (by people)" items={i.actions} />
          </div>
          {i.role && (
            <span className={styles.muted}>
              <Icon name="badge" size={14} /> Who should attend it, per Lefi AI:{' '}
              <b>{i.role_label ?? i.role}</b>
            </span>
          )}
        </>
      )}
      {i.tasks.length > 0 && (
        <div className={styles.recs}>
          <span className={styles.label}>Tasks Lefi Brain made for this alert</span>
          <ul>
            {i.tasks.map((t) => (
              <li key={t.title + t.status}>
                {t.title} · {t.for_role ? `for ${t.for_role}` : 'robot'} ·{' '}
                {t.assigned ? 'assigned' : t.for_role ? 'waiting for a person' : 'waiting'} ·{' '}
                {t.status.replace('_', ' ')}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className={styles.recs}>
      <span className={styles.label}>{title}</span>
      <ul>
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

/** Lefi AI's analysis of one alert (Alerts & Incidents, Tasks). Needs `nav.alerts`. */
export function AlertInsightPanel({ alertId, now }: { alertId: string; now?: string }) {
  const platform = usePlatform();
  const allowed = useCan('nav.alerts');
  const q = useQuery({ ...insightQueries.latest(platform, { alertId }), enabled: allowed });
  const again = useAskAgain();
  if (!allowed) return null;
  if (!q.data) return <Skeleton height={60} />;
  const [i] = q.data.insights;
  if (!i)
    return (
      <div className={styles.insight}>
        <span className={styles.muted}>Lefi AI has not analysed this alert.</span>
        <div>
          <Button
            size="sm"
            icon="auto_awesome"
            disabled={again.isPending}
            onClick={() => again.mutate(alertId)}
          >
            Ask Lefi AI
          </Button>
        </div>
      </div>
    );
  return <InsightCard insight={i} now={now ?? q.data.brain_time} showAlert={false} />;
}

/** Lefi AI's analyses of a zone's alerts, newest first (Greenhouses & Crops → zone). */
export function ZoneInsights({ zoneId, now }: { zoneId: string; now?: string }) {
  const platform = usePlatform();
  const allowed = useCan('nav.alerts');
  const q = useQuery({ ...insightQueries.latest(platform, { zoneId }), enabled: allowed });
  if (!allowed) return null;
  if (!q.data) return <Skeleton height={60} />;
  const shown = q.data.insights.slice(0, 5);
  if (shown.length === 0)
    return (
      <span className={styles.muted}>
        No alert of this zone has been analysed by Lefi AI yet. Lefi Brain asks it when an alert
        opens, comes back or becomes critical.
      </span>
    );
  return (
    <div className={styles.insights}>
      {shown.map((i) => (
        <InsightCard key={i.id} insight={i} now={now ?? q.data.brain_time} />
      ))}
    </div>
  );
}
