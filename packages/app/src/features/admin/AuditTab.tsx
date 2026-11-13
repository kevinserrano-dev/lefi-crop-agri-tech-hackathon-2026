import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queries, type AuditEntry } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import {
  ActionButton,
  DataTable,
  SearchInput,
  Skeleton,
  useToast,
  type Column,
} from '../../shared/ui';
import styles from './admin.module.css';

const DOT: Record<AuditEntry['kind'], string> = {
  ok: 'var(--lefi-green-400, #54b985)',
  denied: 'var(--lefi-crit-fg)',
  system: 'var(--lefi-text-faint, #9aa6a0)',
};

const COLUMNS: Column<AuditEntry>[] = [
  {
    key: 'at',
    header: 'Time',
    width: '140px',
    render: (a) => <span className={styles.mono}>{a.at}</span>,
  },
  {
    key: 'user',
    header: 'User',
    width: '180px',
    render: (a) => (
      <span className={styles.user}>
        <span className={styles.roleDot} style={{ background: DOT[a.kind] }} />
        {a.user}
      </span>
    ),
  },
  { key: 'action', header: 'Action', width: '1.2fr', render: (a) => <b>{a.action}</b> },
  {
    key: 'target',
    header: 'Target',
    width: '1.3fr',
    render: (a) => <span className={styles.mono}>{a.target}</span>,
  },
  { key: 'detail', header: 'Details', width: '1.6fr', render: (a) => a.detail },
  {
    key: 'src',
    header: 'Source',
    width: '150px',
    render: (a) => <span className={styles.mono}>{a.source}</span>,
  },
];

const EXPORT = {
  allowed: false,
  reason: 'Not available yet: exporting needs a save-file capability in the desktop shell.',
};

/** Audit trail as the Brain records it; denied attempts are highlighted. */
export function AuditTab() {
  const [q, setQ] = useState('');
  const toast = useToast((s) => s.show);
  const list = useQuery(queries.audit(usePlatform(), q.trim()));
  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <SearchInput
            placeholder="Search user, action or target"
            aria-label="Search audit trail"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <ActionButton
          label="Export CSV"
          icon="download"
          availability={EXPORT}
          onClick={() => toast(EXPORT.reason, 'bad')}
        />
      </div>
      <section className={styles.tableCard}>
        {list.isPending ? (
          <Skeleton height={400} />
        ) : list.isError ? (
          <span className={styles.faint}>{describeError(list.error)}</span>
        ) : (
          <DataTable
            label="Audit trail"
            columns={COLUMNS}
            rows={list.data}
            rowKey={(a) => `${a.at}-${a.user}-${a.action}-${a.target}-${a.detail}`}
            minWidth={960}
          >
            {list.data.length === 0 && <div className={styles.none}>No entries match.</div>}
          </DataTable>
        )}
      </section>
    </>
  );
}
