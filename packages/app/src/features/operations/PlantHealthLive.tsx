import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  operations,
  operationsKeys,
  operationsQueries,
  type PlantHealthRow,
  type PlantHealthState,
  type PlantIssue,
} from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { stamp, timeAgo } from '../../shared/lib/time';
import {
  Badge,
  Banner,
  Button,
  DataTable,
  EmptyState,
  KpiRow,
  KpiTile,
  SearchInput,
  Select,
  Skeleton,
  useToast,
  type Column,
} from '../../shared/ui';
import { useBrainNow } from '../live/common';
import { ZoneReviewsSection } from '../health-review';
import { HEALTH, ISSUE } from './presentation';
import styles from './operations.module.css';

function useOpsMutation<A, R>(fn: (a: A) => Promise<R>, ok: (r: R) => string) {
  const qc = useQueryClient();
  const toast = useToast((t) => t.show);
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: operationsKeys.all });
      toast(ok(r), 'ok');
    },
    onError: (e) => toast(describeError(e), 'bad'),
  });
}

export function HealthBadge({ health }: { health: PlantHealthState | null | undefined }) {
  if (!health) return <Badge tone="off">Not checked</Badge>;
  const h = HEALTH[health];
  return (
    <Badge tone={h.tone} dot title={h.hint}>
      {h.label}
    </Badge>
  );
}

/**
 * AI Plant Health against the real Lefi Brain (ADR-070). Lefi Brain has no camera images and no
 * vision model, so it detects nothing by itself and says so at the top. What is real: the health
 * of every plant as people recorded it, its history, and requests for someone to inspect a plant.
 */
export function PlantHealthLive() {
  const platform = usePlatform();
  const now = useBrainNow();
  const q = useQuery(operationsQueries.plantHealth(platform));
  const [search, setSearch] = useState('');
  const [zone, setZone] = useState('all');
  const [health, setHealth] = useState('all');
  const [selected, setSelected] = useState<string>();
  if (q.isError)
    return (
      <EmptyState mascot="sad" title="Could not load plant health">
        {describeError(q.error)}
      </EmptyState>
    );
  if (!q.data) return <Skeleton height={520} />;
  const p = q.data;
  const zones = [...new Map(p.plants.map((r) => [r.zone_id, r.zone])).entries()];
  const needle = search.trim().toLowerCase();
  const rows = p.plants.filter(
    (r) =>
      (zone === 'all' || r.zone_id === zone) &&
      (health === 'all' ||
        (health === 'none' ? !r.latest : r.latest?.health === health) ||
        (health === 'requested' && r.open_request)) &&
      (!needle || [r.code, r.name ?? '', r.crop].some((t) => t.toLowerCase().includes(needle))),
  );
  const current = p.plants.find((r) => r.plant_id === selected) ?? rows[0];
  const columns: Column<PlantHealthRow>[] = [
    {
      key: 'plant',
      header: 'Plant',
      width: 'minmax(170px, 1.4fr)',
      render: (r) => (
        <span className={styles.who}>
          <b>{r.code}</b>
          <span className={styles.muted}>
            {r.name ? `${r.name} · ` : ''}
            {r.crop}
          </span>
        </span>
      ),
    },
    { key: 'zone', header: 'Zone', width: '1fr', render: (r) => r.zone },
    {
      key: 'health',
      header: 'Health',
      width: '150px',
      render: (r) => (
        <span className={styles.badges}>
          <HealthBadge health={r.latest?.health} />
          {r.open_request && <Badge tone="info">Inspection asked</Badge>}
        </span>
      ),
    },
    {
      key: 'checked',
      header: 'Last checked',
      width: '150px',
      render: (r) => (
        <span className={styles.muted}>
          {r.latest ? `${timeAgo(r.latest.observed_at, now)} · ${r.latest.observed_by}` : 'never'}
        </span>
      ),
    },
  ];
  return (
    <div className={styles.stack}>
      <ZoneReviewsSection />
      <Banner tone="info" icon="visibility_off" title="AI vision per plant is not available">
        {p.vision.reason}
      </Banner>
      <KpiRow min={150}>
        <KpiTile label="Plants" value={p.counts.plants} />
        <KpiTile label="Healthy" value={p.counts.healthy} />
        <KpiTile label="Watch" value={p.counts.watch} />
        <KpiTile label="Problem" value={p.counts.problem} />
        <KpiTile label="Not checked" value={p.counts.not_checked} />
        <KpiTile label="Inspections asked" value={p.counts.open_requests} />
      </KpiRow>
      <div className={styles.layout}>
        <section className={styles.tableCard}>
          <div className={styles.filters}>
            <SearchInput
              placeholder="Search code, name or crop"
              aria-label="Search plants"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select aria-label="Zone" value={zone} onChange={(e) => setZone(e.target.value)}>
              <option value="all">All zones</option>
              {zones.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
            <Select aria-label="Health" value={health} onChange={(e) => setHealth(e.target.value)}>
              <option value="all">Any health</option>
              <option value="problem">Problem</option>
              <option value="watch">Watch</option>
              <option value="healthy">Healthy</option>
              <option value="none">Not checked</option>
              <option value="requested">Inspection asked</option>
            </Select>
          </div>
          <DataTable
            label="Plants"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.plant_id}
            onRowClick={(r) => setSelected(r.plant_id)}
            selectedKey={current?.plant_id}
            minWidth={600}
          >
            {rows.length === 0 && (
              <EmptyState
                mascot="curious"
                title={p.plants.length ? 'Nobody matches' : 'No plants yet'}
                compact
              >
                {p.plants.length
                  ? 'Change the search or the filters.'
                  : 'Register plants in Greenhouses & Crops; their health is recorded here.'}
              </EmptyState>
            )}
          </DataTable>
        </section>
        {current && (
          <PlantPanel
            key={current.plant_id}
            row={current}
            issues={p.issues}
            canObserve={p.can_observe}
            canRequest={p.can_request}
          />
        )}
      </div>
    </div>
  );
}

function PlantPanel({
  row,
  issues,
  canObserve,
  canRequest,
}: {
  row: PlantHealthRow;
  issues: PlantIssue[];
  canObserve: boolean;
  canRequest: boolean;
}) {
  const platform = usePlatform();
  const now = useBrainNow();
  const [reason, setReason] = useState('');
  const ask = useOpsMutation(
    () => operations.requestInspection(platform, row.plant_id, reason.trim() || undefined),
    () => `Inspection of ${row.code} asked.`,
  );
  const cancel = useOpsMutation(
    (id: string) => operations.cancelInspection(platform, id),
    () => 'Inspection request cancelled.',
  );
  const req = row.open_request;
  return (
    <aside className={styles.panel} aria-label={`${row.code} health`}>
      <div className={styles.panelHead}>
        <span className={styles.name}>{row.code}</span>
        <HealthBadge health={row.latest?.health} />
      </div>
      <span className={styles.muted}>
        {row.name ? `${row.name} · ` : ''}
        {row.crop} · {row.zone}
        {row.planted_on ? ` · planted ${row.planted_on}` : ''}
      </span>

      <div className={styles.block}>
        <span className={styles.label}>Inspection</span>
        {req ? (
          <>
            <span>
              Asked by <b>{req.requested_by}</b> {timeAgo(req.requested_at, now)}
              {req.reason ? `: “${req.reason}”` : ''}
            </span>
            <span className={styles.muted}>
              Recording an observation of this plant completes it.
            </span>
            {canRequest && (
              <Button
                size="sm"
                variant="ghost"
                icon="close"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate(req.id)}
              >
                Cancel request
              </Button>
            )}
          </>
        ) : canRequest ? (
          <div className={styles.inline}>
            <input
              className={styles.input}
              aria-label="Why inspect"
              placeholder="Why? (optional)"
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              size="sm"
              variant="secondary"
              icon="person_search"
              disabled={ask.isPending}
              onClick={() => ask.mutate(undefined)}
            >
              Ask for inspection
            </Button>
          </div>
        ) : (
          <span className={styles.muted}>No inspection asked.</span>
        )}
      </div>

      {canObserve && <ObserveForm row={row} issues={issues} />}

      <ObservationHistory plantId={row.plant_id} />
    </aside>
  );
}

export function ObserveForm({
  row,
  issues,
}: {
  row: Pick<PlantHealthRow, 'plant_id' | 'code'>;
  issues: PlantIssue[];
}) {
  const platform = usePlatform();
  const qc = useQueryClient();
  const [health, setHealth] = useState<PlantHealthState>('healthy');
  const [chosen, setChosen] = useState<PlantIssue[]>([]);
  const [note, setNote] = useState('');
  const save = useOpsMutation(
    () =>
      operations.observe(platform, row.plant_id, {
        health,
        issues: health === 'healthy' ? [] : chosen,
        note: note.trim() || null,
      }),
    (r) =>
      r.requests_done
        ? `Saved. The inspection of ${row.code} is done.`
        : `Saved: ${row.code} is ${HEALTH[health].label.toLowerCase()}.`,
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(undefined, {
      onSuccess: () => {
        setChosen([]);
        setNote('');
        void qc.invalidateQueries({ queryKey: operationsKeys.observations(row.plant_id) });
      },
    });
  };
  const toggle = (i: PlantIssue) =>
    setChosen(chosen.includes(i) ? chosen.filter((x) => x !== i) : [...chosen, i]);
  return (
    <form className={styles.block} onSubmit={submit} aria-label="Record what you saw">
      <span className={styles.label}>Record what you saw</span>
      <div className={styles.segmented} role="radiogroup" aria-label="Health">
        {(Object.keys(HEALTH) as PlantHealthState[]).map((h) => (
          <button
            key={h}
            type="button"
            role="radio"
            aria-checked={health === h}
            data-tone={HEALTH[h].tone}
            onClick={() => setHealth(h)}
          >
            {HEALTH[h].label}
          </button>
        ))}
      </div>
      {health !== 'healthy' && (
        <div className={styles.chips} role="group" aria-label="Issues">
          {issues.map((i) => (
            <button
              key={i}
              type="button"
              className={styles.chip}
              aria-pressed={chosen.includes(i)}
              onClick={() => toggle(i)}
            >
              {ISSUE[i]}
            </button>
          ))}
        </div>
      )}
      <textarea
        className={styles.textarea}
        aria-label="Note"
        placeholder="What did you see? (optional; required for “Other”)"
        maxLength={500}
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <Button type="submit" size="sm" icon="save" disabled={save.isPending}>
        Save observation
      </Button>
    </form>
  );
}

/** What people recorded about one plant, newest first (ADR-070). */
export function ObservationHistory({
  plantId,
  title = 'History',
}: {
  plantId: string;
  title?: string;
}) {
  const history = useQuery(operationsQueries.observations(usePlatform(), plantId));
  return (
    <div className={styles.block}>
      <span className={styles.label}>{title}</span>
      {history.isPending && <Skeleton height={80} />}
      {history.isError && <span className={styles.muted}>{describeError(history.error)}</span>}
      {history.data?.length === 0 && (
        <span className={styles.muted}>Nobody has recorded this plant’s health yet.</span>
      )}
      {history.data?.map((o) => (
        <div key={o.id} className={styles.history}>
          <span className={styles.historyHead}>
            <HealthBadge health={o.health} />
            <span className={styles.muted}>
              {stamp(o.observed_at)} · {o.observed_by}
            </span>
          </span>
          {o.issues.length > 0 && (
            <span className={styles.badges}>
              {o.issues.map((i) => (
                <Badge key={i} tone="off" variant="tag">
                  {ISSUE[i]}
                </Badge>
              ))}
            </span>
          )}
          {o.note && <span>{o.note}</span>}
        </div>
      ))}
    </div>
  );
}
