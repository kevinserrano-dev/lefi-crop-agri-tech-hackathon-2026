import { Channel, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { ApiError, BrainUnreachableError } from './errors';
import { buildApiPath } from './request';
import type {
  BrainEndpoint,
  BrainEvent,
  CameraStream,
  DeviceIdentity,
  FoundBrain,
  PairingStatus,
  Platform,
} from './types';

/** Rust commands reject with a plain message; turn it into an Error the UI can show. */
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }
}

interface RustApiResponse {
  status: number;
  body: unknown;
}

/**
 * Tauri implementation. Every request leaves from Rust (`api_request`), which joins the
 * relative path to the configured Brain and holds the session cookie and, once pairing
 * exists, the device certificate. Nothing secret crosses into the WebView.
 */
let nextStreamId = 1;

function openStream(
  command: 'camera_stream' | 'robot_stream',
  args: Record<string, string>,
  onFrame: (jpeg: Uint8Array) => void,
): CameraStream {
  const streamId = nextStreamId++;
  const channel = new Channel<ArrayBuffer | number[]>();
  channel.onmessage = (m) =>
    onFrame(m instanceof ArrayBuffer ? new Uint8Array(m) : Uint8Array.from(m));
  const done = call<{ status: number; body: unknown; frames: number }>(command, {
    streamId,
    ...args,
    onFrame: channel,
  }).then(
    (end) => {
      if (end.status >= 400) throw new ApiError(end.status, end.body);
      return { frames: end.frames };
    },
    (err: unknown) => {
      throw new BrainUnreachableError(err);
    },
  );
  return {
    done,
    // Every stream, camera or robot view, is stopped by id in the same table.
    stop: () => void call('camera_stream_stop', { streamId }).catch(() => undefined),
  };
}

export function createTauriPlatform(): Platform {
  return {
    kind: 'tauri',

    // Rust reads the stream through the paired, pinned connection and hands each JPEG over a
    // binary channel (ADR-079): the WebView never talks to Lefi Brain itself.
    cameraStream(cameraId, onFrame) {
      return openStream('camera_stream', { cameraId }, onFrame);
    },

    robotStream(robotId, feed, onFrame) {
      return openStream('robot_stream', { robotId, feed }, onFrame);
    },

    async api<T>(req: Parameters<Platform['api']>[0]): Promise<T> {
      let res: RustApiResponse;
      try {
        res = await call<RustApiResponse>('api_request', {
          req: { method: req.method, path: buildApiPath(req), body: req.body ?? null },
        });
      } catch (err) {
        throw new BrainUnreachableError(err);
      }
      if (res.status >= 400) throw new ApiError(res.status, res.body);
      return res.body as T;
    },

    subscribe(topic, cb) {
      // Events are emitted by the Rust WebSocket client (milestone 4; not implemented yet).
      let off: (() => void) | undefined;
      let cancelled = false;
      void listen<BrainEvent>('brain:event', ({ payload }) => {
        if (topic === '*' || payload.topic === topic) cb(payload);
      }).then((un) => {
        if (cancelled) un();
        else off = un;
      });
      return () => {
        cancelled = true;
        off?.();
      };
    },

    notify({ title, body }) {
      // A notification of the operating system, made on this PC (ADR-072): nothing leaves the
      // LAN. Asked once; if the person refuses, the bell in the app still shows everything.
      void (async () => {
        try {
          let granted = await isPermissionGranted();
          if (!granted) granted = (await requestPermission()) === 'granted';
          if (granted) sendNotification({ title, body });
        } catch {
          // No notification service on this desktop: the in-app bell is enough.
        }
      })();
    },

    secrets: {
      get: (key) => call<string | null>('secret_get', { key }),
      set: (key, value) => call<void>('secret_set', { key, value }),
      del: (key) => call<void>('secret_del', { key }),
    },

    discoverBrain: () => call<BrainEndpoint[]>('discover_brain'),
    findBrains: () => call<FoundBrain[]>('find_brains'),
    device: () => call<DeviceIdentity | null>('device_identity'),
    pair: (url, code) => call<DeviceIdentity>('pair_device', { url, code }),
    forgetPairing: () => call<void>('forget_pairing'),
    pairingStatus: () => call<PairingStatus>('pairing_status'),
  };
}

/** True when running inside the Tauri WebView. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
