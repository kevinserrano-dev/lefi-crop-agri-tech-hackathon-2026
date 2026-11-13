import type { ApiRequest } from './types';

/** Builds `/api/v1<path>?query`. Rejects anything that is not a plain relative path. */
export function buildApiPath(req: ApiRequest): string {
  if (!req.path.startsWith('/') || req.path.startsWith('//') || req.path.includes('://')) {
    throw new Error(`Invalid API path: ${req.path}`);
  }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query ?? {})) {
    if (v !== undefined) qs.set(k, String(v));
  }
  const q = qs.toString();
  return `/api/v1${req.path}${q ? `?${q}` : ''}`;
}
