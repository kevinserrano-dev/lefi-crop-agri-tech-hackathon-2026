import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  notificationKeys,
  notificationsApi,
  type BrainNotification,
  type NotificationLevel,
} from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { timeAgo } from '../../shared/lib/time';
import { Icon, ListRow, ProvenanceBadge, useToast } from '../../shared/ui';
import { useNotificationFeed } from './useNotificationFeed';
import styles from '../shell/shell.module.css';
import own from './notifications.module.css';

const TONE = { critical: 'crit', warning: 'warn', info: 'info' } as const;
const ICON: Record<BrainNotification['kind'], string> = {
  alert_raised: 'warning',
  alert_escalated: 'priority_high',
  incident_reported: 'report',
  assigned: 'assignment_ind',
  incident_resolved: 'task_alt',
  task_waiting: 'pending_actions',
  handover: 'sync_alt',
  escalation: 'campaign',
};
const LEVELS: Array<[NotificationLevel, string]> = [
  ['critical', 'Critical only'],
  ['warning', 'Warnings and critical'],
  ['info', 'Everything'],
  ['off', 'Nothing (assignments still arrive)'],
];

/**
 * The bell against the real Lefi Brain (ADR-072): this person's notifications, made by Lefi Brain
 * from alerts and incidents. Opening one marks it read and shows its alert.
 */
export function LiveNotificationsMenu({ brainTime }: { brainTime: string | undefined }) {
  const platform = usePlatform();
  const qc = useQueryClient();
  const toast = useToast((t) => t.show);
  const feed = useNotificationFeed(true);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const done = () => void qc.invalidateQueries({ queryKey: notificationKeys.mine });
  const read = useMutation({
    mutationFn: (ids?: string[]) => notificationsApi.read(platform, ids),
    onSuccess: done,
    onError: (e) => toast(describeError(e), 'bad'),
  });
  const pref = useMutation({
    mutationFn: (v: NotificationLevel) => notificationsApi.setPreference(platform, v),
    onSuccess: () => {
      done();
      toast('Saved: Lefi Brain will notify you accordingly.', 'ok');
    },
    onError: (e) => toast(describeError(e), 'bad'),
  });
  const data = feed.data;
  const unread = data?.unread ?? 0;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) =>
      ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const openOne = (n: BrainNotification) => {
    setOpen(false);
    if (!n.read) read.mutate([n.id]);
    if (n.alert_id) void navigate({ to: '/alerts', search: { alert: n.alert_id } });
  };

  return (
    <div className={styles.bellWrap} ref={ref}>
      <button
        type="button"
        className={styles.iconBtn}
        aria-label={`Notifications, ${unread} unread`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="notifications" size={20} />
        {unread > 0 && <span className={own.count}>{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className={styles.popover} role="dialog" aria-label="Notifications">
          <div className={styles.popoverHead}>
            <span>Notifications</span>
            {unread > 0 ? (
              <button type="button" className={own.link} onClick={() => read.mutate(undefined)}>
                Mark all read
              </button>
            ) : (
              <span className={styles.muted}>All read</span>
            )}
          </div>
          {feed.isError && <div className={styles.popoverEmpty}>{describeError(feed.error)}</div>}
          {data?.items.length === 0 && (
            <div className={styles.popoverEmpty}>
              Nothing yet. Lefi Brain notifies you about alerts and incidents.
            </div>
          )}
          <div className={own.list}>
            {data?.items.map((n) => (
              <button
                key={n.id}
                type="button"
                className={styles.popoverRow}
                data-unread={!n.read || undefined}
                onClick={() => openOne(n)}
              >
                <ListRow
                  icon={ICON[n.kind]}
                  tone={TONE[n.severity]}
                  title={n.title}
                  meta={`${timeAgo(n.created_at, brainTime)}${
                    n.alert_status === 'resolved' ? ' · resolved since' : ''
                  }`}
                />
                {n.origin === 'SIMULATED' && <ProvenanceBadge origin="SIMULATED" />}
              </button>
            ))}
          </div>
          {data && (
            <label className={own.pref}>
              Notify me about
              <select
                value={data.preference}
                disabled={pref.isPending}
                onChange={(e) => pref.mutate(e.target.value as NotificationLevel)}
              >
                {LEVELS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          )}
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
        </div>
      )}
    </div>
  );
}
