import type { ReactNode } from 'react';
import type { Task } from '@lefi/api';
import { toneVars } from '@lefi/ui';
import { DataTable, type Column } from '../../shared/ui';
import { PRIORITY, STATUS_TONE } from './presentation';
import styles from './tasks.module.css';

export function Pill({
  tone,
  children,
}: {
  tone: Parameters<typeof toneVars>[0];
  children: ReactNode;
}) {
  const t = toneVars(tone);
  return (
    <span className={styles.pill} style={{ background: t.bg, color: t.fg }}>
      {children}
    </span>
  );
}

export function OriginTag({ task, long }: { task: Task; long?: boolean }) {
  const ai = task.created_by === 'ai';
  return (
    <span className={styles.origin} data-ai={ai}>
      <span className={styles.icon}>{ai ? 'smart_toy' : 'person'}</span>
      {ai ? (long ? 'AI-generated' : 'AI') : long ? 'Human-assigned' : 'Human'}
    </span>
  );
}

const COLUMNS: Column<Task>[] = [
  {
    key: 'id',
    header: 'ID',
    width: '72px',
    render: (t) => <span className={styles.monoMuted}>{t.id}</span>,
  },
  {
    key: 'title',
    header: 'Task',
    width: 'minmax(200px, 2.4fr)',
    render: (t) => (
      <div className={styles.titleCell}>
        <span className={styles.title}>{t.title}</span>
        <div className={styles.tags}>
          <OriginTag task={t} />
          <span className={styles.monoFaint}>{t.incident_id ?? '—'}</span>
        </div>
      </div>
    ),
  },
  {
    key: 'zone',
    header: 'Zone',
    width: '80px',
    render: (t) => <span className={styles.mono}>{t.zone_id ?? '—'}</span>,
  },
  { key: 'who', header: 'Assignee', width: '1.1fr', render: (t) => t.assignee ?? 'Unassigned' },
  {
    key: 'pri',
    header: 'Priority',
    width: '86px',
    render: (t) => <Pill tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Pill>,
  },
  {
    key: 'st',
    header: 'Status',
    width: '120px',
    render: (t) => <Pill tone={STATUS_TONE[t.status]}>{t.status}</Pill>,
  },
];

export function TaskTable({
  rows,
  selected,
  onSelect,
}: {
  rows: Task[];
  selected: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <DataTable
      label="Tasks"
      columns={COLUMNS}
      rows={rows}
      rowKey={(t) => t.id}
      selectedKey={selected ?? ''}
      onRowClick={(t) => onSelect(t.id)}
      minWidth={640}
    />
  );
}
