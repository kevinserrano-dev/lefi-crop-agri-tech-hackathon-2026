import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { queries } from '@lefi/api';
import { severityTone } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { timeAgo } from '../../shared/lib/time';
import { Icon, ListRow } from '../../shared/ui';
import { useCan } from '../session';
import { alertIcon } from '../alerts/alertIcon';
import { LiveNotificationsMenu } from '../notifications/LiveNotificationsMenu';
import { useBrainKind } from './useBrainKind';
import styles from './shell.module.css';

/** The bell: this person's notifications from the real Lefi Brain (ADR-072), else the mock's alerts. */
export function NotificationsMenu({ brainTime }: { brainTime: string | undefined }) {
  const kind = useBrainKind();
  if (!kind.known) return null;
  if (!kind.mock) {
    return kind.serves('/notifications') ? <LiveNotificationsMenu brainTime={brainTime} /> : null;
  }
  return <MockNotificationsMenu brainTime={brainTime} />;
}

function MockNotificationsMenu({ brainTime }: { brainTime: string | undefined }) {
  const platform = usePlatform();
  const canAlerts = useCan('nav.alerts');
  const alerts = useQuery({ ...queries.alerts(platform), enabled: canAlerts });
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const count = alerts.data?.length ?? 0;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) =>
      ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className={styles.bellWrap} ref={ref}>
      <button
        type="button"
        className={styles.iconBtn}
        aria-label={`Notifications, ${count} active`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="notifications" size={20} />
        {count > 0 && <span className={styles.bellDot} />}
      </button>
      {open && (
        <div className={styles.popover} role="dialog" aria-label="Notifications">
          <div className={styles.popoverHead}>
            <span>Notifications</span>
            <span className={styles.muted}>{canAlerts ? `${count} active` : 'No access'}</span>
          </div>
          {alerts.data?.map((a) => (
            <button
              key={a.id}
              type="button"
              className={styles.popoverRow}
              title="Open the incident"
              onClick={() => {
                setOpen(false);
                void navigate({ to: '/alerts', search: { incident: a.id } });
              }}
            >
              <ListRow
                icon={alertIcon(a)}
                tone={severityTone[a.severity]}
                title={a.title}
                meta={`${a.zone_id ?? a.device_id ?? 'System'} · ${timeAgo(a.created_at, brainTime)}`}
              />
            </button>
          ))}
          {canAlerts && count === 0 && <div className={styles.popoverEmpty}>No open alerts.</div>}
          {canAlerts && (
            <button
              type="button"
              className={styles.popoverAll}
              onClick={() => {
                setOpen(false);
                void navigate({ to: '/alerts' });
              }}
            >
              View all alerts &amp; incidents
            </button>
          )}
        </div>
      )}
    </div>
  );
}
