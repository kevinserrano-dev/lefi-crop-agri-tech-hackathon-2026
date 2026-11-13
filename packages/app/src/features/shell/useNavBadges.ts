import { useQuery } from '@tanstack/react-query';
import { queries, type NavCounters } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { useBrainKind } from './useBrainKind';

export type NavBadges = NavCounters;

/** Sidebar counters, computed by the Brain for the signed-in user. */
export function useNavBadges(): NavBadges {
  const platform = usePlatform();
  const kind = useBrainKind();
  return (
    useQuery({ ...queries.navCounters(platform), enabled: kind.serves('/nav/counters') }).data ?? {}
  );
}
