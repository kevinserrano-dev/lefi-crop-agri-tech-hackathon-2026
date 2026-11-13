import { ApiError, BrainUnreachableError, NotSupportedError } from './errors';
import { buildApiPath } from './request';
import { MjpegParser } from './mjpeg';
import { createSocketHub } from './socket';
import type { CameraStream, Platform } from './types';

/** An MJPEG response read part by part (cameras, ADR-079; robot views, ADR-091). */
function fetchStream(path: string, onFrame: (jpeg: Uint8Array) => void): CameraStream {
  const abort = new AbortController();
  const done = (async () => {
    let res: Response;
    try {
      res = await fetch(path, { credentials: 'same-origin', signal: abort.signal });
    } catch (err) {
      if (abort.signal.aborted) return { frames: 0 };
      throw new BrainUnreachableError(err);
    }
    if (!res.ok || !res.body) {
      const text = await res.text();
      throw new ApiError(res.status, text ? (JSON.parse(text) as unknown) : null);
    }
    const reader = res.body.getReader();
    const parser = new MjpegParser();
    let frames = 0;
    try {
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        parser.push(value);
        for (let f = parser.next(); f; f = parser.next()) {
          frames += 1;
          onFrame(f);
        }
      }
    } catch (err) {
      if (!abort.signal.aborted) throw err;
    }
    return { frames };
  })();
  return { done, stop: () => abort.abort() };
}

/**
 * Browser implementation. Same-origin requests; the session is an httpOnly cookie set by
 * the Brain, so no token is ever readable from JavaScript.
 * Used for development and tests only — the web admin is deferred (ADR-022).
 */
export function createWebPlatform(): Platform {
  const memorySecrets = new Map<string, string>();
  const wsUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

  return {
    kind: 'web',

    cameraStream(cameraId, onFrame) {
      return fetchStream(`/api/v1/cameras/${encodeURIComponent(cameraId)}/stream`, onFrame);
    },

    robotStream(robotId, feed, onFrame) {
      const path = `/api/v1/robots/${encodeURIComponent(robotId)}/stream/${encodeURIComponent(feed)}`;
      return fetchStream(path, onFrame);
    },

    async api<T>(req: Parameters<Platform['api']>[0]): Promise<T> {
      let res: Response;
      try {
        res = await fetch(buildApiPath(req), {
          method: req.method,
          credentials: 'same-origin',
          headers: req.body === undefined ? {} : { 'content-type': 'application/json' },
          body: req.body === undefined ? null : JSON.stringify(req.body),
        });
      } catch (err) {
        throw new BrainUnreachableError(err);
      }
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        throw new BrainUnreachableError(`HTTP ${res.status}`);
      }
      const text = await res.text();
      const body: unknown = text ? JSON.parse(text) : null;
      if (!res.ok) throw new ApiError(res.status, body);
      return body as T;
    },

    subscribe: createSocketHub(wsUrl),

    notify({ title, body }) {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title, { body });
      }
    },

    // Browser has no OS keychain; values live only for this tab's lifetime (never localStorage).
    secrets: {
      async get(k) {
        return memorySecrets.get(k) ?? null;
      },
      async set(k, v) {
        memorySecrets.set(k, v);
      },
      async del(k) {
        memorySecrets.delete(k);
      },
    },

    async discoverBrain() {
      return [{ name: 'This origin', url: location.origin, source: 'config' }];
    },

    // Browser development only (ADR-022): there is no network discovery, only this origin.
    async findBrains() {
      return [];
    },

    async device() {
      return null;
    },

    async forgetPairing() {
      throw new NotSupportedError('Device pairing');
    },

    async pair() {
      throw new NotSupportedError('Device pairing');
    },

    async pairingStatus() {
      return null;
    },
  };
}
