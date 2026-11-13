import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { queries, type BatchRow } from '@lefi/api';
import { toneVars } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { DataTable, Icon, Skeleton, type Column } from '../../shared/ui';
import { MetricCards } from '../environment/MetricCards';
import { useBrainStatus } from '../shell/useBrainStatus';
import type { Go } from './nav';
import { HealthPill, num } from './parts';
import styles from './crops.module.css';

const COLUMNS: Column<BatchRow>[] = [
  {
    key: 'id',
    header: 'Batch',
    width: '1fr',
    render: (b) => <span className={styles.monoStrong}>{b.id}</span>,
  },
  { key: 'variety', header: 'Variety', width: '1.3fr', render: (b) => <b>{b.variety}</b> },
  { key: 'sown', header: 'Sown', width: '1fr', render: (b) => `${b.sown} · day ${b.day}` },
  { key: 'plants', header: 'Plants', width: '0.9fr', render: (b) => num(b.plants) },
  {
    key: 'stage',
    header: 'Stage · progress',
    width: '1.4fr',
    render: (b) => (
      <div className={styles.progressCell}>
        <span>{b.stage}</span>
        <div className={styles.bar}>
          <div style={{ width: `${b.progress}%` }} />
        </div>
      </div>
    ),
  },
  { key: 'health', header: 'Health', width: '0.8fr', render: (b) => <HealthPill h={b.health} /> },
  {
    key: 'go',
    header: '',
    width: '32px',
    render: () => <Icon name="chevron_right" size={20} color="var(--lefi-text-faint)" />,
  },
];

/** Zone: health, current sensor readings (same cards as Environment) and its crop batches. */
export function ZoneView({ gh, id, go }: { gh: string; id: string; go: Go }) {
  const platform = usePlatform();
  const navigate = useNavigate();
  const brain = useBrainStatus();
  const q = useQuery(queries.zoneOverview(platform, id));
  const readings = useQuery(queries.zoneReadings(platform, id));
  if (q.isPending) return <Skeleton height={400} />;
  if (q.isError) return <span className={styles.faint}>{describeError(q.error)}</span>;
  const z = q.data;
  const t = toneVars(z.health.tone);
  return (
    <>
      <section className={styles.zoneHead}>
        <div className={styles.titleBlock}>
          <span className={styles.bigTitle}>
            {z.id} · {z.name}
          </span>
          <span className={styles.muted}>
            {z.crop} · {num(z.plants)} plants · {z.batches.length} active batches
          </span>
        </div>
        <div className={styles.zoneScore}>
          <span className={styles.faint}>Zone environmental health</span>
          <span className={styles.score} style={{ color: t.fg }}>
            {z.health.value}
          </span>
          <span className={styles.pill} style={{ background: t.bg, color: t.fg }}>
            {z.health.label}
          </span>
        </div>
      </section>
      {readings.data && (
        <MetricCards
          readings={readings.data}
          selected=""
          onSelect={() => void navigate({ to: '/environment', search: { zone: z.id } })}
          stale={!brain.connected}
          brainTime={brain.brainTime}
        />
      )}
      <section className={styles.tableCard}>
        <div className={styles.tableHead}>
          <span className={styles.cardTitle}>Crop batch inventory</span>
          <span className={styles.faint}>{z.batches.length} batches</span>
        </div>
        <DataTable
          label="Crop batch inventory"
          columns={COLUMNS}
          rows={z.batches}
          rowKey={(b) => b.id}
          onRowClick={(b) => go({ level: 'batch', gh, zone: z.id, batch: b.id })}
          minWidth={760}
        >
          {z.batches.length === 0 && <div className={styles.none}>No batches in this zone.</div>}
        </DataTable>
      </section>
    </>
  );
}
