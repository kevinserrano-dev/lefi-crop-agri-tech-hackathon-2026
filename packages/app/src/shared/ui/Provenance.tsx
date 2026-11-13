import type { Freshness, Origin } from '@lefi/ui';
import { Badge } from './Badge';

/**
 * Provenance is always visible (ADR-012): simulated data says SIMULATED; stale or offline
 * data says so instead of looking live.
 */
export function ProvenanceBadge({ origin, freshness }: { origin: Origin; freshness?: Freshness }) {
  if (freshness && freshness !== 'LIVE') {
    const tone = freshness === 'STALE' ? 'warn' : freshness === 'ERROR' ? 'crit' : 'off';
    const label = freshness === 'OFFLINE' ? 'UNAVAILABLE' : freshness;
    return (
      <Badge tone={tone} variant="tag" title={`Data ${label.toLowerCase()}`}>
        {origin === 'SIMULATED' ? `SIM · ${label}` : label}
      </Badge>
    );
  }
  return origin === 'SIMULATED' ? (
    <Badge tone="sim" variant="tag" title="Simulated data — not from real hardware">
      SIMULATED
    </Badge>
  ) : (
    <Badge tone="ok" variant="tag">
      LIVE
    </Badge>
  );
}
