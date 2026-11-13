import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, type CameraStream } from '@lefi/platform';
import { usePlatform } from '../../platform/PlatformContext';

export type VideoPhase = 'connecting' | 'live' | 'reconnecting' | 'error' | 'off';

export interface LiveVideo {
  phase: VideoPhase;
  error?: unknown;
  fps: number;
  width?: number;
  height?: number;
  /** False where the platform has no live stream (then the panel shows snapshots). */
  supported: boolean;
}

/** Errors worth trying again by themselves: the stream will come back without anyone acting. */
function retryable(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true; // Lefi Brain unreachable for a moment
  if (e.code === 'FRAME_UNAVAILABLE') return e.details.reason !== 'permission_denied';
  return e.status >= 500;
}

type Opener = (onFrame: (jpeg: Uint8Array) => void) => CameraStream;

/**
 * A camera's live video (ADR-079), drawn on a canvas as frames arrive. Only the newest frame is
 * decoded (late ones are skipped), so the picture never lags behind the camera.
 */
export function useLiveVideo(
  cameraId: string,
  enabled: boolean,
): [React.RefObject<HTMLCanvasElement | null>, LiveVideo] {
  const platform = usePlatform();
  const open = useMemo<Opener | undefined>(
    () => (platform.cameraStream ? (cb) => platform.cameraStream!(cameraId, cb) : undefined),
    [platform, cameraId],
  );
  return useStreamVideo(open, enabled);
}

/** A simulated robot view (ADR-091), with the same drawing and reconnection rules. */
export function useRobotVideo(
  robotId: string,
  feed: string,
  enabled: boolean,
): [React.RefObject<HTMLCanvasElement | null>, LiveVideo] {
  const platform = usePlatform();
  const open = useMemo<Opener | undefined>(
    () => (platform.robotStream ? (cb) => platform.robotStream!(robotId, feed, cb) : undefined),
    [platform, robotId, feed],
  );
  return useStreamVideo(open, enabled);
}

function useStreamVideo(
  open: Opener | undefined,
  enabled: boolean,
): [React.RefObject<HTMLCanvasElement | null>, LiveVideo] {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<Omit<LiveVideo, 'supported'>>({
    phase: 'off',
    fps: 0,
  });
  const supported = open !== undefined;

  useEffect(() => {
    if (!enabled || !open) return;
    let stopped = false;
    let handle: ReturnType<typeof open> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    let pending: Uint8Array | null = null;
    let count = 0;
    let shown = false;
    let size: [number, number] | undefined;

    const draw = async (jpeg: Uint8Array) => {
      if (busy) {
        pending = jpeg; // decode only the newest
        return;
      }
      busy = true;
      try {
        if (typeof createImageBitmap === 'function') {
          const bmp = await createImageBitmap(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }));
          const c = canvas.current;
          if (c && !stopped) {
            if (c.width !== bmp.width || c.height !== bmp.height) {
              c.width = bmp.width;
              c.height = bmp.height;
            }
            c.getContext('2d')?.drawImage(bmp, 0, 0);
            size = [bmp.width, bmp.height];
          }
          bmp.close();
        }
        count += 1;
        if (!shown) {
          shown = true; // the first picture: live at once, not a second later
          setState((s) => ({ ...s, phase: 'live', error: undefined }));
        }
      } catch {
        // a frame that does not decode is skipped
      } finally {
        busy = false;
        const next = pending;
        pending = null;
        if (next && !stopped) void draw(next);
      }
    };

    const tick = setInterval(() => {
      if (stopped) return;
      const fps = count;
      count = 0;
      setState((s) =>
        s.phase === 'live' || fps > 0
          ? { phase: 'live', fps, width: size?.[0], height: size?.[1] }
          : s,
      );
    }, 1000);

    const start = (phase: VideoPhase) => {
      shown = false;
      setState((s) => ({ ...s, phase, error: undefined }));
      handle = open((f) => void draw(f));
      handle.done.then(
        () => {
          if (stopped) return;
          setState((s) => ({ ...s, phase: 'reconnecting', fps: 0 }));
          retry = setTimeout(() => start('reconnecting'), 1500);
        },
        (e: unknown) => {
          if (stopped) return;
          setState({ phase: 'error', error: e, fps: 0 });
          if (retryable(e)) retry = setTimeout(() => start('reconnecting'), 3000);
        },
      );
    };
    start('connecting');
    return () => {
      stopped = true;
      clearInterval(tick);
      clearTimeout(retry);
      handle?.stop();
    };
  }, [open, enabled]);

  const info: LiveVideo =
    enabled && supported ? { supported, ...state } : { supported, phase: 'off', fps: 0 };
  return [canvas, info];
}
