import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { notificationQueries, type BrainNotification } from '@lefi/api';
import type { Severity } from '@lefi/platform';
import { usePlatform } from '../../platform/PlatformContext';

const LEVEL: Record<BrainNotification['severity'], Severity> = {
  critical: 'critical',
  warning: 'warning',
  info: 'info',
};

/**
 * The person's notifications from Lefi Brain, polled while the app runs (no cloud push: ADR-072).
 * Each one that arrives while the app is open is also shown by the operating system, once; what
 * was already there when the app started is only in the bell, never popped up again.
 */
export function useNotificationFeed(enabled: boolean) {
  const platform = usePlatform();
  const q = useQuery({ ...notificationQueries.mine(platform), enabled });
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!q.data) return;
    if (seen.current === null) {
      seen.current = new Set(q.data.items.map((n) => n.id));
      return;
    }
    for (const n of [...q.data.items].reverse()) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      if (n.read) continue;
      const sim = n.origin === 'SIMULATED' ? ' (SIMULATED)' : '';
      platform.notify({ title: `${n.title}${sim}`, body: n.body, severity: LEVEL[n.severity] });
    }
  }, [q.data, platform]);
  return q;
}
