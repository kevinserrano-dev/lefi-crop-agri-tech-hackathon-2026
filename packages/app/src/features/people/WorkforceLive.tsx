import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { peopleQueries, type BrainUser } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { roleColor } from '../../shared/lib/roles';
import { timeAgo } from '../../shared/lib/time';
import {
  Avatar,
  Button,
  DataTable,
  EmptyState,
  SearchInput,
  Segmented,
  Select,
  Skeleton,
  type Column,
} from '../../shared/ui';
import { useBrainNow } from '../live/common';
import { AddUserDialog } from './AddUserDialog';
import { TemporaryPasswordDialog, UserBadges } from './common';
import { ShiftsLive } from './ShiftsLive';
import { UserPanel } from './UserPanel';
import styles from './people.module.css';

type Shown = { username: string; password: string; title: string } | null;

/**
 * Workforce against the real Lefi Brain: every account that can sign in, its role and state.
 * Administrators (`user.manage`) add people, change roles, reset passwords, end sessions and
 * deactivate; managers and supervisors read the directory. Lefi Brain checks every change again,
 * audits it, and refuses what would lock the last administrator out.
 */
export function WorkforceLive() {
  const [tab, setTab] = useState<'people' | 'shifts'>('people');
  return (
    <div className={styles.stack}>
      <Segmented
        label="Workforce"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'people', label: 'Directory' },
          { value: 'shifts', label: 'Shifts' },
        ]}
      />
      {tab === 'people' ? <DirectoryLive /> : <ShiftsLive />}
    </div>
  );
}

function DirectoryLive() {
  const platform = usePlatform();
  const now = useBrainNow();
  const list = useQuery(peopleQueries.users(platform));
  const [q, setQ] = useState('');
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState<Shown>(null);

  if (list.isError)
    return (
      <EmptyState mascot="sad" title="Could not load the people">
        {describeError(list.error)}
      </EmptyState>
    );
  if (!list.data) return <Skeleton height={420} />;
  const data = list.data;
  const needle = q.trim().toLowerCase();
  const rows = data.users.filter(
    (u) =>
      (role === 'all' || u.role.id === role) &&
      (status === 'all' || u.status === status) &&
      (!needle ||
        [u.display_name, u.username, u.email ?? '', u.role.name].some((s) =>
          s.toLowerCase().includes(needle),
        )),
  );
  const current = data.users.find((u) => u.id === selected) ?? rows[0];
  const active = data.users.filter((u) => u.status === 'active').length;

  const columns: Column<BrainUser>[] = [
    {
      key: 'who',
      header: 'Person',
      width: 'minmax(220px, 2fr)',
      render: (u) => (
        <div className={styles.who}>
          <Avatar name={u.display_name} size={32} color={roleColor(u.role.id)} />
          <div className={styles.whoText}>
            <b>
              {u.display_name}
              {u.is_you && <span className={styles.muted}> (you)</span>}
            </b>
            <span className={styles.muted}>
              {u.username}
              {u.email ? ` · ${u.email}` : ''}
            </span>
          </div>
        </div>
      ),
    },
    { key: 'role', header: 'Role', width: '1.4fr', render: (u) => u.role.name },
    {
      key: 'state',
      header: 'Status',
      width: '1.4fr',
      render: (u) => <UserBadges user={u} brainNow={now} />,
    },
    {
      key: 'last',
      header: 'Last sign-in',
      width: '120px',
      render: (u) => <span className={styles.muted}>{timeAgo(u.last_login_at, now)}</span>,
    },
  ];

  return (
    <>
      <div className={styles.toolbar}>
        <span className={styles.muted}>
          {data.users.length} {data.users.length === 1 ? 'account' : 'accounts'} · {active} active ·
          from Lefi Brain
        </span>
        {data.can_manage && (
          <Button icon="person_add" onClick={() => setAdding(true)}>
            Add user
          </Button>
        )}
      </div>
      <div className={styles.layout}>
        <section className={styles.tableCard}>
          <div className={styles.filters}>
            <SearchInput
              placeholder="Search name, username, email or role"
              aria-label="Search people"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select aria-label="Role filter" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="all">All roles</option>
              {data.roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Status filter"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">Any status</option>
              <option value="active">Active</option>
              <option value="disabled">Deactivated</option>
            </Select>
          </div>
          <DataTable
            label="People"
            columns={columns}
            rows={rows}
            rowKey={(u) => u.id}
            onRowClick={(u) => setSelected(u.id)}
            selectedKey={current?.id}
            minWidth={620}
          >
            {rows.length === 0 && (
              <EmptyState mascot="curious" title="Nobody matches" compact>
                Change the search or the filters.
              </EmptyState>
            )}
          </DataTable>
        </section>
        {current && (
          <UserPanel
            key={current.id}
            id={current.id}
            canManage={data.can_manage}
            roles={data.roles}
            onPassword={setShown}
          />
        )}
      </div>
      <AddUserDialog
        open={adding}
        roles={data.roles}
        onClose={() => setAdding(false)}
        onCreated={(user, password) => {
          setSelected(user.id);
          if (password)
            setShown({ username: user.username, password, title: `${user.display_name} added` });
        }}
      />
      <TemporaryPasswordDialog shown={shown} onClose={() => setShown(null)} />
    </>
  );
}
