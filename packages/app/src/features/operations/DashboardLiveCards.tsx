import { useState } from 'react';
import type { Overview, OverviewTrends } from '@lefi/api';
import { mascots, toneVars, type Tone } from '@lefi/ui';
import { goTo, openAssistant } from '../../shared/lib/assistant';
import { describeError } from '../../shared/lib/errors';
import { clock, timeAgo } from '../../shared/lib/time';
import { variableIcon } from '../../shared/lib/variables';
import {
  Badge,
  Button,
  Card,
  Icon,
  Legend,
  LineChart,
  ListRow,
  ProvenanceBadge,
  RichText,
  Segmented,
  Skeleton,
  Sparkline,
} from '../../shared/ui';
import { IrrigationTile } from '../dashboard/SensorCard';
import {
  axisLabels,
  environmentPair,
  healthyShare,
  scaleOf,
  summaryText,
  timeTicks,
  valuesOf,
  type Value,
} from './dashboardModel';
import { AI_STATE, HEALTH } from './presentation';
import d from '../dashboard/dashboard.module.css';
import styles from './operations.module.css';

/** Hash routes (the app uses a hash history); works without a router in tests. */
const go = (path: string) => goTo(path);
const hhmm = (x: Date) => x.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const day = (x: Date) => x.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });

// --------------------------------------------------------------------------- Lefi summary

/**
 * The design's "Lefi operational summary". Lefi Brain cannot write AI summaries yet, so the text is
 * composed from the overview's facts and labelled as such — never shown as AI-generated.
 */
export function LefiSummaryCard({ o }: { o: Overview }) {
  const ai = AI_STATE[o.ai.state] ?? { label: o.ai.state, tone: 'off' as const };
  const aiOn = o.ai.state === 'available';
  return (
    <Card variant="accent" className={d.lefiCard}>
      <img src={aiOn ? mascots.happy : mascots.calm} alt="Lefi" className={d.lefiMascot} />
      <div className={d.lefiBody}>
        <div className={d.lefiHead}>
          <span className={d.lefiTitle}>Lefi operational summary</span>
          <Badge tone="info" variant="tag" title="Written from Lefi Brain's data, not by a model">
            From Lefi Brain data · {clock(o.brain_time)}
          </Badge>
        </div>
        <p className={d.lefiText}>
          <RichText text={summaryText(o)} />
        </p>
        <div className={d.lefiActions}>
          <Button size="sm" onClick={() => go('/devices')}>
            Open Devices &amp; Health
          </Button>
          {aiOn && (
            <Button size="sm" variant="secondary" onClick={openAssistant}>
              Ask Lefi
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => go('/plant-health')}>
            Review plant health
          </Button>
        </div>
        <span className={d.lefiNote}>
          Lefi AI:{' '}
          <Badge tone={ai.tone} dot>
            {ai.label}
          </Badge>{' '}
          {aiOn
            ? `${o.ai.model ?? ''} answers questions in the chat. AI-written summaries are not available yet.`
            : o.ai.reason}
        </span>
      </div>
    </Card>
  );
}

// --------------------------------------------------------------------------- alerts

const SEV_TONE: Record<string, Tone> = { critical: 'crit', warning: 'warn', info: 'info' };
const SUBJECT_ICON: Record<string, string> = {
  sensor: 'sensors',
  device: 'memory',
  broker: 'hub',
  plant: 'eco',
  zone: 'grid_view',
  system: 'warning',
};

export function ActiveAlertsCard({ o }: { o: Overview }) {
  const a = o.alerts;
  return (
    <Card
      title="Active alerts"
      subtitle={
        a.monitor_state === 'watching' ? 'From Lefi Brain’s rules and people' : a.monitor_reason
      }
      actions={
        a.critical > 0 ? (
          <Badge tone="crit">{a.critical} critical</Badge>
        ) : (
          <a href="#/alerts" className={d.cardLink}>
            {a.active === 0 ? 'None active' : 'View all'}
          </a>
        )
      }
    >
      {a.active === 0 && (
        <span className={d.muted}>Nothing wrong found with devices, sensors or value rules.</span>
      )}
      {a.latest.slice(0, 4).map((x) => (
        <ListRow
          key={String(x.id)}
          icon={SUBJECT_ICON[String(x.subject_kind)] ?? 'warning'}
          tone={SEV_TONE[String(x.severity)] ?? 'info'}
          title={
            <span className={styles.titleRow}>
              {String(x.title)}
              {x.origin === 'SIMULATED' && <ProvenanceBadge origin="SIMULATED" />}
            </span>
          }
          meta={`${String(x.subject)} · ${clock(String(x.opened_at ?? x.updated_at))}`}
          trailing={timeAgo(String(x.updated_at), o.brain_time)}
        />
      ))}
      {a.active > 4 && (
        <a href="#/alerts" className={d.cardLink}>
          {a.active - 4} more in Alerts &amp; Incidents
        </a>
      )}
    </Card>
  );
}

// --------------------------------------------------------------------------- current conditions

type Tile = { reading: Overview['readings'][number]; value: Value };

const NO_ZONE = '__none__';

export function CurrentConditionsCard({
  o,
  trends,
}: {
  o: Overview;
  trends: OverviewTrends | undefined;
}) {
  const names = new Map(o.zones.map((z) => [z.id, z.name]));
  const groups = new Map<string, Tile[]>();
  for (const r of o.readings)
    for (const v of valuesOf(r)) {
      const key = r.zone_id ?? NO_ZONE;
      groups.set(key, [...(groups.get(key) ?? []), { reading: r, value: v }]);
    }
  const keys = [...groups.keys()];
  const [selected, setSelected] = useState(keys[0] ?? '');
  const zone = keys.includes(selected) ? selected : (keys[0] ?? '');
  const spark = new Map(
    (trends?.sensors ?? []).map((s) => [`${s.sensor_id}:${s.variable}`, s.values]),
  );
  return (
    <Card
      title="Current conditions"
      subtitle="Live sensor readings · updated every 15 s · lines: last 2 h"
      actions={
        keys.length > 1 && (
          <Segmented
            label="Zone"
            value={zone}
            onChange={setSelected}
            options={keys.map((k) => ({
              value: k,
              label: k === NO_ZONE ? 'No zone' : (names.get(k) ?? 'Zone'),
            }))}
          />
        )
      }
    >
      {keys.length === 0 ? (
        <span className={d.muted}>
          No sensor enabled yet: add an ESP32 and enable its sensors in Devices &amp; Health.
        </span>
      ) : (
        <div className={d.sensorGrid}>
          {(groups.get(zone) ?? []).map((t) => (
            <ReadingTile
              key={`${t.reading.sensor_id}:${t.value.variable}`}
              tile={t}
              history={spark.get(`${t.reading.sensor_id}:${t.value.variable}`) ?? []}
            />
          ))}
          <IrrigationTile reason="Irrigation is interface only and disabled by design." />
        </div>
      )}
    </Card>
  );
}

const STATE_TAG: Record<string, 'LIVE' | 'STALE' | 'ERROR' | 'OFFLINE'> = {
  receiving: 'LIVE',
  not_receiving: 'STALE',
  error: 'ERROR',
};

function ReadingTile({ tile, history }: { tile: Tile; history: Array<number | null> }) {
  const { reading: r, value: v } = tile;
  const freshness = STATE_TAG[r.state] ?? 'OFFLINE';
  const status: { label: string; tone: Tone } =
    v.value === null
      ? r.state === 'error'
        ? { label: 'Cannot read', tone: 'crit' }
        : { label: 'No data', tone: 'off' }
      : v.in_range === false
        ? { label: 'Out of range', tone: 'crit' }
        : v.in_range
          ? { label: 'In range', tone: 'ok' }
          : { label: 'No range set', tone: 'off' };
  const tone = toneVars(status.tone);
  const line = status.tone === 'off' ? 'var(--lefi-green-400)' : tone.dot;
  const unit = v.unit ?? '';
  const range = v.range
    ? `${v.range.min ?? '…'}–${v.range.max ?? '…'} ${unit}`.trim()
    : (r.place ?? r.device);
  return (
    <div
      className={d.sensor}
      data-status={v.in_range === false ? 'CRITICAL' : undefined}
      title={`${r.sensor} · ${r.device}${v.range ? ` · range from the rule “${v.range.rule}”` : ''}`}
    >
      <div className={d.sensorHead}>
        <Icon name={variableIcon(v.variable)} size={20} color={tone.fg} />
        <ProvenanceBadge
          origin={r.origin === 'SIMULATED' ? 'SIMULATED' : 'LIVE'}
          freshness={freshness}
        />
      </div>
      <span className={d.sensorLabel}>{v.label}</span>
      <div className={d.sensorValue}>
        <span>{v.value === null ? '—' : v.value}</span>
        <span className={d.sensorUnit}>{unit}</span>
      </div>
      <Sparkline values={history.filter((x): x is number => x !== null)} color={line} />
      <div className={d.sensorFoot}>
        <span title={r.place ?? undefined}>{range}</span>
        <span style={{ color: tone.fg, fontWeight: 700 }}>{status.label}</span>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- trends

const C = { healthy: '#2E9A63', attention: '#F3DDA8', a: '#E07A3F', b: '#3C84C0' };

function TrendBody({
  trends,
  error,
  empty,
  children,
}: {
  trends: OverviewTrends | undefined;
  error: unknown;
  empty: boolean;
  children: React.ReactNode;
}) {
  if (!trends)
    return error ? (
      <span className={d.muted}>{describeError(error)}</span>
    ) : (
      <Skeleton height={200} radius={14} />
    );
  return empty ? <span className={d.muted}>{children}</span> : null;
}

export function PlantHealthTrendCard({
  trends,
  error,
}: {
  trends: OverviewTrends | undefined;
  error: unknown;
}) {
  const h = trends?.plant_health;
  const share = h ? healthyShare(h) : [];
  const attention = h ? h.watch.map((w, i) => w + (h.problem[i] ?? 0)) : [];
  const empty = !share.some(Number.isFinite);
  const most = Math.max(1, ...attention);
  return (
    <Card
      title="Plant health trend"
      subtitle="Recorded by people · last 30 days"
      actions={
        <Legend
          items={[
            { label: 'Healthy % of checked', color: C.healthy },
            { label: 'Watch + problem', color: C.attention, shape: 'block' },
          ]}
        />
      }
    >
      <TrendBody trends={trends} error={error} empty={empty}>
        No plant health recorded in the last 30 days. Record it in AI Plant Health.
      </TrendBody>
      {h && !empty && (
        <LineChart
          leftAxis={{ labels: ['100', '67', '33', '0'] }}
          xLabels={[0, 0.25, 0.5, 0.75, 1].map((f) =>
            day(new Date(h.days[Math.round(f * (h.days.length - 1))]!)),
          )}
          series={[
            { values: attention, color: C.attention, min: 0, max: most * 1.3, kind: 'bars' },
            { values: share, color: C.healthy, min: 0, max: 100, kind: 'area', endDot: true },
          ]}
        />
      )}
    </Card>
  );
}

export function EnvironmentTrendCard({
  trends,
  error,
}: {
  trends: OverviewTrends | undefined;
  error: unknown;
}) {
  const [a, b] = trends ? environmentPair(trends) : [];
  const nan = (v: Array<number | null>) => v.map((x) => (x === null ? Number.NaN : x));
  const sa = a ? scaleOf(a.values) : null;
  const sb = b ? scaleOf(b.values) : null;
  const sim = [a, b].some((e) => e?.origins.includes('SIMULATED'));
  const label = (e: NonNullable<typeof a>) => `${e.label}${e.unit ? ` ${e.unit}` : ''}`;
  return (
    <Card
      title={
        <span className={d.titleWithTag}>
          Environmental trends {sim && <ProvenanceBadge origin="SIMULATED" />}
        </span>
      }
      subtitle={
        a
          ? `Average of ${Math.max(a.sensors, b?.sensors ?? 0)} ${Math.max(a.sensors, b?.sensors ?? 0) === 1 ? 'sensor' : 'sensors'} · last 24 h`
          : 'Last 24 h'
      }
      actions={
        <Legend
          items={[
            ...(a ? [{ label: label(a), color: C.a }] : []),
            ...(b ? [{ label: label(b), color: C.b }] : []),
          ]}
        />
      }
    >
      <TrendBody trends={trends} error={error} empty={!sa}>
        No readings stored in the last 24 h.
      </TrendBody>
      {trends && a && sa && (
        <LineChart
          leftAxis={{ labels: axisLabels(sa), color: C.a }}
          {...(b && sb ? { rightAxis: { labels: axisLabels(sb), color: C.b } } : {})}
          xLabels={timeTicks(trends.day.since, trends.day.step_s, trends.day.count, hhmm)}
          series={[
            { values: nan(a.values), color: C.a, ...sa },
            ...(b && sb ? [{ values: nan(b.values), color: C.b, ...sb }] : []),
          ]}
        />
      )}
    </Card>
  );
}

// --------------------------------------------------------------------------- bottom row

/** Real follow-ups only: plants people flagged and inspections asked. Work orders do not exist yet. */
export function FollowUpsCard({ o }: { o: Overview }) {
  // Latest observation per plant (newest first): a plant flagged then healthy is not a follow-up.
  const latest = new Map<string, (typeof o.plant_health.recent)[number]>();
  for (const r of o.plant_health.recent)
    if (!latest.has(String(r.plant_id))) latest.set(String(r.plant_id), r);
  const flagged = [...latest.values()].filter((r) => r.health !== 'healthy');
  return (
    <Card
      title="Follow-ups"
      actions={
        <a href="#/plant-health" className={d.cardLink}>
          Plant health
        </a>
      }
    >
      {o.plant_health.open_requests > 0 && (
        <div className={d.taskRow}>
          <span className={d.taskDot} style={{ background: toneVars('warn').dot }} />
          <div className={d.taskText}>
            <span className={d.taskTitle}>
              {o.plant_health.open_requests}{' '}
              {o.plant_health.open_requests === 1 ? 'inspection' : 'inspections'} asked
            </span>
            <span className={d.taskMeta}>Waiting for someone to record the plant’s health</span>
          </div>
        </div>
      )}
      {flagged.map((r) => {
        const st = HEALTH[r.health as keyof typeof HEALTH];
        const t = toneVars(st?.tone ?? 'off');
        return (
          <div key={`${String(r.plant_id)}-${String(r.at)}`} className={d.taskRow}>
            <span className={d.taskDot} style={{ background: t.dot }} />
            <div className={d.taskText}>
              <span className={d.taskTitle}>Plant {String(r.plant)}</span>
              <span className={d.taskMeta}>
                {String(r.by)} · {timeAgo(String(r.at), o.brain_time)}
              </span>
            </div>
            <span className={d.taskPriority} style={{ background: t.bg, color: t.fg }}>
              {st?.label ?? String(r.health)}
            </span>
          </div>
        );
      })}
      {flagged.length === 0 && o.plant_health.open_requests === 0 && (
        <span className={d.muted}>No plant flagged and no inspection asked.</span>
      )}
      <span className={d.muted}>Tasks &amp; work orders are not available yet.</span>
    </Card>
  );
}

export function RobotsCard() {
  return (
    <Card title="Robot availability">
      <div className={d.robot}>
        <img src={mascots.sleeping} alt="" className={d.robotMascot} />
        <div className={d.robotText}>
          <span className={d.robotName}>No robot connected</span>
          <span className={d.robotMode} style={{ color: 'var(--lefi-off-fg)' }}>
            <span className={d.robotDot} style={{ background: 'var(--lefi-off-dot)' }} />
            Not available yet
          </span>
        </div>
      </div>
      <span className={d.muted}>
        Robotics (MH3 in simulation) is planned. Lefi Brain has no robot or mission to show.
      </span>
    </Card>
  );
}

/** Who is signed in and what people recorded. Shifts do not exist yet. */
export function TeamActivityCard({ o }: { o: Overview }) {
  return (
    <Card
      title="Team activity"
      actions={<span className={d.muted}>{o.people.active_users} active accounts</span>}
    >
      <div className={d.crew}>
        <Icon name="group" size={22} color="var(--lefi-green-600)" />
        <span className={d.crewCount}>{o.people.signed_in_now} signed in now</span>
      </div>
      {o.plant_health.recent.length === 0 && (
        <span className={d.muted}>No activity recorded yet.</span>
      )}
      {o.plant_health.recent.slice(0, 4).map((r) => (
        <div key={`${String(r.plant_id)}-${String(r.at)}`} className={d.activityRow}>
          <span className={d.activityTime}>{clock(String(r.at))}</span>
          <span>
            <b>{String(r.by)}</b> recorded plant {String(r.plant)} as{' '}
            {(HEALTH[r.health as keyof typeof HEALTH]?.label ?? String(r.health)).toLowerCase()}
          </span>
        </div>
      ))}
      <span className={d.muted}>Shifts and handover are not available yet.</span>
    </Card>
  );
}
