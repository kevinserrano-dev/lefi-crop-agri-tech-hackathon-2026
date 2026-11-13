import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queries, INCIDENT_STEPS, type Incident, type IncidentFilters } from '@lefi/api';
import { mascots, toneVars, type Severity } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { stamp } from '../../shared/lib/time';
import {
  Button,
  DataTable,
  KpiRow,
  KpiTile,
  ProvenanceBadge,
  SearchInput,
  Select,
  Skeleton,
  ToggleGroup,
  type Column,
} from '../../shared/ui';
import { useCan } from '../session';
import { ReportIncidentForm } from './ReportIncidentForm';
import { SEVERITY, STATUS_TONE } from './tones';
import styles from './incidents.module.css';

type SevFilter = 'all' | Severity;
type StatusFilter = NonNullable<IncidentFilters['status']> | 'all';
type SourceFilter = 'all' | 'automatic' | 'manual';

export interface ListFilters {
  severity: SevFilter;
  status: StatusFilter;
  source: SourceFilter;
  q: string;
}
export const DEFAULT_FILTERS: ListFilters = {
  severity: 'all',
  status: 'open',
  source: 'all',
  q: '',
};

const toQuery = (f: ListFilters): IncidentFilters => ({
  ...(f.severity !== 'all' && { severity: f.severity }),
  ...(f.status !== 'all' && { status: f.status }),
  ...(f.source !== 'all' && { source: f.source }),
  ...(f.q.trim() && { q: f.q.trim() }),
});

export function IncidentList({
  filters,
  onFilters,
  onOpen,
}: {
  filters: ListFilters;
  onFilters: (f: ListFilters) => void;
  onOpen: (id: string) => void;
}) {
  const platform = usePlatform();
  const canReport = useCan('incident.report');
  const [reporting, setReporting] = useState(false);
  const summary = useQuery(queries.incidentSummary(platform));
  const list = useQuery(queries.incidents(platform, toQuery(filters)));
  const set = (patch: Partial<ListFilters>) => onFilters({ ...filters, ...patch });
  const s = summary.data;

  return (
    <>
      <KpiRow>
        <KpiTile label="Open incidents" value={s?.open} />
        <KpiTile label="Critical · open" value={s?.critical_open} />
        <KpiTile label="Unacknowledged" value={s?.unacknowledged} />
        <KpiTile
          label="Median time to acknowledge"
          value={
            s ? (s.median_ack_minutes === null ? '—' : `${s.median_ack_minutes} min`) : undefined
          }
        />
      </KpiRow>

      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <ToggleGroup
            label="Severity"
            value={filters.severity}
            onChange={(severity) => set({ severity })}
            options={[
              { value: 'all', label: 'All' },
              { value: 'critical', label: 'Critical' },
              { value: 'warning', label: 'Warning' },
              { value: 'info', label: 'Informational' },
            ]}
          />
          <Select
            aria-label="Status"
            value={filters.status}
            onChange={(e) => set({ status: e.target.value as StatusFilter })}
          >
            <option value="open">Status: Open</option>
            <option value="all">Status: All</option>
            {INCIDENT_STEPS.map((st) => (
              <option key={st} value={st}>
                Status: {st}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Source"
            value={filters.source}
            onChange={(e) => set({ source: e.target.value as SourceFilter })}
          >
            <option value="all">Source: All</option>
            <option value="automatic">Source: Automatic</option>
            <option value="manual">Source: Manual</option>
          </Select>
        </div>
        <div className={styles.filters}>
          <SearchInput
            placeholder="Search incidents"
            aria-label="Search incidents"
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
          />
          <Button
            icon={canReport ? 'add' : 'lock'}
            onClick={() => setReporting((r) => !r)}
            disabled={!canReport}
            title={
              canReport ? 'Report an incident' : 'Requires permission: Report incidents manually'
            }
          >
            Report incident
          </Button>
        </div>
      </div>

      {reporting && (
        <ReportIncidentForm
          onDone={(id) => {
            setReporting(false);
            if (id) onOpen(id); // open the new incident, as in the design
          }}
        />
      )}

      {list.isPending && <Skeleton height={280} />}
      {list.isError && <span className={styles.muted}>{describeError(list.error)}</span>}
      {list.data?.some((i) => i.origin === 'SIMULATED') && (
        <span className={styles.simNote}>
          <ProvenanceBadge origin="SIMULATED" /> Incidents marked as simulated come from the mock
          Lefi Brain, not from real devices.
        </span>
      )}
      {list.data && list.data.length > 0 && (
        <DataTable
          label="Incidents"
          columns={COLUMNS}
          rows={list.data}
          rowKey={(i) => i.id}
          onRowClick={(i) => onOpen(i.id)}
          minWidth={1040}
        />
      )}
      {list.data?.length === 0 && (
        <div className={styles.empty}>
          <img src={mascots.calm} alt="" />
          <span className={styles.emptyTitle}>No incidents match</span>
          <span className={styles.muted}>Adjust severity, status or source filters.</span>
        </div>
      )}
    </>
  );
}

export function SeverityPill({ severity, large }: { severity: Severity; large?: boolean }) {
  const t = toneVars(SEVERITY[severity].tone);
  return (
    <span
      className={large ? styles.pillLarge : styles.pill}
      style={{ background: t.bg, color: t.fg }}
    >
      <span className={styles.pillDot} style={{ background: t.dot }} />
      {SEVERITY[severity].label}
    </span>
  );
}

export function StatusPill({ status, large }: { status: Incident['status']; large?: boolean }) {
  const t = toneVars(STATUS_TONE[status]);
  return (
    <span
      className={large ? styles.pillLarge : styles.pill}
      style={{ background: t.bg, color: t.fg }}
    >
      {status}
    </span>
  );
}

const COLUMNS: Column<Incident>[] = [
  {
    key: 'id',
    header: 'Alert ID',
    width: '92px',
    render: (i) => <span className={styles.monoStrong}>{i.id}</span>,
  },
  {
    key: 'ts',
    header: 'Detected',
    width: '120px',
    render: (i) => <span className={styles.mono}>{stamp(i.detected_at)}</span>,
  },
  {
    key: 'title',
    header: 'Incident · location',
    width: 'minmax(240px, 2.2fr)',
    render: (i) => (
      <div className={styles.titleCell}>
        <span className={styles.rowTitle}>{i.title}</span>
        <span className={styles.rowMeta}>
          {i.zone_label} · {i.area} · plant {i.plant_id ?? '—'}
        </span>
      </div>
    ),
  },
  {
    key: 'src',
    header: 'Source',
    width: '120px',
    render: (i) => (
      <span className={styles.source}>
        <span className={styles.icon}>
          {i.source.kind === 'automatic' ? 'smart_toy' : 'person'}
        </span>
        {i.source.label}
      </span>
    ),
  },
  {
    key: 'sev',
    header: 'Severity',
    width: '110px',
    render: (i) => <SeverityPill severity={i.severity} />,
  },
  {
    key: 'conf',
    header: 'AI conf.',
    width: '80px',
    render: (i) => (
      <span className={styles.mono}>{i.ai_confidence === null ? '—' : `${i.ai_confidence} %`}</span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    width: '120px',
    render: (i) => <StatusPill status={i.status} />,
  },
  { key: 'who', header: 'Assigned to', width: '140px', render: (i) => i.assignee ?? 'Unassigned' },
];
