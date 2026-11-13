import { ApiError, BrainUnreachableError } from '@lefi/platform';

export const isForbidden = (e: unknown) => e instanceof ApiError && e.isForbidden;
export const isUnauthorized = (e: unknown) => e instanceof ApiError && e.isUnauthorized;
export const isUnreachable = (e: unknown) => e instanceof BrainUnreachableError;

/** Short human message for an error coming from the platform. */
export function describeError(e: unknown): string {
  if (e instanceof BrainUnreachableError) return 'Lefi Brain could not be reached.';
  if (e instanceof ApiError) {
    if (e.brainMessage) return e.brainMessage;
    if (e.isDeviceRevoked) return 'This device has been revoked.';
    if (e.isUnauthorized) return 'Your session has ended. Sign in again.';
    if (e.isForbidden) return 'Your role does not allow this.';
    return `Lefi Brain refused the request (${e.status}${e.code ? `, ${e.code}` : ''}).`;
  }
  return e instanceof Error ? e.message : 'Unexpected error.';
}
