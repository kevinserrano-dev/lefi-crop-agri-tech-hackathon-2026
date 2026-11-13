import { useQuery } from '@tanstack/react-query';
import { queries, type NotificationDelivery } from '@lefi/api';
import { toneVars } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { DataTable, ProvenanceBadge, Skeleton, type Column } from '../../shared/ui';
import styles from './escalation.module.css';

const COLUMNS: Column<NotificationDelivery>[] = [
  {
    key: 'time',
    header: 'Time',
    width: '80px',
    render: (d) => <span className={styles.mono}>{d.time}</span>,
  },
  {
    key: 'inc',
    header: 'Incident',
    width: '90px',
    render: (d) => <span className={styles.mono}>{d.incident_id}</span>,
  },
  { key: 'ch', header: 'Channel', width: '130px', render: (d) => <b>{d.channel}</b> },
  { key: 'who', header: 'Recipient', width: 'minmax(160px, 1.4fr)', render: (d) => d.recipient },
  { key: 'msg', header: 'Message', width: 'minmax(180px, 1.6fr)', render: (d) => d.message },
  {
    key: 'state',
    header: 'State',
    width: '190px',
    render: (d) => {
      const t = toneVars(d.tone);
      return (
        <span className={styles.pill} style={{ background: t.bg, color: t.fg }}>
          {d.state}
        </span>
      );
    },
  },
];

/** What the Brain logged for every notification attempt; the app itself sends nothing. */
export function DeliveryAudit() {
  const q = useQuery(queries.deliveries(usePlatform()));
  return (
    <section className={styles.tableCard}>
      <div className={styles.tableHead}>
        <span className={styles.cardTitle}>Notification delivery audit</span>
        {q.data?.[0] && <ProvenanceBadge origin={q.data[0].origin} />}
      </div>
      {q.isPending ? (
        <Skeleton height={200} />
      ) : q.isError ? (
        <span className={styles.faint}>{describeError(q.error)}</span>
      ) : (
        <DataTable
          label="Notification delivery audit"
          columns={COLUMNS}
          rows={q.data}
          rowKey={(d) => `${d.time}-${d.incident_id}-${d.channel}-${d.recipient}`}
        >
          {q.data.length === 0 && <span className={styles.faint}>No notifications logged.</span>}
        </DataTable>
      )}
    </section>
  );
}
