import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, type BrainEndpoint, type Platform } from '@lefi/platform';
import { usePlatform } from '../../platform/PlatformContext';

/** `GET /api/v1/health` of the Brain (public, no session needed). */
export interface BrainHealth {
  status: string;
  service: string;
  version: string;
}

/**
 * Can this PC sign in? Decided before showing the sign-in form, so nobody types a password into
 * a form that cannot work.
 * - `not_set_up`: this PC knows no Brain (never paired, none found, none set) and none answers.
 * - `unreachable`: a known Brain address does not answer (PC off, other network, service stopped).
 * - `brain_down`: the main PC's gateway answers, but the Brain behind it does not (HTTP 5xx).
 * - `not_allowed`: the Brain or its gateway refuses this PC (not paired, or revoked).
 * - `not_a_brain`: something else answers at that address.
 */
export type BrainGate =
  | { kind: 'checking' }
  | { kind: 'ready'; version: string }
  | { kind: 'not_set_up' }
  | { kind: 'unreachable' }
  | { kind: 'brain_down' }
  | { kind: 'not_allowed' }
  | { kind: 'not_a_brain' };

export function deriveGate(input: {
  pending: boolean;
  health: BrainHealth | undefined;
  error: unknown;
  /** The Brain this PC knows; `undefined` when it knows none. */
  source: BrainEndpoint['source'] | undefined;
  paired: boolean;
}): BrainGate {
  const { pending, health, error, source, paired } = input;
  if (error) {
    if (error instanceof ApiError) {
      if (error.status >= 500) return { kind: 'brain_down' };
      if (error.status === 401 || error.status === 403) return { kind: 'not_allowed' };
      return { kind: 'not_a_brain' };
    }
    return source === undefined && !paired ? { kind: 'not_set_up' } : { kind: 'unreachable' };
  }
  if (health) {
    return health.service === 'lefi-brain' && health.status === 'ok'
      ? { kind: 'ready', version: health.version }
      : { kind: 'not_a_brain' };
  }
  return pending ? { kind: 'checking' } : { kind: 'unreachable' };
}

const sameGate = (a: BrainGate, b: BrainGate) =>
  a.kind === b.kind && (a.kind !== 'ready' || (b.kind === 'ready' && a.version === b.version));

const RETRY_MS = 5_000;
const PAIRED_WATCH_MS = 15_000;
const WATCH_MS = 30_000;

/** The gate, re-checked by itself: every few seconds while the Brain is away. */
export function useBrainGate() {
  const platform: Platform = usePlatform();
  const health = useQuery({
    queryKey: ['brain', 'health'],
    queryFn: () => platform.api<BrainHealth>({ method: 'GET', path: '/health' }),
    retry: false,
    refetchInterval: (q) => (q.state.status === 'success' ? WATCH_MS : RETRY_MS),
  });
  // Re-read while no Brain is known: Lefi Crop Helper may pair this PC by itself meanwhile (ADR-048).
  const brains = useQuery({
    queryKey: ['platform', 'brains'],
    queryFn: () => platform.discoverBrain(),
    // Also while paired (a cheap local call): a pairing reset by Lefi Crop Helper is noticed.
    refetchInterval: (q) => (q.state.data?.length ? PAIRED_WATCH_MS : RETRY_MS),
  });
  const device = useQuery({
    queryKey: ['platform', 'device'],
    queryFn: () => platform.device(),
    refetchInterval: (q) => (q.state.data ? PAIRED_WATCH_MS : RETRY_MS),
  });
  const endpoint = brains.data?.[0];
  const derived = deriveGate({
    // The answer depends on where the address came from: wait for that too.
    pending: health.isPending || brains.isPending || device.isPending,
    health: health.data,
    error: brains.isPending || device.isPending ? null : health.error,
    source: endpoint?.source,
    paired: !!device.data,
  });
  // Once an answer is known, a re-check never shows "Looking for Lefi Brain…" again: the page only
  // changes when the answer does, so nothing on it flickers or loses what was typed.
  const [last, setLast] = useState<BrainGate>(derived);
  if (derived.kind !== 'checking' && !sameGate(derived, last)) setLast(derived);
  const gate = derived.kind === 'checking' ? last : derived;
  return {
    gate,
    url: endpoint?.url,
    checking: health.isFetching,
    retry: () => void health.refetch(),
  };
}
