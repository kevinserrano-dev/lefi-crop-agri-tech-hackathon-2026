import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { people, peopleQueries, type AuditFilter, type AuditRow, type PairedPc } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { stamp, timeAgo } from '../../shared/lib/time';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Icon,
  Select,
  Skeleton,
  type Column,
} from '../../shared/ui';
import { useCan } from '../session';
import { ConfirmButton, useBrainNow } from '../live/common';
import { usePeopleMutation } from './common';
import { AUDIT_FILTERS, actionLabel } from './presentation';
import styles from './people.module.css';

type Tab = 'roles' | 'audit' | 'pcs';

/**
 * Administration against the real Lefi Brain: the role matrix it enforces, its hash-chained audit
 * trail, and the PCs paired with it. Each tab needs its own permission; Lefi Brain checks it again.
 */
export function AdminLive() {
  const tabs: Array<[Tab, string, boolean]> = [
    ['roles', 'Roles & permissions', useCan('admin.roles')],
    ['audit', 'Audit trail', useCan('admin.audit')],
    ['pcs', 'Paired PCs', useCan('admin.devices')],
  ];
  const allowed = tabs.filter(([, , ok]) => ok);
  const [tab, setTab] = useState<Tab | undefined>(allowed[0]?.[0]);
  if (allowed.length === 0)
    return (
      <EmptyState mascot="curious" title="Nothing here for your role">
        Roles, the audit trail and paired PCs need permissions your role does not have.
      </EmptyState>
    );
  return (
    <>
      <div className={styles.tabBar}>
        <div className={styles.tabs} role="tablist" aria-label="Administration">
          {allowed.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'roles' && <RolesTab />}
      {tab === 'audit' && <AuditTab />}
      {tab === 'pcs' && <PcsTab />}
    </>
  );
}

function RolesTab() {
  const q = useQuery(peopleQueries.roles(usePlatform()));
  if (q.isError) return <span className={styles.muted}>{describeError(q.error)}</span>;
  if (!q.data) return <Skeleton height={500} />;
  const { roles, groups } = q.data;
  return (
    <section className={styles.tableCard}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>Who may do what</span>
        <span className={styles.note}>
          <Icon name="lock" size={16} /> Enforced by Lefi Brain on every request. The matrix is part
          of Lefi Brain and changes only with a release; give a person different access by changing
          their role in Workforce.
        </span>
      </div>
      <div className={styles.matrixWrap}>
        <table className={styles.matrix} aria-label="Roles and permissions">
          <thead>
            <tr>
              <th>Permission</th>
              {roles.map((r) => (
                <th key={r.id} title={r.name}>
                  {r.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.name}>
                <tr className={styles.groupRow}>
                  <td colSpan={roles.length + 1}>{g.name}</td>
                </tr>
                {g.permissions.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.label}
                      <span className={styles.mono}> {p.id}</span>
                      {p.lockout && (
                        <span
                          className={styles.muted}
                          title="The last active administrator can never lose this"
                        >
                          {' '}
                          <Icon name="shield_lock" size={14} />
                        </span>
                      )}
                    </td>
                    {roles.map((r) => {
                      const on = p.roles.includes(r.id);
                      return (
                        <td key={r.id} className={styles.cell} data-on={on}>
                          <span aria-label={`${r.name}: ${on ? 'yes' : 'no'}`}>
                            {on ? <Icon name="check" size={18} /> : '·'}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <span className={styles.muted}>
        No role can switch pumps, valves or any other actuator: Lefi Brain has no such permission
        (ADR-004).
      </span>
    </section>
  );
}

const OUTCOME_TONE = { success: 'ok', denied: 'warn', failed: 'crit' } as const;

function AuditTab() {
  const platform = usePlatform();
  const now = useBrainNow();
  const [filter, setFilter] = useState<AuditFilter>({ limit: 50 });
  const [pages, setPages] = useState<number[]>([]);
  const before = pages.at(-1);
  const q = useQuery(peopleQueries.audit(platform, { ...filter, before }));
  const [check, setCheck] = useState<string>();
  const verify = usePeopleMutation(() => people.verifyAudit(platform));
  const columns: Column<AuditRow>[] = [
    {
      key: 'at',
      header: 'When',
      width: '150px',
      render: (e) => (
        <span className={styles.mono} title={timeAgo(e.at, now)}>
          {stamp(e.at)}
        </span>
      ),
    },
    {
      key: 'who',
      header: 'Who',
      width: '1.2fr',
      render: (e) => (
        <span>
          {e.actor.name}
          {e.actor.type !== 'user' && <span className={styles.muted}> · {e.actor.type}</span>}
        </span>
      ),
    },
    {
      key: 'what',
      header: 'What',
      width: '1.6fr',
      render: (e) => (
        <span title={e.action}>
          {actionLabel(e.action)}
          {e.target_name && <span className={styles.muted}> · {e.target_name}</span>}
        </span>
      ),
    },
    {
      key: 'outcome',
      header: 'Result',
      width: '110px',
      render: (e) => (
        <Badge tone={OUTCOME_TONE[e.outcome]} dot>
          {e.outcome}
        </Badge>
      ),
    },
    {
      key: 'details',
      header: 'Details',
      width: '2fr',
      render: (e) => <span className={styles.mono}>{detailText(e)}</span>,
    },
  ];
  return (
    <section className={styles.tableCard}>
      <div className={styles.filters}>
        <Select
          aria-label="What to show"
          value={filter.action ?? ''}
          onChange={(e) => {
            setPages([]);
            setFilter({ ...filter, action: e.target.value || undefined });
          }}
        >
          {AUDIT_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Result"
          value={filter.outcome ?? ''}
          onChange={(e) => {
            setPages([]);
            setFilter({
              ...filter,
              outcome: (e.target.value || undefined) as AuditFilter['outcome'],
            });
          }}
        >
          <option value="">Any result</option>
          <option value="success">Success</option>
          <option value="denied">Denied</option>
          <option value="failed">Failed</option>
        </Select>
        <span className={styles.spacer} />
        {check && <span className={styles.muted}>{check}</span>}
        <Button
          size="sm"
          variant="secondary"
          icon="verified"
          disabled={verify.isPending}
          onClick={() =>
            verify.mutate(undefined, {
              onSuccess: (r) =>
                setCheck(
                  r.ok
                    ? `Chain intact · ${r.entries} entries`
                    : `Chain BROKEN at #${r.broken_at_seq}: ${r.reason ?? ''}`,
                ),
            })
          }
        >
          Verify integrity
        </Button>
      </div>
      {q.isError ? (
        <span className={styles.muted}>{describeError(q.error)}</span>
      ) : !q.data ? (
        <Skeleton height={400} />
      ) : (
        <>
          <DataTable
            label="Audit trail"
            columns={columns}
            rows={q.data.entries}
            rowKey={(e) => String(e.seq)}
            minWidth={820}
          >
            {q.data.entries.length === 0 && (
              <EmptyState mascot="curious" title="No entries" compact>
                Nothing recorded matches these filters.
              </EmptyState>
            )}
          </DataTable>
          <div className={styles.pager}>
            <span className={styles.muted}>
              {q.data.total} entries in total · newest first · secrets are never written
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={pages.length === 0}
              onClick={() => setPages(pages.slice(0, -1))}
            >
              Newer
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={q.data.next_before === null}
              onClick={() => q.data.next_before && setPages([...pages, q.data.next_before])}
            >
              Older
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function detailText(e: AuditRow): string {
  const d = e.details;
  if (e.action === 'user.role_changed') return `${String(d.from)} → ${String(d.to)}`;
  if (e.action === 'authz.denied') return `${String(d.permission)} on ${String(d.path)}`;
  if (e.action === 'auth.login' && d.reason) return `${String(d.reason)} · ${String(d.ip ?? '')}`;
  return Object.entries(d)
    .filter(([, v]) => v !== null && typeof v !== 'object')
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' · ');
}

const PC_TONE = { active: 'ok', revoked: 'crit', expired: 'warn' } as const;

function PcsTab() {
  const platform = usePlatform();
  const now = useBrainNow();
  const q = useQuery(peopleQueries.pcs(platform));
  const revoke = usePeopleMutation(
    (id: string) => people.revokePc(platform, id),
    (pc) => `${pc.name} removed. It must be paired again to reach Lefi Brain.`,
  );
  if (q.isError) return <span className={styles.muted}>{describeError(q.error)}</span>;
  if (!q.data) return <Skeleton height={300} />;
  const columns: Column<PairedPc>[] = [
    {
      key: 'name',
      header: 'PC',
      width: '1.5fr',
      render: (d) => (
        <span>
          <b>{d.name}</b>
          <span className={styles.muted}>
            {' '}
            · {d.platform}
            {d.this_pc && ' · this PC'}
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      render: (d) => (
        <Badge tone={PC_TONE[d.status]} dot title={d.revoked_reason ?? undefined}>
          {d.status}
        </Badge>
      ),
    },
    {
      key: 'seen',
      header: 'Last seen',
      width: '120px',
      render: (d) => <span className={styles.muted}>{timeAgo(d.last_seen_at, now)}</span>,
    },
    {
      key: 'cert',
      header: 'Certificate',
      width: '1.3fr',
      render: (d) => (
        <span className={styles.muted}>
          paired {stamp(d.issued_at)} · until {stamp(d.expires_at)}
          {d.paired_ip ? ` · from ${d.paired_ip}` : ''}
        </span>
      ),
    },
    {
      key: 'act',
      header: '',
      width: '230px',
      render: (d) =>
        d.status === 'active' && !d.this_pc ? (
          <ConfirmButton
            label="Remove"
            icon="link_off"
            confirm="It loses access at once."
            disabled={revoke.isPending}
            onConfirm={() => revoke.mutate(d.id)}
          />
        ) : null,
    },
  ];
  return (
    <section className={styles.tableCard}>
      <span className={styles.note}>
        <Icon name="verified_user" size={16} /> Every PC reaching Lefi Brain through Lefi Gateway
        holds a certificate issued at pairing. Removing a PC refuses it on its next request.
      </span>
      <DataTable
        label="Paired PCs"
        columns={columns}
        rows={q.data}
        rowKey={(d) => d.id}
        minWidth={820}
      >
        {q.data.length === 0 && (
          <EmptyState mascot="curious" title="No paired PCs" compact>
            Lefi Crop Helper pairs Lefi Desktop with Lefi Brain.
          </EmptyState>
        )}
      </DataTable>
    </section>
  );
}
