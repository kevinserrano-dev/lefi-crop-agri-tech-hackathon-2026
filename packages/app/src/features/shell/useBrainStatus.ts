import { useQuery } from '@tanstack/react-query';
import { queries } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { isUnreachable } from '../../shared/lib/errors';
import { useBrainKind } from './useBrainKind';

/**
 * Brain status, polled. `connected` turns false when the last poll could not reach the Brain;
 * every screen then shows its last data as STALE (no invented values).
 */
export function useBrainStatus() {
  const platform = usePlatform();
  const kind = useBrainKind();
  // `/system/status` is the mock's proposal; the real Lefi Brain is watched through `/health`.
  const q = useQuery({ ...queries.systemStatus(platform), enabled: kind.serves('/system/status') });
  const connected = kind.mock ? !(q.isError && isUnreachable(q.error)) : kind.connected;
  return { ...q, connected, brainTime: q.data?.brain_time ?? kind.health.data?.time };
}
