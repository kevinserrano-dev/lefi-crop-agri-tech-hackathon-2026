import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { queries, type DeviceDetail, type DeviceMode } from '@lefi/api';
import { toneVars } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { ActionButton, Badge, Button, Icon, Skeleton } from '../../shared/ui';
import { HealthBar } from './DeviceTable';
import {
  CATEGORY_ICON,
  CATEGORY_LABEL,
  dueColor,
  dueLabel,
  MODES,
  statusTone,
} from './presentation';
import { useDeviceActions } from './useDeviceActions';
import styles from './devices.module.css';

const MODE_ORDER: DeviceMode[] = ['on', 'ai', 'paused', 'off'];

export function DeviceDetailPanel({ id, onRejected }: { id: string; onRejected: () => void }) {
  const q = useQuery(queries.device(usePlatform(), id));
  if (q.isPending) return <Skeleton height={520} />;
  if (q.isError) return <div className={styles.panel}>{describeError(q.error)}</div>;
  return <Panel d={q.data} onRejected={onRejected} />;
}

function Panel({ d, onRejected }: { d: DeviceDetail; onRejected: () => void }) {
  const navigate = useNavigate();
  const act = useDeviceActions(d.id);
  const t = toneVars(statusTone(d.status));
  const robot = d.category === 'robot' || d.category === 'drone';
  const facts: Array<[string, string]> = [
    ['Brand', d.brand],
    ['Model', d.model],
    ['Serial number', d.serial],
    ['Category', CATEGORY_LABEL[d.category]],
    ['Greenhouse', d.greenhouse_id],
    ['Zone', d.zone_label],
    ['Exact position', d.position],
    ['Protocol', d.protocol],
    ['Firmware', d.firmware === '—' ? '—' : `v${d.firmware}`],
    ['Signal', d.signal],
    ['Battery', d.battery],
    ['Last seen', d.last_seen_label],
    ['Installed', d.installed],
    ['Warranty until', d.warranty_until],
  ];

  return (
    <aside className={styles.panel} aria-label={`Device ${d.id}`}>
      <div className={styles.panelHead}>
        <span className={styles.panelIcon}>{CATEGORY_ICON[d.category]}</span>
        <div className={styles.panelTitle}>
          <span className={styles.panelId}>{d.id}</span>
          <span className={styles.muted}>
            {d.type} · {d.location_label}
          </span>
        </div>
        <span className={styles.statusPill} style={{ background: t.bg, color: t.fg }}>
          <span className={styles.dot} style={{ background: t.dot }} />
          {d.status}
        </span>
      </div>
      {d.origin === 'SIMULATED' && (
        <span className={styles.simNote}>
          <Badge tone="sim" variant="tag">
            Simulated
          </Badge>{' '}
          Mock Brain record — brand, model and serial are prototype content.
        </span>
      )}

      {d.lifecycle === 'PENDING' && (
        <div className={styles.pending}>
          <Icon name="new_releases" size={20} />
          <div>
            <b>Waiting for approval</b>
            <span>
              This device announced itself (or was registered) and is not used until a technician
              approves it. Its readings are stored but excluded from rules and dashboards.
            </span>
            <div className={styles.row}>
              <ActionButton
                label="Approve"
                icon="check_circle"
                availability={d.actions.approve}
                busy={act.busy}
                onClick={() => act.approve.mutate()}
              />
              <ActionButton
                label="Reject"
                icon="block"
                availability={d.actions.reject}
                busy={act.busy}
                onClick={() => act.reject.mutate(undefined, { onSuccess: onRejected })}
              />
            </div>
          </div>
        </div>
      )}

      <section className={styles.section}>
        <span className={styles.sectionLabel}>Connection, AI access &amp; power</span>
        <div className={styles.modes}>
          {MODE_ORDER.map((m) => {
            const meta = MODES[m];
            const mt = toneVars(meta.tone);
            const selected = d.mode === m;
            const av = d.modes[m];
            const locked = !av.allowed && !selected;
            return (
              <button
                key={m}
                type="button"
                className={styles.mode}
                aria-pressed={selected}
                data-locked={locked}
                title={locked ? (av.reason ?? undefined) : meta.label}
                disabled={act.busy}
                style={selected ? { background: mt.bg, borderColor: mt.fg } : undefined}
                onClick={() => !selected && act.setMode.mutate(m)}
              >
                <Icon
                  name={locked ? 'lock' : meta.icon}
                  size={19}
                  color={selected ? mt.fg : 'var(--lefi-text-strong)'}
                />
                <span className={styles.modeText}>
                  <b style={selected ? { color: mt.fg } : undefined}>{meta.label}</b>
                  <span>{meta.sub}</span>
                </span>
              </button>
            );
          })}
        </div>
        <span className={styles.effect}>
          {MODES[d.mode].effect}
          {robot && d.mode === 'ai' ? ' Robots in this mode accept manual commands only.' : ''}
        </span>
        <span className={styles.power}>
          <Icon name="electrical_services" size={17} color="var(--lefi-forest-600)" />
          Power control: <b>{d.power_control}</b> · <em>not operated by LEFI CROP</em>
        </span>
        {d.category === 'actuator' && (
          <span className={styles.actuatorNote}>
            <Icon name="lock" size={15} /> Actuator · interface only. LEFI CROP never operates
            pumps, valves or relays.
          </span>
        )}
      </section>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>Health &amp; maintenance</span>
        <HealthBar value={d.health} large />
        <div className={styles.serviceGrid}>
          <div>
            <span>Last service</span>
            <b>{d.service.last}</b>
          </div>
          <div>
            <span>Next service</span>
            <b style={{ color: dueColor(d) }}>{dueLabel(d)}</b>
          </div>
          <div>
            <span>Interval</span>
            <b>{d.service.interval_days ? `Every ${d.service.interval_days} d` : '—'}</b>
          </div>
        </div>
      </section>

      <div className={styles.facts}>
        {facts.map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>Service history</span>
        {d.history.map((h, i) => (
          <div key={i} className={styles.histRow}>
            <span className={styles.mono}>{h.date}</span>
            <span className={styles.grow}>{h.what}</span>
            <span className={styles.muted}>{h.who}</span>
          </div>
        ))}
      </section>

      <div className={styles.row}>
        <ActionButton
          label="Schedule maintenance"
          icon="build"
          variant="solid"
          availability={d.actions.schedule_maintenance}
          busy={act.busy}
          onClick={() => act.maintenance.mutate()}
        />
        {d.zone_id && (
          <Button
            variant="secondary"
            onClick={() =>
              void navigate({ to: '/zones', search: { zone: d.zone_id ?? undefined } })
            }
          >
            Open zone
          </Button>
        )}
        {robot && (
          <button
            type="button"
            className={styles.robotBtn}
            onClick={() => void navigate({ to: '/robots', search: { robot: d.id } })}
          >
            Mission Center
          </button>
        )}
      </div>
    </aside>
  );
}
