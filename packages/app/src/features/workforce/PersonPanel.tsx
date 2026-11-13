import { useQuery } from '@tanstack/react-query';
import { queries } from '@lefi/api';
import { toneVars } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { roleColor } from '../../shared/lib/roles';
import { Avatar, Icon, Skeleton, Switch } from '../../shared/ui';
import { statusTone } from './presentation';
import { useWorkforceActions } from './useWorkforceActions';
import styles from './workforce.module.css';

/** Selected person: role, zone access, notification preferences, recent changes. */
export function PersonPanel({ id }: { id: string }) {
  const q = useQuery(queries.workforcePerson(usePlatform(), id));
  const act = useWorkforceActions();
  if (q.isPending) return <Skeleton height={480} />;
  if (q.isError) return <span className={styles.faint}>{describeError(q.error)}</span>;
  const p = q.data;
  const st = toneVars(statusTone(p.status));
  const n = p.notifications;
  const upd = (body: Parameters<typeof act.update.mutate>[0]['body']) =>
    act.update.mutate({ id: p.id, body });
  return (
    <aside className={styles.panel} aria-label={`${p.name} profile`}>
      <div className={styles.head}>
        <Avatar name={p.name} size={56} color={roleColor(p.role_id)} />
        <div className={styles.headText}>
          <span className={styles.name}>{p.name}</span>
          <span className={styles.faint}>
            {p.email} · {p.phone}
          </span>
          <span className={styles.status} style={{ background: st.bg, color: st.fg }}>
            {p.status} · last active {p.last_active}
          </span>
        </div>
      </div>

      <label className={styles.field}>
        Assigned role
        <select
          key={p.role_id}
          defaultValue={p.role_id}
          title={p.actions.change_role.reason ?? undefined}
          data-locked={!p.actions.change_role.allowed}
          onChange={(e) => {
            const v = e.target.value;
            if (!p.actions.change_role.allowed) e.target.value = p.role_id;
            act.guarded(p.actions.change_role, () => upd({ role: v }))();
          }}
        >
          {p.roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.block}>
        <span className={styles.label}>Greenhouse &amp; zone access</span>
        <div className={styles.chips} role="group" aria-label="Zone access">
          {p.zone_access.map((z) => (
            <button
              key={z.id}
              type="button"
              className={styles.chip}
              aria-pressed={z.on}
              data-locked={!p.actions.edit_zones.allowed}
              title={p.actions.edit_zones.reason ?? undefined}
              onClick={act.guarded(p.actions.edit_zones, () => upd({ zone: z.id }))}
            >
              {z.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.block}>
        <div className={styles.notifyGrid} role="row">
          <span className={styles.eyebrow}>Notifications</span>
          {n.channels.map((c) => (
            <span
              key={c.key}
              className={styles.eyebrowCenter}
              title={c.available.reason ?? undefined}
            >
              {c.label}
              {!c.available.allowed && <Icon name="lock" size={12} />}
            </span>
          ))}
        </div>
        {n.events.map((ev) => (
          <div key={ev.key} className={styles.notifyGrid} role="row">
            <span>{ev.label}</span>
            {n.channels.map((c, i) => {
              const av = !n.can_edit.allowed ? n.can_edit : c.available;
              return (
                <span key={c.key} className={styles.center}>
                  <Switch
                    label={`${ev.label} · ${c.label}`}
                    on={ev.on[i] ?? false}
                    disabled={!av.allowed}
                    title={av.reason ?? undefined}
                    onChange={act.guarded(av, () =>
                      upd({ notify: { event: ev.key, channel: c.key } }),
                    )}
                  />
                </span>
              );
            })}
          </div>
        ))}
      </div>

      <div className={styles.block}>
        <span className={styles.label}>Recent changes</span>
        {p.recent.length === 0 && <span className={styles.faint}>No changes recorded.</span>}
        {p.recent.map((r) => (
          <div key={`${r.at}-${r.action}-${r.detail}`} className={styles.recent}>
            <span className={styles.mono}>{r.at}</span>
            <span>
              {r.action} · {r.detail}
              {r.user !== p.name && <span className={styles.faint}> · by {r.user}</span>}
            </span>
          </div>
        ))}
      </div>

      <button
        type="button"
        className={styles.danger}
        data-locked={!p.actions.deactivate.allowed}
        title={p.actions.deactivate.reason ?? undefined}
        disabled={act.deactivate.isPending}
        onClick={act.guarded(p.actions.deactivate, () => act.deactivate.mutate(p.id))}
      >
        {!p.actions.deactivate.allowed && <Icon name="lock" size={16} />}
        Revoke sessions &amp; deactivate
      </button>
    </aside>
  );
}
