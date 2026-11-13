import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { operationsQueries, type EnvironmentRange, type EnvironmentView } from '@lefi/api';
import { mascots, toneVars, type Freshness, type Tone } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { goTo } from '../../shared/lib/assistant';
import { describeError } from '../../shared/lib/errors';
import { timeAgo } from '../../shared/lib/time';
import { variableIcon } from '../../shared/lib/variables';
import {
  Button,
  Card,
  EmptyState,
  Icon,
  LineChart,
  ProvenanceBadge,
  Segmented,
  Skeleton,
  ToggleGroup,
} from '../../shared/ui';
import { screenPath } from '../../app/screenPath';
import styles from './environment.module.css';

type Value = EnvironmentView['values'][number];
type Series = EnvironmentView['series'][number];
type Zone = EnvironmentView['zones'][number];

const RANGES: Array<{ value: EnvironmentRange; label: string }> = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
];

const hms = (iso: string) => new Date(iso).toLocaleTimeString('en-GB');
const freshness = (state: string): Freshness =>
  state === 'receiving' ? 'LIVE' : state === 'error' ? 'ERROR' : 'OFFLINE';
const zoneTone = (z: Zone): Tone =>
  z.alerts_critical ? 'crit' : z.alerts_warning ? 'warn' : z.sensors ? 'ok' : 'off';
const fmt = (v: number | null | undefined, unit?: string | null) =>
  v === null || v === undefined ? '—' : `${Number(v.toFixed(2))}${unit ? ` ${unit}` : ''}`;

/**
 * Environmental Monitoring against the real Lefi Brain (ADR-084), in the design's layout: zone
 * chips, one card per sensor value, the zone's history with the range people set, its sensors and
 * the ranges that apply. Nothing is estimated; irrigation is shown as not available (ADR-004).
 */
export function EnvironmentLive() {
  const platform = usePlatform();
  const [zoneId, setZoneId] = useState<string>();
  const [range, setRange] = useState<EnvironmentRange>('24h');
  const [variable, setVariable] = useState<string>();
  const q = useQuery({
    ...operationsQueries.environment(platform, zoneId, range),
    placeholderData: (prev) => prev,
  });

  if (q.isError)
    return (
      <EmptyState mascot="sad" title="Could not load environmental monitoring">
        {describeError(q.error)}
      </EmptyState>
    );
  if (!q.data) return <Skeleton height={520} />;
  const e = q.data;
  if (!e.zone_id)
    return (
      <EmptyState mascot="curious" title="No zones yet">
        Create a greenhouse and its zones in Greenhouses &amp; Crops, then give a device zones and
        enable its sensors.
      </EmptyState>
    );
  const zone = e.zones.find((z) => z.id === e.zone_id)!;
  const live = e.values.filter((v) => v.state === 'receiving' && v.origin === 'LIVE').length;
  const sim = e.values.filter((v) => v.state === 'receiving' && v.origin === 'SIMULATED').length;
  const off = e.values.filter((v) => v.state !== 'receiving').length;
  // Cards only for values Lefi Brain has now; sensors without data stay in Device connectivity.
  const withData = e.values.filter((v) => v.value !== null);
  const shown =
    e.series.find((s) => s.variable === variable) ??
    e.series.find((s) => withData.some((v) => v.variable === s.variable)) ??
    e.series[0];

  return (
    <>
      <div className={styles.toolbar}>
        <ToggleGroup
          label="Zone"
          value={zone.id}
          onChange={(id) => {
            setZoneId(id);
            setVariable(undefined);
          }}
          options={e.zones.map((z) => ({
            value: z.id,
            label: z.code ?? z.name,
            dot: toneVars(zoneTone(z)).dot,
          }))}
        />
        <div className={styles.legend}>
          <span>
            <i style={{ background: 'var(--lefi-ok-dot)' }} />
            {live} live
          </span>
          <span>
            <i style={{ background: 'var(--lefi-sim-dot)' }} />
            {sim} simulated
          </span>
          <span>
            <i style={{ background: 'var(--lefi-off-dot)' }} />
            {off} unavailable
          </span>
        </div>
      </div>

      {e.values.length === 0 ? (
        <EmptyState mascot="sleeping" title={`No sensor measures in ${zone.name} yet`}>
          In Devices &amp; Health, give a device this zone and enable its sensors here.
        </EmptyState>
      ) : withData.length === 0 ? (
        <p className={styles.muted}>
          No sensor in {zone.name} has current data ({off} without data): see Device connectivity.
        </p>
      ) : (
        <div className={styles.cards}>
          {withData.map((v) => (
            <ValueCard
              key={`${v.sensor_id}:${v.variable}`}
              v={v}
              selected={shown?.variable === v.variable}
              twin={withData.filter((x) => x.variable === v.variable).length > 1}
              brainTime={e.brain_time}
              onSelect={() => setVariable(v.variable)}
            />
          ))}
        </div>
      )}

      <div className={styles.main}>
        {shown ? (
          <HistoryLive zone={zone} s={shown} window={e.window} onRange={setRange} />
        ) : (
          <Card title="History">
            <span className={styles.muted}>No sensor history in this zone.</span>
          </Card>
        )}
        <div className={styles.sideCol}>
          <Card className={styles.side}>
            <div className={styles.sideHead}>
              <span className={styles.sideTitle}>Irrigation</span>
            </div>
            <div className={styles.pump}>
              <span className={styles.pumpIcon}>
                <Icon name="water_pump" size={24} />
              </span>
              <div className={styles.pumpText}>
                <b>Not available</b>
                <span>{e.irrigation.reason}</span>
              </div>
            </div>
          </Card>
          <Card title="Device connectivity" className={styles.side}>
            {e.values.length === 0 && <span className={styles.muted}>No sensor in this zone.</span>}
            {sensorsOf(e.values).map((v) => (
              <div key={v.sensor_id} className={styles.connRow}>
                <span
                  className={styles.dot}
                  style={{
                    background:
                      v.state !== 'receiving'
                        ? 'var(--lefi-off-dot)'
                        : v.origin === 'SIMULATED'
                          ? 'var(--lefi-sim-dot)'
                          : 'var(--lefi-ok-dot)',
                  }}
                />
                <div className={styles.connText}>
                  <span className={styles.mono}>{v.sensor_id}</span>
                  <span className={styles.muted}>
                    {v.sensor} · {v.device}
                    {v.received_at
                      ? ` · ${hms(v.received_at)} · ${timeAgo(v.received_at, e.brain_time)}`
                      : ' · never reported'}
                  </span>
                </div>
                <ProvenanceBadge
                  origin={v.origin as 'LIVE' | 'SIMULATED'}
                  freshness={freshness(v.state)}
                />
              </div>
            ))}
          </Card>
        </div>
      </div>

      {shown && (
        <OtherCharts
          series={e.series.filter((s) => s.variable !== shown.variable)}
          window={e.window}
          onSelect={setVariable}
        />
      )}

      <ZoneRanges e={e} zone={zone} />
    </>
  );
}

type Crop = NonNullable<EnvironmentView['crops']>[number];

const KNOWLEDGE: Record<Crop['knowledge'], string> = {
  ranges: 'Its species’ values apply here.',
  no_parameters:
    'Its published profile has no parameters yet: no species range applies. Values typed for one plant only apply to that plant — copy them to the species’ profile.',
  no_profile: 'No profile for this crop yet in the AI Knowledge Center.',
  draft_only:
    'Its profile is being prepared (draft or in review): nothing applies until it is published.',
  several_profiles: 'Several published profiles exist for this crop: none is chosen.',
};

const fmtRange = (r: Array<number | null>) =>
  r[0] == null && r[1] == null ? '—' : `${r[0] ?? '…'} – ${r[1] ?? '…'}`;

const knowledgeLink = (profileId?: string | null) =>
  goTo(
    profileId
      ? `${screenPath('knowledge')}?section=parameters&profile=${encodeURIComponent(profileId)}`
      : screenPath('knowledge'),
  );

/**
 * The ranges of this zone (ADR-097): the species growing here (from its published profile in
 * the AI Knowledge Center) and, apart, the alert rules people set. Each crop says why its species
 * does or does not give a range.
 */
function ZoneRanges({ e, zone }: { e: EnvironmentView; zone: Zone }) {
  const crops = e.crops ?? [];
  const ranges = e.crop_ranges ?? [];
  const issues = crops.filter((c) => c.knowledge !== 'ranges');
  return (
    <section className={styles.ranges}>
      <div className={styles.rangesHead}>
        <div className={styles.rangesTitle}>
          <span>Ranges for {zone.name}</span>
          <span className={styles.muted}>
            The species growing here, from the AI Knowledge Center · a person’s alert rule wins when
            there is one
          </span>
        </div>
        <div className={styles.rangeActions}>
          <Button
            variant="secondary"
            icon="menu_book"
            onClick={() => knowledgeLink(crops.find((c) => c.profile_id)?.profile_id)}
          >
            Species ranges
          </Button>
          {e.can_configure && (
            <Button variant="ghost" icon="tune" onClick={() => goTo(screenPath('alerts'))}>
              Alert rules
            </Button>
          )}
        </div>
      </div>

      {crops.length === 0 ? (
        <p className={styles.muted}>
          No crop grows in {zone.name}: register its plants or start a crop batch in Greenhouses
          &amp; Crops, and its species’ ranges will apply here.
        </p>
      ) : (
        <div className={styles.cropChips}>
          {crops.map((c) => (
            <div
              key={c.crop_type_id}
              className={styles.cropChip}
              data-ok={c.knowledge === 'ranges'}
            >
              <Icon name={c.knowledge === 'ranges' ? 'eco' : 'info'} size={18} />
              <div className={styles.cropText}>
                <b>
                  {c.crop}
                  <span className={styles.muted}>
                    {' '}
                    · {c.batch ? 'crop batch' : `${c.plants ?? 0} registered plants`}
                    {c.profile ? ` · ${c.profile}` : ''}
                  </span>
                </b>
                <span className={styles.muted}>{KNOWLEDGE[c.knowledge]}</span>
              </div>
              {c.knowledge !== 'ranges' && e.can_edit_knowledge && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => knowledgeLink(c.draft_id ?? c.profile_id)}
                >
                  Open profile
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {ranges.length > 0 && (
        <div className={styles.rangesGrid} role="table" aria-label="Species ranges">
          <div role="row" className={styles.speciesHeader}>
            <span>Measurement</span>
            <span>Optimal</span>
            <span>Warning</span>
            <span>Critical</span>
            <span>Trust</span>
          </div>
          {ranges.map((r) => (
            <div role="row" key={r.crop + r.measurement} className={styles.speciesRow}>
              <span className={styles.strong}>
                {r.label} <span className={styles.muted}>· {r.crop}</span>
              </span>
              <span className={styles.mono}>
                {fmtRange(r.optimal)} {r.unit}
              </span>
              <span className={styles.mono}>{fmtRange(r.warning)}</span>
              <span className={styles.mono}>{fmtRange(r.critical)}</span>
              <span className={styles.muted}>{r.verification}</span>
            </div>
          ))}
        </div>
      )}
      {ranges.length === 0 && issues.length === 0 && crops.length > 0 && (
        <p className={styles.muted}>No species range applies here yet.</p>
      )}

      <div className={styles.rangesTitle}>
        <span className={styles.subTitle}>Alert rules people set</span>
      </div>
      <div className={styles.rangesGrid} role="table" aria-label="Operating ranges">
        <div role="row" className={styles.rangesHeader}>
          <span>Measurement</span>
          <span>Minimum</span>
          <span>Maximum</span>
          <span>Unit</span>
        </div>
        {e.rules.map((r) => (
          <div role="row" key={r.id} className={styles.rangesRow}>
            <span className={styles.strong}>
              {r.label}{' '}
              <span className={styles.muted}>
                ·{' '}
                {r.applies_to === 'all'
                  ? 'all zones'
                  : r.applies_to === 'zone'
                    ? 'this zone'
                    : `sensor ${r.target_id}`}
              </span>
            </span>
            <span className={styles.mono}>{r.min ?? '—'}</span>
            <span className={styles.mono}>{r.max ?? '—'}</span>
            <span className={styles.muted}>{r.unit ?? ''}</span>
          </div>
        ))}
        {e.rules.length === 0 && (
          <div role="row" className={styles.rangesRow}>
            <span className={styles.muted}>
              None — the species’ ranges above are used. A rule is only needed to override them for
              this zone (Alerts &amp; Incidents → Rules).
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

/** One row per sensor (a sensor may give several values). */
function sensorsOf(values: Value[]): Value[] {
  const seen = new Map<string, Value>();
  for (const v of values) if (!seen.has(v.sensor_id)) seen.set(v.sensor_id, v);
  return [...seen.values()];
}

export function ValueCard({
  v,
  selected,
  twin,
  brainTime,
  onSelect,
}: {
  v: Value;
  selected: boolean;
  twin: boolean;
  brainTime: string;
  onSelect: () => void;
}) {
  const fresh = freshness(v.state);
  const tone: Tone =
    v.value === null ? 'off' : v.in_range === false ? 'warn' : v.in_range ? 'ok' : 'info';
  const status =
    v.value === null
      ? v.state === 'error'
        ? 'Sensor error'
        : 'No data'
      : v.in_range === false
        ? 'Outside the range'
        : v.in_range
          ? 'In range'
          : 'No range set';
  const t = toneVars(tone);
  return (
    <button
      type="button"
      className={styles.card}
      aria-pressed={selected}
      data-critical={false}
      onClick={onSelect}
    >
      <div className={styles.cardHead}>
        <Icon name={variableIcon(v.variable)} size={20} color={t.fg} />
        <ProvenanceBadge origin={v.origin as 'LIVE' | 'SIMULATED'} freshness={fresh} />
      </div>
      <span className={styles.cardLabel}>
        {v.label}
        {twin ? ` · ${v.place ?? v.sensor}` : ''}
      </span>
      <div className={styles.cardValue}>
        <span>{v.value === null ? '—' : v.value}</span>
        <span className={styles.unit}>{v.unit}</span>
      </div>
      <span className={styles.cardStatus} style={{ color: t.fg }}>
        {status}
      </span>
      <span className={styles.cardLast}>
        {v.received_at
          ? `${hms(v.received_at)} · ${timeAgo(v.received_at, brainTime)}`
          : 'Never reported'}
      </span>
    </button>
  );
}

const TICK: Record<EnvironmentRange, (d: Date) => string> = {
  '24h': (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
  '7d': (d) => d.toLocaleDateString('en-CA', { weekday: 'short', day: 'numeric' }),
  '30d': (d) => d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }),
};

/** What a chart of one series needs: gaps as NaN, the scale (with the range), ticks and band. */
function chartOf(s: Series, w: EnvironmentView['window']) {
  const values = s.values.map((v) => (v === null ? NaN : v));
  const known = values.filter(Number.isFinite);
  let lo = Math.min(...known, s.range?.min ?? Infinity);
  let hi = Math.max(...known, s.range?.max ?? -Infinity);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) [lo, hi] = [0, 1];
  const pad = (hi - lo || 1) * 0.15;
  lo -= pad;
  hi += pad;
  const start = new Date(w.since).getTime();
  const end = start + w.step_s * w.count * 1000;
  const xLabels = [0, 0.25, 0.5, 0.75, 1].map((f) =>
    TICK[w.range](new Date(start + f * (end - start))),
  );
  const band =
    s.range && s.range.min !== null && s.range.max !== null
      ? { from: s.range.min, to: s.range.max, color: '#54B985' }
      : undefined;
  const color = s.origins.includes('SIMULATED') ? 'var(--lefi-sim-dot)' : '#2E9A63';
  return { values, known, lo, hi, xLabels, band, color };
}

/** Every other measurement of the zone as a small chart; selecting one makes it the main chart. */
export function OtherCharts({
  series,
  window: w,
  onSelect,
}: {
  series: Series[];
  window: EnvironmentView['window'];
  onSelect: (variable: string) => void;
}) {
  if (series.length === 0) return null;
  return (
    <div className={styles.miniGrid}>
      {series.map((s) => {
        const c = chartOf(s, w);
        return (
          <button
            key={s.variable}
            type="button"
            className={styles.miniCard}
            aria-label={`Show ${s.label} history`}
            onClick={() => onSelect(s.variable)}
          >
            <div className={styles.miniHead}>
              <span className={styles.strong}>
                <Icon name={variableIcon(s.variable)} size={18} /> {s.label}
              </span>
              <span className={styles.muted}>{fmt(s.stats.current, s.unit)}</span>
            </div>
            {c.known.length === 0 ? (
              <span className={styles.muted}>No readings in this period.</span>
            ) : (
              <>
                <LineChart
                  height={90}
                  xLabels={[c.xLabels[0]!, c.xLabels[4]!]}
                  band={c.band}
                  series={[
                    { values: c.values, color: c.color, min: c.lo, max: c.hi, kind: 'area' },
                  ]}
                />
                <span className={styles.muted}>
                  Avg {fmt(s.stats.average)} · Min {fmt(s.stats.min)} · Max {fmt(s.stats.max)}
                  {s.unit ? ` ${s.unit}` : ''}
                  {s.stats.time_in_range !== null
                    ? ` · ${Math.round(s.stats.time_in_range * 100)} % in range`
                    : ''}
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

function HistoryLive({
  zone,
  s,
  window: w,
  onRange,
}: {
  zone: Zone;
  s: Series;
  window: EnvironmentView['window'];
  onRange: (r: EnvironmentRange) => void;
}) {
  const { values, known, lo, hi, xLabels, band, color } = chartOf(s, w);
  const st = s.stats;
  return (
    <Card
      title={`${s.label} · ${zone.code ?? zone.name}`}
      subtitle={`${zone.greenhouse} · ${zone.name}${
        s.range
          ? ` · shaded band = range ${fmt(s.range.min)}–${fmt(s.range.max)} ${s.unit ?? ''}`
          : ' · no range set'
      }${s.sensors > 1 ? ` · average of ${s.sensors} sensors` : ''}`}
      actions={<Segmented label="Period" value={w.range} onChange={onRange} options={RANGES} />}
    >
      {known.length === 0 ? (
        <div className={styles.unavailable}>
          <img src={mascots.sleeping} alt="" />
          <span className={styles.unavailableTitle}>No readings in this period</span>
          <span className={styles.muted}>Nothing is drawn rather than an invented line.</span>
        </div>
      ) : (
        <>
          <LineChart
            height={220}
            leftAxis={{
              labels: [hi, hi - (hi - lo) / 3, lo + (hi - lo) / 3, lo].map((v) => v.toFixed(1)),
            }}
            xLabels={xLabels}
            band={band}
            series={[
              {
                values,
                color,
                min: lo,
                max: hi,
                kind: 'area',
              },
            ]}
          />
          <div className={styles.stats}>
            <Stat k="Current" v={fmt(st.current)} />
            <Stat k="Average" v={fmt(st.average)} />
            <Stat k="Min" v={fmt(st.min)} />
            <Stat k="Max" v={fmt(st.max)} />
            <Stat
              k="Time in range"
              v={st.time_in_range === null ? '—' : `${Math.round(st.time_in_range * 100)} %`}
            />
          </div>
        </>
      )}
    </Card>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className={styles.stat}>
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}
