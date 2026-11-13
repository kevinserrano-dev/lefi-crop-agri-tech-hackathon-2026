import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { endpoints, queries, queryKeys, type PermissionChange } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { roleColor } from '../../shared/lib/roles';
import { Icon, Skeleton, useToast } from '../../shared/ui';
import styles from './admin.module.css';

/**
 * RBAC matrix from the Brain. Each click is a grant/revoke the Brain validates (lock-out
 * protection) and applies to sessions at once; the app then re-reads its own session.
 */
export function RolesTab() {
  const platform = usePlatform();
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const q = useQuery(queries.permissions(platform));
  const change = useMutation({
    mutationFn: (b: PermissionChange) => endpoints.setPermission(platform, b),
    onSuccess: (r) => {
      qc.setQueryData(queryKeys.permissions, r.item);
      void qc.invalidateQueries({ queryKey: queryKeys.session }); // our own permissions may change
      void qc.invalidateQueries({ queryKey: queryKeys.navCounters });
      toast(r.message, 'ok');
    },
    onError: (e) => toast(describeError(e), 'bad'),
  });
  if (q.isPending) return <Skeleton height={500} />;
  if (q.isError) return <span className={styles.faint}>{describeError(q.error)}</span>;
  const m = q.data;
  const cols = {
    gridTemplateColumns: `minmax(260px, 1.8fr) repeat(${m.roles.length}, minmax(90px, 1fr))`,
  };
  return (
    <>
      <span className={styles.text}>{m.note}</span>
      <div className={styles.scrollCard}>
        <div className={styles.matrix} role="table" aria-label="Roles and permissions">
          <div role="row" className={styles.matrixHead} style={cols}>
            <span className={styles.eyebrow}>Permission</span>
            {m.roles.map((r) => (
              <div key={r.id} className={styles.roleCol} role="columnheader">
                <span className={styles.roleDot} style={{ background: roleColor(r.id) }} />
                <b title={r.name}>{r.short}</b>
                <span className={styles.faint}>
                  {r.users} {r.users === 1 ? 'user' : 'users'}
                </span>
              </div>
            ))}
          </div>
          {m.groups.map((g) => (
            <div key={g.label} role="rowgroup">
              <div className={styles.groupLabel}>{g.label}</div>
              {g.rows.map((row) => (
                <div role="row" key={row.key} className={styles.matrixRow} style={cols}>
                  <div className={styles.permText}>
                    <span>{row.label}</span>
                    <span className={styles.mono}>{row.key}</span>
                  </div>
                  {m.roles.map((r) => {
                    const on = row.roles.includes(r.id);
                    const locked = !m.can_edit.allowed || (on && row.locked.includes(r.id));
                    return (
                      <button
                        key={r.id}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        aria-label={`${r.short} · ${row.label}`}
                        className={styles.check}
                        data-locked={locked}
                        title={!m.can_edit.allowed ? (m.can_edit.reason ?? undefined) : undefined}
                        disabled={change.isPending}
                        onClick={() =>
                          m.can_edit.allowed
                            ? change.mutate({ permission: row.key, role: r.id, granted: !on })
                            : toast(m.can_edit.reason ?? 'Not allowed.', 'bad')
                        }
                      >
                        {on && <Icon name="check" size={17} />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
