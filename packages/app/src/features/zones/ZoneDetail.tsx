import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { queries } from '@lefi/api';
import { toneVars } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { roleColor } from '../../shared/lib/roles';
import { Avatar, Icon, ProvenanceBadge, Skeleton } from '../../shared/ui';
import { CATEGORY_ICON, MODES, statusTone } from '../devices/presentation';
import styles from './zones.module.css';

const dueText = (d: number | null) =>
  d === null ? '—' : d < 0 ? `Overdue ${-d} d` : d === 0 ? 'Today' : `In ${d} d`;
const dueColor = (d: number | null) =>
  d === null
    ? 'var(--lefi-text-faint)'
    : d < 0
      ? 'var(--lefi-crit-fg)'
      : d <= 14
        ? 'var(--lefi-warn-fg)'
        : 'var(--lefi-text-strong)';

function ModePill({ mode }: { mode: keyof typeof MODES }) {
  const t = toneVars(MODES[mode].tone);
  return (
    <span className={styles.pill} style={{ background: t.bg, color: t.fg }}>
      {MODES[mode].label}
    </span>
  );
}

/** Zone setup and everything assigned to it, as the Brain reports it. */
export function ZoneDetail({ id }: { id: string }) {
  const q = useQuery(queries.zoneInventory(usePlatform(), id));
  const navigate = useNavigate();
  if (q.isPending) return <Skeleton height={600} />;
  if (q.isError) return <span className={styles.faint}>{describeError(q.error)}</span>;
  const z = q.data;
  return (
    <section className={styles.detail} aria-label={`Zone ${z.id}`}>
      <div className={styles.detailHead}>
        <span className={styles.zoneIdBig}>{z.id}</span>
        <span className={styles.zoneName}>{z.name}</span>
        <span className={styles.muted}>{z.greenhouse_name}</span>
        {z.custom && <span className={styles.customTag}>Created manually</span>}
        <ProvenanceBadge origin={z.origin} />
      </div>
      <div className={styles.params}>
        {z.params.map((p) => (
          <div key={p.label} className={styles.param}>
            <span>{p.label}</span>
            <b>{p.value}</b>
          </div>
        ))}
      </div>

      <div className={styles.block}>
        <span className={styles.eyebrow}>Device inventory · {z.devices.length} devices</span>
        <div className={styles.invWrap}>
          <div className={styles.inv} role="table" aria-label="Device inventory">
            {z.devices.map((d) => {
              const t = toneVars(statusTone(d.status));
              return (
                <button
                  key={d.id}
                  type="button"
                  role="row"
                  className={styles.invRow}
                  title="Open in Devices & Health"
                  onClick={() => void navigate({ to: '/devices', search: { device: d.id } })}
                >
                  <span className={styles.invId}>
                    <Icon
                      name={CATEGORY_ICON[d.category]}
                      size={16}
                      color="var(--lefi-forest-600, #2e6b57)"
                    />
                    <span className={styles.mono}>{d.id}</span>
                  </span>
                  <span className={styles.ellipsis}>
                    {d.brand} {d.model}
                  </span>
                  <span className={styles.status} style={{ color: t.fg }}>
                    <i style={{ background: t.dot }} />
                    {d.status}
                  </span>
                  <b style={{ color: dueColor(d.due_days) }}>{dueText(d.due_days)}</b>
                  <ModePill mode={d.mode} />
                </button>
              );
            })}
            {z.devices.length === 0 && (
              <div className={styles.none}>
                No devices in this zone yet. Devices join a zone when they announce themselves and
                are approved, or when you register them in Devices &amp; Health.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.twoCol}>
        <div className={styles.block}>
          <span className={styles.eyebrow}>Robots &amp; drones assigned</span>
          {z.robots.map((r) => (
            <button
              key={r.id}
              type="button"
              className={styles.robot}
              onClick={() => void navigate({ to: '/robots', search: { robot: r.id } })}
            >
              <Icon name="smart_toy" size={18} color="var(--lefi-sim-fg, #5b3fa0)" />
              <b className={styles.mono}>{r.id}</b>
              <span className={styles.grow}>{r.type}</span>
              <ModePill mode={r.mode} />
            </button>
          ))}
          {z.robots.length === 0 && <span className={styles.faint}>No robots assigned.</span>}
        </div>
        <div className={styles.block}>
          <span className={styles.eyebrow}>Crew assigned</span>
          <div className={styles.crew}>
            {z.crew.map((e) => (
              <span key={e.name} className={styles.person}>
                <Avatar name={e.name} size={22} color={roleColor(e.role_id)} />
                {e.name} <span className={styles.faint}>· {e.role_label}</span>
              </span>
            ))}
            {z.crew.length === 0 && <span className={styles.faint}>Nobody assigned.</span>}
          </div>
        </div>
      </div>

      <div className={styles.block}>
        <span className={styles.eyebrow}>Upcoming maintenance</span>
        {z.maintenance.map((m) => (
          <div key={m.device_id} className={styles.maintRow}>
            <span className={styles.mono}>{m.device_id}</span>
            <span className={styles.grow}>{m.type}</span>
            <span className={styles.mono}>{m.date}</span>
            <b style={{ color: dueColor(m.due_days) }}>{dueText(m.due_days)}</b>
          </div>
        ))}
        {z.maintenance.length === 0 && <span className={styles.faint}>Nothing scheduled.</span>}
      </div>
    </section>
  );
}
