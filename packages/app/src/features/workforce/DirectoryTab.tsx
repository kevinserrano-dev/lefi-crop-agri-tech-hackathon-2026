import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { queries, type WorkforcePerson } from '@lefi/api';
import { mascots, toneVars } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { roleColor } from '../../shared/lib/roles';
import { Avatar, DataTable, SearchInput, Select, Skeleton, type Column } from '../../shared/ui';
import { PersonPanel } from './PersonPanel';
import { statusTone, zonesLabel } from './presentation';
import styles from './workforce.module.css';

const COLUMNS: Column<WorkforcePerson>[] = [
  {
    key: 'who',
    header: 'Employee',
    width: 'minmax(200px, 2fr)',
    render: (e) => (
      <div className={styles.who}>
        <Avatar name={e.name} size={32} color={roleColor(e.role_id)} />
        <div className={styles.whoText}>
          <b>{e.name}</b>
          <span className={styles.faint}>{e.email}</span>
        </div>
      </div>
    ),
  },
  { key: 'role', header: 'Role', width: '1.6fr', render: (e) => e.role_name },
  {
    key: 'zones',
    header: 'Zone access',
    width: '1.2fr',
    render: (e) => <span className={styles.mono}>{zonesLabel(e.zones)}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    width: '130px',
    render: (e) => {
      const t = toneVars(statusTone(e.status));
      return (
        <span className={styles.status} style={{ background: t.bg, color: t.fg }}>
          {e.status}
        </span>
      );
    },
  },
];

/** Employee directory + selected profile (design). */
export function DirectoryTab() {
  const platform = usePlatform();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('all');
  const search = useSearch({ strict: false }) as { person?: string };
  const [selected, setSelected] = useState<string | undefined>(search.person);
  const [seen, setSeen] = useState(search.person);
  if (search.person !== seen) {
    setSeen(search.person);
    if (search.person) {
      setQ('');
      setRole('all');
      setSelected(search.person);
    }
  }
  const roles = useQuery(queries.roles(platform));
  const list = useQuery(
    queries.workforce(platform, {
      ...(q.trim() && { q: q.trim() }),
      ...(role !== 'all' && { role }),
    }),
  );
  // Default to the first worker (as in the design), then keep that person selected even if
  // an edit (e.g. a role change) would make another row "the first worker".
  const current =
    selected ?? list.data?.find((e) => e.role_id === 'worker')?.id ?? list.data?.[0]?.id;
  if (!selected && current) setSelected(current);
  return (
    <div className={styles.layout}>
      <section className={styles.tableCard}>
        <div className={styles.filters}>
          <SearchInput
            placeholder="Search name, email or role"
            aria-label="Search employees"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Select aria-label="Role filter" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="all">All roles</option>
            {roles.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>
        {list.isPending ? (
          <Skeleton height={400} />
        ) : list.isError ? (
          <span className={styles.faint}>{describeError(list.error)}</span>
        ) : (
          <DataTable
            label="Employee directory"
            columns={COLUMNS}
            rows={list.data}
            rowKey={(e) => e.id}
            onRowClick={(e) => setSelected(e.id)}
            selectedKey={current}
            minWidth={640}
          >
            {list.data.length === 0 && (
              <div className={styles.empty}>
                <img src={mascots.curious} alt="" />
                No employees match your search.
              </div>
            )}
          </DataTable>
        )}
      </section>
      {current && <PersonPanel key={current} id={current} />}
    </div>
  );
}
