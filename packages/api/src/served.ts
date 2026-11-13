/**
 * What the real Lefi Brain serves today, read from its committed OpenAPI document (ADR-005,
 * ADR-045). A screen whose endpoint is not here must not pretend to work against the real Brain:
 * it says which Lefi Brain module is missing instead (ADR-049).
 */
import doc from '../openapi/brain.openapi.json';

const PREFIX = '/api/v1';

/** Paths relative to `/api/v1`, as `ApiRequest.path` uses them. */
export const BRAIN_PATHS: ReadonlySet<string> = new Set(
  Object.keys(doc.paths)
    .filter((p) => p.startsWith(PREFIX))
    .map((p) => p.slice(PREFIX.length)),
);

export function servedByBrain(path: string): boolean {
  return BRAIN_PATHS.has(path);
}

/** The development mock says so in its health answer; the real Brain never does. */
export function isMockBrain(health: unknown): boolean {
  return !!health && typeof health === 'object' && (health as { mock?: unknown }).mock === true;
}
