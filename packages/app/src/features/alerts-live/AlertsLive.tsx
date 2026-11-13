import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import {
  alertKeys,
  alertQueries,
  alerts as api,
  type AlertItem,
  type AlertList,
  type AlertStatusFilter,
} from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { stamp, timeAgo } from '../../shared/lib/time';
import { toneVars } from '@lefi/ui';
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  Icon,
  ProvenanceBadge,
  SearchInput,
  Skeleton,
  ToggleGroup,
  useToast,
} from '../../shared/ui';
import { PhotoViewer } from '../live/CameraPanel';
import { useBrainNow } from '../live/common';
import { useCan } from '../session';
import { ReportDialog } from './ReportDialog';
import { RulesTab } from './RulesTab';
import { EVENT, EVENT_ICON, MONITOR, SEVERITY, SOURCE, STATUS, kindIcon } from './presentation';
import { AlertInsightPanel } from '../health-review';
import styles from './alerts.module.css';

type Tab = AlertStatusFilter | 'rules';

export function useAlertMutation<A, R>(fn: (a: A) => Promise<R>, ok?: (r: R) => string) {
  const qc = useQueryClient();
  const toast = useToast((t) => t.show);
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: alertKeys.all });
      if (ok) toast(ok(r), 'ok');
    },
    onError: (e) => {
      toast(describeError(e), 'bad');
      void qc.invalidateQueries({ queryKey: alertKeys.all });
    },
  });
}

/**
 * Alerts & Incidents against the real Lefi Brain (ADR-071). Alerts are raised and cleared by
 * Lefi Brain's rules engine from the facts it holds — contact with each device, each sensor's
 * data, values against ranges people set — after each condition has lasted; people report
 * incidents, acknowledge, assign, add notes and resolve. The screen only shows what Lefi Brain
 * says, with the reason for each alert.
 */
/** The route: an alert opened from a notification arrives as `?alert=<id>`. */
export function AlertsRoute() {
  const search = useSearch({ strict: false }) as { alert?: string };
  return <AlertsLive openAlert={search.alert} />;
}

export function AlertsLive({ openAlert }: { openAlert?: string } = {}) {
  const platform = usePlatform();
  const [tab, setTab] = useState<Tab>('active');
  const [reporting, setReporting] = useState(false);
  const canReport = useCan('incident.report');
  const list = useQuery({
    ...alertQueries.list(platform, tab === 'rules' ? 'active' : tab),
  });
  const tabs: Array<[Tab, string]> = [
    ['active', 'Active'],
    ['resolved', 'Resolved'],
    ['all', 'All'],
    ['rules', 'Rules'],
  ];
  return (
    <div className={styles.stack}>
      <div className={styles.tabBar}>
        <div className={styles.tabs} role="tablist" aria-label="Alerts">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
            >
              {label}
              {k === 'active' && list.data && list.data.counts.active > 0 && (
                <span className={styles.count}>{list.data.counts.active}</span>
              )}
            </button>
          ))}
        </div>
        {canReport && (
          <Button icon="report" onClick={() => setReporting(true)}>
            Report incident
          </Button>
        )}
      </div>
      {list.data && <MonitorBanner data={list.data} />}
      {tab === 'rules' ? (
        <RulesTab />
      ) : list.isError ? (
        <EmptyState mascot="sad" title="Could not load the alerts">
          {describeError(list.error)}
        </EmptyState>
      ) : !list.data ? (
        <Skeleton height={480} />
      ) : (
        <AlertsView data={list.data} tab={tab} open={openAlert} />
      )}
      <ReportDialog open={reporting} onClose={() => setReporting(false)} />
    </div>
  );
}

function MonitorBanner({ data }: { data: AlertList }) {
  const m = MONITOR[data.monitor.state] ?? MONITOR.starting!;
  if (data.monitor.state === 'watching') return null;
  return (
    <Banner tone={m.tone} icon="monitor_heart" title={m.title}>
      {data.monitor.reason}
    </Banner>
  );
}

type SevFilter = 'all' | 'critical' | 'warning';
type SourceFilter = 'all' | 'rule' | 'ai' | 'person';

function AlertsView({
  data,
  tab,
  open,
}: {
  data: AlertList;
  tab: AlertStatusFilter;
  open?: string;
}) {
  const now = useBrainNow();
  const [selected, setSelected] = useState<string | undefined>(open);
  const [seen, setSeen] = useState(open);
  const [q, setQ] = useState('');
  const [sev, setSev] = useState<SevFilter>('all');
  const [source, setSource] = useState<SourceFilter>('all');
  if (open !== seen) {
    setSeen(open);
    if (open) setSelected(open);
  }
  const needle = q.trim().toLowerCase();
  const rows = data.alerts.filter(
    (a) =>
      (sev === 'all' || a.severity === sev) &&
      (source === 'all' || a.source === source) &&
      (!needle ||
        [a.title, a.subject.label, a.number ?? '', a.detail].some((x) =>
          x.toLowerCase().includes(needle),
        )),
  );
  // The detail opens below the list when a person picks an alert (or one is opened from a
  // notification, even if it is not in this list), and the page scrolls down to it.
  const panelId = selected;
  const detail = useRef<HTMLDivElement>(null);
  const [opens, setOpens] = useState(0);
  useEffect(() => {
    if (panelId) detail.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [panelId, opens]);
  const pick = (id: string) => {
    setSelected(id);
    setOpens((n) => n + 1);
  };
  const c = data.counts;
  return (
    <>
      {tab === 'active' && (
        <div className={styles.kpis}>
          <Kpi icon="notifications_active" label="Active" value={c.active} tone="info" />
          <Kpi
            icon="error"
            label="Critical"
            value={c.critical}
            tone={c.critical ? 'crit' : 'off'}
          />
          <Kpi icon="warning" label="Warning" value={c.warning} tone={c.warning ? 'warn' : 'off'} />
          <Kpi
            icon="mark_email_unread"
            label="Not acknowledged"
            value={c.unacknowledged}
            tone={c.unacknowledged ? 'warn' : 'ok'}
          />
        </div>
      )}
      <div className={styles.layout}>
        <section className={styles.listCard} aria-label="Alerts">
          <div className={styles.filters}>
            <SearchInput
              placeholder="Search alerts, zones, INC numbers"
              aria-label="Search alerts"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <ToggleGroup<SevFilter>
              label="Severity"
              value={sev}
              onChange={setSev}
              options={[
                { value: 'all', label: 'All' },
                { value: 'critical', label: 'Critical', dot: toneVars('crit').dot },
                { value: 'warning', label: 'Warning', dot: toneVars('warn').dot },
              ]}
            />
            <ToggleGroup<SourceFilter>
              label="Source"
              value={source}
              onChange={setSource}
              options={[
                { value: 'all', label: 'Any source' },
                { value: 'rule', label: 'Rules' },
                { value: 'ai', label: 'Lefi AI' },
                { value: 'person', label: 'Reported' },
              ]}
            />
          </div>
          {rows.length === 0 ? (
            <EmptyState
              mascot="calm"
              title={
                tab === 'active' && !needle && sev === 'all' && source === 'all'
                  ? 'No active alerts'
                  : 'Nothing here'
              }
              compact
            >
              {tab === 'active' && !needle && sev === 'all' && source === 'all'
                ? 'Lefi Brain found nothing wrong with devices, sensors or the ranges.'
                : 'No alert matches.'}
            </EmptyState>
          ) : (
            <ul className={styles.list} aria-label="Alert list">
              {rows.map((a) => (
                <li key={a.id}>
                  <AlertCard
                    a={a}
                    now={now}
                    selected={a.id === panelId}
                    onOpen={() => pick(a.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
        <div ref={detail} className={styles.detailAnchor}>
          {panelId && (
            <AlertPanel
              key={panelId}
              id={panelId}
              data={data}
              onClose={() => setSelected(undefined)}
            />
          )}
        </div>
      </div>
    </>
  );
}

function Kpi({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: number;
  tone: 'crit' | 'warn' | 'ok' | 'info' | 'off';
}) {
  const t = toneVars(tone);
  return (
    <div className={styles.kpi}>
      <span className={styles.kpiIcon} style={{ background: t.bg, color: t.fg }}>
        <Icon name={icon} size={20} />
      </span>
      <div className={styles.kpiText}>
        <span>{label}</span>
        <b style={{ color: value ? t.fg : undefined }}>{value}</b>
      </div>
    </div>
  );
}

function AlertCard({
  a,
  now,
  selected,
  onOpen,
}: {
  a: AlertItem;
  now?: string;
  selected: boolean;
  onOpen: () => void;
}) {
  const sev = toneVars(SEVERITY[a.severity].tone);
  const resolved = a.status === 'resolved';
  return (
    <button
      type="button"
      className={styles.alertCard}
      aria-pressed={selected}
      data-resolved={resolved}
      style={{ borderLeftColor: resolved ? undefined : sev.dot }}
      onClick={onOpen}
    >
      <span className={styles.alertIcon} style={{ background: sev.bg, color: sev.fg }}>
        <Icon name={kindIcon(a.rule, a.source)} size={20} />
      </span>
      <span className={styles.alertBody}>
        <span className={styles.alertTitle}>{a.title}</span>
        <span className={styles.alertMeta}>
          {a.number && <span className={styles.mono}>{a.number}</span>}
          <span>{a.subject.label}</span>
          <span title={stamp(a.opened_at)}>
            {timeAgo(a.opened_at, now)}
            {a.occurrences > 1 && ` · ×${a.occurrences}`}
          </span>
        </span>
      </span>
      <span className={styles.alertSide}>
        <Badge tone={STATUS[a.status]!.tone} dot>
          {STATUS[a.status]!.label}
        </Badge>
        <span className={styles.sourceTag} data-source={a.source}>
          <Icon name={SOURCE[a.source].icon} size={13} />
          {SOURCE[a.source].label}
        </span>
        {a.origin === 'SIMULATED' && <ProvenanceBadge origin="SIMULATED" />}
      </span>
    </button>
  );
}

function AlertPanel({ id, data, onClose }: { id: string; data: AlertList; onClose: () => void }) {
  const platform = usePlatform();
  const now = useBrainNow();
  const q = useQuery(alertQueries.one(platform, id));
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string>();
  const ack = useAlertMutation(
    () => api.acknowledge(platform, id),
    () => 'Acknowledged.',
  );
  const assign = useAlertMutation(
    (user: string | null) => api.assign(platform, id, user),
    (a) => (a.assigned_to ? `Assigned to ${a.assigned_to}.` : 'Unassigned.'),
  );
  const addNote = useAlertMutation(
    () => api.note(platform, id, note),
    () => 'Note added.',
  );
  const resolve = useAlertMutation(
    () => api.resolve(platform, id, note || undefined),
    () => 'Resolved.',
  );
  if (q.isError) return <span className={styles.muted}>{describeError(q.error)}</span>;
  if (!q.data) return <Skeleton height={420} />;
  const a = q.data;
  const can = data.can;
  const blocked = a.source === 'rule' && a.condition_active;
  const sevTone = toneVars(SEVERITY[a.severity].tone);
  return (
    <aside className={styles.panel} aria-label="Alert details">
      <div className={styles.panelTop} style={{ background: sevTone.bg }}>
        <span className={styles.panelIcon} style={{ color: sevTone.fg }}>
          <Icon name={kindIcon(a.rule, a.source)} size={22} />
        </span>
        <div className={styles.panelHead}>
          <Badge tone={SEVERITY[a.severity].tone} dot>
            {SEVERITY[a.severity].label}
          </Badge>
          <Badge tone={STATUS[a.status]!.tone}>{STATUS[a.status]!.label}</Badge>
          {a.origin === 'SIMULATED' && <ProvenanceBadge origin="SIMULATED" />}
          {a.number && <span className={styles.mono}>{a.number}</span>}
        </div>
        <span className={styles.grow} />
        <Button size="sm" variant="ghost" icon="close" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className={styles.panelCols}>
        <div className={styles.panelCol}>
          <span className={styles.title}>{a.title}</span>
          <span className={styles.where}>
            <Icon name="location_on" size={15} />
            {a.subject.label}
            <span className={styles.sourceTag} data-source={a.source}>
              <Icon name={SOURCE[a.source].icon} size={13} />
              {a.source === 'rule'
                ? 'Raised by Lefi Brain’s rules'
                : a.source === 'ai'
                  ? 'Seen by Lefi AI in a photo · to be confirmed'
                  : `Reported by ${a.reported_by}`}
            </span>
          </span>
          <div className={styles.whyBox}>
            <span className={styles.label}>What happened</span>
            <p className={styles.why}>{a.detail}</p>
          </div>
          <dl className={styles.facts}>
            <div>
              <dt>Opened</dt>
              <dd>{stamp(a.opened_at)}</dd>
            </div>
            <div>
              <dt>{a.status === 'resolved' ? 'Resolved' : 'Condition'}</dt>
              <dd>
                {a.status === 'resolved'
                  ? `${a.resolved_at ? timeAgo(a.resolved_at, now) : ''} · ${a.resolved_by ?? ''}`
                  : a.source === 'rule'
                    ? a.condition_active
                      ? 'Still present'
                      : 'Gone'
                    : a.source === 'ai'
                      ? 'Lefi AI · to confirm on the photo'
                      : 'Reported by a person'}
              </dd>
            </div>
            {a.occurrences > 1 && (
              <div>
                <dt>Times</dt>
                <dd>{a.occurrences}</dd>
              </div>
            )}
            {a.acknowledged_by && (
              <div>
                <dt>Acknowledged by</dt>
                <dd>{a.acknowledged_by}</dd>
              </div>
            )}
          </dl>
          {a.source === 'ai' && typeof a.facts.photo_id === 'string' && (
            <span>
              <Button
                size="sm"
                variant="secondary"
                icon="image"
                onClick={() => setPhoto(String(a.facts.photo_id))}
              >
                Open the photo
              </Button>
            </span>
          )}
          <PhotoViewer photoId={photo} onClose={() => setPhoto(undefined)} />
          {a.resolution && <p className={styles.muted}>Resolution: {a.resolution}</p>}

          {a.status !== 'resolved' && (
            <div className={styles.block}>
              <span className={styles.label}>Respond</span>
              <div className={styles.actions}>
                {can.acknowledge && a.status === 'open' && (
                  <Button
                    icon="done"
                    disabled={ack.isPending}
                    onClick={() => ack.mutate(undefined)}
                  >
                    Acknowledge
                  </Button>
                )}
                {can.assign && (
                  <select
                    className={styles.select}
                    aria-label="Assign to"
                    value={a.assigned_to_id ?? ''}
                    onChange={(e) => assign.mutate(e.target.value || null)}
                  >
                    <option value="">Not assigned</option>
                    {data.people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
                {!can.assign && a.assigned_to && (
                  <span className={styles.muted}>Assigned to {a.assigned_to}</span>
                )}
              </div>
              <textarea
                className={styles.textarea}
                aria-label="Note"
                placeholder="What did you check or do?"
                rows={2}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className={styles.actions}>
                {can.report && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="edit_note"
                    disabled={!note.trim() || addNote.isPending}
                    onClick={() => addNote.mutate(undefined, { onSuccess: () => setNote('') })}
                  >
                    Add note
                  </Button>
                )}
                {can.resolve && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="task_alt"
                    disabled={blocked || resolve.isPending}
                    title={
                      blocked
                        ? 'The condition is still there: Lefi Brain resolves it by itself when it clears.'
                        : undefined
                    }
                    onClick={() => resolve.mutate(undefined, { onSuccess: () => setNote('') })}
                  >
                    Resolve
                  </Button>
                )}
              </div>
              {blocked && can.resolve && (
                <span className={styles.muted}>
                  Lefi Brain resolves this alert by itself when the condition clears.
                </span>
              )}
            </div>
          )}
        </div>
        <div className={styles.panelCol}>
          <div className={styles.block} data-first>
            <span className={styles.label}>Lefi AI</span>
            <AlertInsightPanel alertId={a.id} now={now} />
          </div>

          <div className={styles.block}>
            <span className={styles.label}>Timeline</span>
            <ol className={styles.timeline}>
              {a.events.map((e, i) => (
                <li key={i} className={styles.event}>
                  <span className={styles.eventDot}>
                    <Icon name={EVENT_ICON[e.kind] ?? 'circle'} size={14} />
                  </span>
                  <span className={styles.eventBody}>
                    <b>
                      {EVENT[e.kind] ?? e.kind}
                      {e.kind === 'assigned' && e.facts.to ? ` to ${String(e.facts.to)}` : ''}
                    </b>
                    <span className={styles.muted}>
                      {e.by} · {stamp(e.at)}
                    </span>
                    {e.note && <span className={styles.note}>{e.note}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </aside>
  );
}
