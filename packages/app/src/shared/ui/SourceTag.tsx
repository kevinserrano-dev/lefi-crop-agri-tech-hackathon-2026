import type { ReadingSource } from '@lefi/api';
import type { Freshness, Origin } from '@lefi/ui';
import { Badge } from './Badge';
import { ProvenanceBadge } from './Provenance';

/**
 * Where a reading comes from: a model estimate (no sensor installed) is never shown as a
 * measurement; otherwise provenance/freshness as usual.
 */
export function SourceTag({
  source,
  origin,
  freshness,
}: {
  source: ReadingSource;
  origin: Origin;
  freshness?: Freshness;
}) {
  if (source === 'estimate') {
    return (
      <Badge
        tone="sim"
        variant="tag"
        title="Model estimate — no sensor installed. Not a measurement."
      >
        ESTIMATE
      </Badge>
    );
  }
  return <ProvenanceBadge origin={origin} {...(freshness ? { freshness } : {})} />;
}
