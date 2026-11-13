/**
 * Error raised for any non-2xx answer from the Brain. The Brain always answers
 * `{ "error": { "code", "message", "details" } }` (services/brain `core/errors.py`).
 */
export class ApiError extends Error {
  readonly status: number;
  /** Machine-readable code (`INVALID_CREDENTIALS`, `FORBIDDEN`, …), when the body has one. */
  readonly code: string | undefined;
  /** The Brain's human message, when it sent one. */
  readonly brainMessage: string | undefined;
  readonly details: Record<string, unknown>;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    const err = readError(body);
    super(`Brain answered ${status}${err.code ? ` (${err.code})` : ''}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = err.code;
    this.brainMessage = err.message;
    this.details = err.details;
    this.body = body;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  get isDeviceRevoked(): boolean {
    return this.code === 'DEVICE_REVOKED';
  }
}

/** The Brain could not be reached at all (network down, Brain stopped, TLS failure). */
export class BrainUnreachableError extends Error {
  constructor(cause?: unknown) {
    super('Brain unreachable', { cause });
    this.name = 'BrainUnreachableError';
  }
}

/** The current platform cannot do this (e.g. pairing in a browser). */
export class NotSupportedError extends Error {
  constructor(what: string) {
    super(`${what} is not supported on this platform`);
    this.name = 'NotSupportedError';
  }
}

interface ParsedError {
  code: string | undefined;
  message: string | undefined;
  details: Record<string, unknown>;
}

function readError(body: unknown): ParsedError {
  const inner =
    body && typeof body === 'object' && 'error' in body
      ? (body as { error: unknown }).error
      : undefined;
  if (!inner || typeof inner !== 'object')
    return { code: undefined, message: undefined, details: {} };
  const { code, message, details } = inner as Record<string, unknown>;
  return {
    code: typeof code === 'string' ? code : undefined,
    message: typeof message === 'string' && message ? message : undefined,
    details: details && typeof details === 'object' ? (details as Record<string, unknown>) : {},
  };
}
