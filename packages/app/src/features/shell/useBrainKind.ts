import { useQuery } from '@tanstack/react-query';
import { endpoints, isMockBrain, servedByBrain } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { isUnreachable } from '../../shared/lib/errors';

const WATCH_MS = 30_000;

/**
 * Which Brain answers: the development mock (everything is labelled sample data) or the real
 * Lefi Brain (only what its OpenAPI document lists is asked for; ADR-049).
 */
export function useBrainKind() {
  const platform = usePlatform();
  const health = useQuery({
    queryKey: ['brain', 'health'],
    queryFn: () => endpoints.health(platform),
    retry: false,
    refetchInterval: WATCH_MS,
  });
  const mock = isMockBrain(health.data);
  return {
    health,
    /** Known only once health answered; until then nothing is asked that the real Brain lacks. */
    mock,
    known: health.isSuccess,
    connected: !(health.isError && isUnreachable(health.error)),
    /** True when this Brain serves `path` (the mock serves the whole proposal). */
    serves: (path: string) => mock || servedByBrain(path),
  };
}
