import { useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  live,
  liveKeys,
  liveQueries,
  type Camera,
  type CameraCommand,
  type CameraPhoto,
  type CameraState,
  type NewCameraCommand,
} from '@lefi/api';
import { ApiError } from '@lefi/platform';
import type { Tone } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { stamp, timeAgo } from '../../shared/lib/time';
import {
  Badge,
  Button,
  Card,
  Dialog,
  Icon,
  ProvenanceBadge,
  Switch,
  useToast,
} from '../../shared/ui';
import { useLiveMutation } from './common';
import { AnalysisBox } from './AnalysisBox';
import { ZoneViewsPanel } from './ZoneViewsPanel';
import { useLiveVideo } from './useLiveVideo';
import styles from './live.module.css';

const STEP_DEG = 10;
const ZOOM_STEP = 10;

/** HH:MM:SS on this PC's clock (the time itself comes from Lefi Brain). */
const seconds = (iso: string) => new Date(iso).toLocaleTimeString([], { hour12: false });

const KIND_LABEL: Record<CameraCommand['kind'], string> = {
  wake: 'Wake',
  sleep: 'Sleep',
  recenter: 'Center',
  pan_tilt: 'Aim',
  zoom: 'Zoom',
};
const OUTCOME: Record<NonNullable<CameraCommand['outcome']>, { tone: Tone; label: string }> = {
  succeeded: { tone: 'ok', label: 'Done' },
  failed: { tone: 'crit', label: 'Failed' },
  refused: { tone: 'warn', label: 'Refused' },
};

/** Why there is no picture, in words a person can act on (ADR-074, ADR-079). */
export function videoProblem(e: unknown): string {
  if (e instanceof ApiError && e.code === 'FRAME_UNAVAILABLE') {
    const reason = e.details.reason;
    if (reason === 'permission_pending')
      return "macOS is asking for camera permission on Lefi Brain's Mac. Allow it there; the video starts by itself.";
    if (reason === 'permission_denied')
      return "macOS does not let Lefi Brain use the camera. On Lefi Brain's Mac: System Settings → Privacy & Security → Camera.";
  }
  if (e instanceof ApiError && e.code === 'CAMERA_NOT_CONNECTED')
    return "The camera is not plugged into Lefi Brain's PC now.";
  return describeError(e);
}

const clamp = (v: number, r: { min: number; max: number }) => Math.min(r.max, Math.max(r.min, v));

/**
 * One camera opened from Devices & Health (ADR-074, ADR-079): live video, photos, the position
 * read from the camera, its commands (device.manage), whether Lefi AI may use it, and every
 * command sent — by people or by Lefi AI for them.
 */
export function CameraPanel({
  camera,
  canManage,
  now,
  onClose,
  compact = false,
  stageRef,
}: {
  camera: Camera;
  canManage: boolean;
  now?: string;
  onClose: () => void;
  /** Inside a zone (ADR-087): video, controls and position only; photos are the zone's. */
  compact?: boolean;
  /** The video area, so a caller can focus it (keyboard controls) after scrolling to it. */
  stageRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const platform = usePlatform();
  const qc = useQueryClient();
  const toast = useToast((t) => t.show);
  const connected = camera.connection === 'connected' && camera.status === 'ACTIVE';
  const [videoOn, setVideoOn] = useState(true);
  const [viewing, setViewing] = useState<string>();
  const ownStage = useRef<HTMLDivElement>(null);
  const stage = stageRef ?? ownStage;
  const [canvas, video] = useLiveVideo(camera.id, connected && videoOn);
  // Where the platform cannot stream (e.g. tests, old shells): snapshots about twice a second.
  const snapshot = useQuery({
    ...liveQueries.cameraFrame(platform, camera.id),
    enabled: connected && videoOn && !video.supported,
  });
  const state = useQuery({
    ...liveQueries.cameraState(platform, camera.id),
    enabled: connected && camera.controls,
  });
  const history = useQuery({
    ...liveQueries.cameraCommands(platform, camera.id),
    enabled: !compact,
  });
  const photos = useQuery({ ...liveQueries.cameraPhotos(platform, camera.id), enabled: !compact });
  const places = useQuery({ ...liveQueries.places(platform), enabled: !compact });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: liveKeys.cameraState(camera.id) });
    void qc.invalidateQueries({ queryKey: liveKeys.cameraCommands(camera.id) });
  };
  const send = useMutation({
    mutationFn: (body: Omit<NewCameraCommand, 'id'>) =>
      live.sendCameraCommand(platform, camera.id, { id: crypto.randomUUID(), ...body }),
    onSuccess: (c) => {
      if (c.outcome === 'failed') toast(c.error ?? 'The camera did not do it', 'bad');
      refresh();
    },
    onError: (e) => {
      toast(describeError(e), 'bad');
      refresh();
    },
  });
  const shoot = useMutation({
    mutationFn: () => live.takePhoto(platform, camera.id),
    onSuccess: (p) => {
      toast('Photo taken', 'ok');
      void qc.invalidateQueries({ queryKey: liveKeys.cameraPhotos(camera.id) });
      void qc.invalidateQueries({ queryKey: ['live', 'cameras', 'zone-photos'] });
      setViewing(p.id);
    },
    onError: (e) => toast(videoProblem(e), 'bad'),
  });
  const aiAccess = useLiveMutation(
    (on: boolean) => live.updateCamera(platform, camera.id, { ai_control: on }),
    (c) => (c.ai_control ? 'Lefi AI may use this camera' : 'Lefi AI may no longer use this camera'),
  );

  const s: CameraState | undefined = state.data;
  const controlsOn = canManage && connected && camera.controls;
  const busy = send.isPending || !s;
  const aim = (dPan: number, dTilt: number) =>
    s &&
    send.mutate({
      kind: 'pan_tilt',
      pan: clamp(s.pan + dPan, s.pan_range),
      tilt: clamp(s.tilt + dTilt, s.tilt_range),
    });
  const zoom = (d: number) =>
    s && send.mutate({ kind: 'zoom', zoom: clamp(s.zoom + d, s.zoom_range) });
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    const act: Record<string, () => void> = {
      p: () => shoot.mutate(),
      ...(controlsOn && !busy
        ? {
            ArrowLeft: () => aim(STEP_DEG, 0),
            ArrowRight: () => aim(-STEP_DEG, 0),
            ArrowUp: () => aim(0, STEP_DEG),
            ArrowDown: () => aim(0, -STEP_DEG),
            '+': () => zoom(ZOOM_STEP),
            '-': () => zoom(-ZOOM_STEP),
            c: () => send.mutate({ kind: 'recenter' }),
          }
        : {}),
    };
    const run = act[e.key];
    if (run) {
      e.preventDefault();
      run();
    }
  };
  const fullscreen = () => void stage.current?.requestFullscreen?.();

  const overlay = !connected
    ? "No video: the camera is not plugged into Lefi Brain's PC now."
    : !videoOn
      ? 'Video paused. The camera stops capturing 30 s after the last image.'
      : video.supported
        ? video.phase === 'error'
          ? videoProblem(video.error)
          : video.phase === 'reconnecting'
            ? 'Reconnecting…'
            : video.phase === 'connecting'
              ? 'Starting the camera…'
              : null
        : snapshot.isError
          ? videoProblem(snapshot.error)
          : snapshot.data
            ? null
            : 'Starting the camera…';

  return (
    <Card
      title={camera.name}
      subtitle={
        <span className={styles.mono}>
          {camera.id} · {camera.model_name ?? camera.model_id}
        </span>
      }
      actions={
        <span className={styles.assign}>
          {!camera.controls && <Badge tone="off">Video only</Badge>}
          <ProvenanceBadge origin={camera.origin} />
          <Button variant="ghost" icon="close" aria-label="Close camera" onClick={onClose} />
        </span>
      }
    >
      <div
        ref={stage}
        className={styles.stage}
        tabIndex={0}
        onKeyDown={keys}
        aria-label={`Live video of ${camera.name}${controlsOn ? '. Arrow keys aim, + and - zoom, C centers, P takes a photo' : ''}`}
      >
        {video.supported ? (
          <canvas
            ref={canvas}
            className={styles.stageMedia}
            data-hidden={overlay !== null || undefined}
            aria-label={`Live video from ${camera.name}`}
          />
        ) : (
          snapshot.data &&
          videoOn &&
          connected && (
            <img
              className={styles.stageMedia}
              src={`data:image/jpeg;base64,${snapshot.data.jpeg_base64}`}
              width={snapshot.data.width}
              height={snapshot.data.height}
              alt={`Live image from ${camera.name}`}
            />
          )
        )}
        {overlay && <p className={styles.stageNote}>{overlay}</p>}
        {connected && videoOn && overlay === null && (
          <span className={styles.stageLive}>
            <span /> LIVE{video.supported && video.fps > 0 ? ` · ${video.fps} fps` : ''}
          </span>
        )}
        {connected && (
          <span className={styles.stageTools}>
            <button
              type="button"
              aria-label="Take a photo"
              title="Take a photo (P)"
              disabled={shoot.isPending}
              onClick={() => shoot.mutate()}
            >
              <Icon name="photo_camera" size={20} />
            </button>
            <button
              type="button"
              aria-label={videoOn ? 'Pause video' : 'Show video'}
              title={videoOn ? 'Pause video' : 'Show video'}
              onClick={() => setVideoOn(!videoOn)}
            >
              <Icon name={videoOn ? 'pause' : 'play_arrow'} size={20} />
            </button>
            <button type="button" aria-label="Full screen" title="Full screen" onClick={fullscreen}>
              <Icon name="fullscreen" size={20} />
            </button>
          </span>
        )}
      </div>

      {controlsOn && (
        <div className={styles.camControls}>
          <div className={styles.aimPad} role="group" aria-label="Aim the camera">
            <span />
            <Button
              size="sm"
              variant="secondary"
              aria-label="Tilt up"
              disabled={busy}
              onClick={() => aim(0, STEP_DEG)}
            >
              <Icon name="keyboard_arrow_up" />
            </Button>
            <span />
            <Button
              size="sm"
              variant="secondary"
              aria-label="Pan left"
              disabled={busy}
              onClick={() => aim(STEP_DEG, 0)}
            >
              <Icon name="keyboard_arrow_left" />
            </Button>
            <Button
              size="sm"
              variant="secondary"
              aria-label="Center"
              disabled={send.isPending}
              onClick={() => send.mutate({ kind: 'recenter' })}
            >
              <Icon name="center_focus_strong" />
            </Button>
            <Button
              size="sm"
              variant="secondary"
              aria-label="Pan right"
              disabled={busy}
              onClick={() => aim(-STEP_DEG, 0)}
            >
              <Icon name="keyboard_arrow_right" />
            </Button>
            <span />
            <Button
              size="sm"
              variant="secondary"
              aria-label="Tilt down"
              disabled={busy}
              onClick={() => aim(0, -STEP_DEG)}
            >
              <Icon name="keyboard_arrow_down" />
            </Button>
            <span />
          </div>
          <div className={styles.actions}>
            <Button
              size="sm"
              variant="secondary"
              icon="zoom_out"
              disabled={busy}
              onClick={() => zoom(-ZOOM_STEP)}
            >
              Zoom out
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="zoom_in"
              disabled={busy}
              onClick={() => zoom(ZOOM_STEP)}
            >
              Zoom in
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="light_mode"
              disabled={send.isPending}
              onClick={() => send.mutate({ kind: 'wake' })}
            >
              Wake
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="bedtime"
              disabled={send.isPending}
              onClick={() => send.mutate({ kind: 'sleep' })}
            >
              Sleep (lens down)
            </Button>
          </div>
          <span className={styles.muted}>
            {send.isPending
              ? 'Waiting for the camera…'
              : `Arrows turn ${STEP_DEG}° inside the camera's range; moving wakes it first. Keyboard: click the video, then ← → ↑ ↓, + −, C, P.`}
          </span>
        </div>
      )}

      <dl className={styles.facts}>
        {camera.controls && (
          <>
            <div>
              <dt>Pan · Tilt</dt>
              <dd>{s ? `${s.pan.toFixed(0)}° · ${s.tilt.toFixed(0)}°` : '—'}</dd>
            </div>
            <div>
              <dt>Zoom</dt>
              <dd>{s ? `${s.zoom} / ${s.zoom_range.max}` : '—'}</dd>
            </div>
            <div>
              <dt>Read from the camera</dt>
              <dd>
                {s
                  ? timeAgo(s.read_at, now)
                  : connected && state.isError
                    ? describeError(state.error)
                    : '—'}
              </dd>
            </div>
          </>
        )}
        <div>
          <dt>Video</dt>
          <dd>{video.width ? `${video.width}×${video.height}` : '—'}</dd>
        </div>
        <div>
          <dt>USB port</dt>
          <dd className={styles.mono}>{camera.connected_at?.location ?? '—'}</dd>
        </div>
        <div>
          <dt>Serial</dt>
          <dd>{camera.serial ?? 'None (matched by port)'}</dd>
        </div>
      </dl>

      {!compact && (
        <>
          <div className={styles.aiRow}>
            <Icon name="smart_toy" size={22} />
            <span>
              <b>Lefi AI may use this camera</b>
              <span className={styles.muted}>
                {camera.controls
                  ? 'Lefi can aim, zoom and take photos with it when someone asks in the chat. Every move is recorded below as "Lefi AI (for …)".'
                  : 'Lefi can take photos with it when someone asks in the chat.'}
              </span>
            </span>
            {canManage ? (
              <Switch
                on={camera.ai_control}
                label="Lefi AI may use this camera"
                disabled={aiAccess.isPending || camera.status === 'RETIRED'}
                onChange={() => aiAccess.mutate(!camera.ai_control)}
              />
            ) : (
              <Badge tone={camera.ai_control ? 'ok' : 'off'}>
                {camera.ai_control ? 'Allowed' : 'Not allowed'}
              </Badge>
            )}
          </div>

          <ZoneViewsPanel
            camera={camera}
            canManage={canManage}
            zones={places.data?.zones ?? []}
            now={now}
          />

          <div className={styles.sectionHead}>
            <h3>Photos</h3>
            {connected && (
              <Button
                size="sm"
                variant="secondary"
                icon="photo_camera"
                disabled={shoot.isPending}
                onClick={() => shoot.mutate()}
              >
                {shoot.isPending ? 'Taking…' : 'Take photo'}
              </Button>
            )}
          </div>
          {(photos.data ?? []).length === 0 ? (
            <p className={styles.muted}>No photos yet. Take one, or ask Lefi to.</p>
          ) : (
            <ul className={styles.photoStrip}>
              {(photos.data ?? []).slice(0, 8).map((p) => (
                <li key={p.id}>
                  <PhotoThumb photo={p} onOpen={() => setViewing(p.id)} />
                </li>
              ))}
            </ul>
          )}

          <div className={styles.sectionHead}>
            <h3>Commands sent</h3>
          </div>
          {history.isError ? (
            <p className={styles.error}>{describeError(history.error)}</p>
          ) : (history.data ?? []).length === 0 ? (
            <p className={styles.muted}>No command has been sent to this camera yet.</p>
          ) : (
            <table className={styles.readings}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Command</th>
                  <th>Result</th>
                  <th>By</th>
                  <th>Position after</th>
                </tr>
              </thead>
              <tbody>
                {(history.data ?? []).slice(0, 12).map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.requested_at
                        ? `${stamp(c.requested_at).slice(0, 10)} ${seconds(c.requested_at)}`
                        : '—'}
                    </td>
                    <td>
                      {KIND_LABEL[c.kind]}
                      {c.kind === 'pan_tilt' && ` ${c.params.pan}°, ${c.params.tilt}°`}
                      {c.kind === 'zoom' && ` ${c.params.zoom}`}
                    </td>
                    <td>
                      {c.outcome ? (
                        <Badge tone={OUTCOME[c.outcome].tone} title={c.error ?? undefined}>
                          {OUTCOME[c.outcome].label}
                        </Badge>
                      ) : (
                        '—'
                      )}
                      {c.error && <span className={styles.muted}> {c.error}</span>}
                    </td>
                    <td>
                      {c.requested_by.startsWith('Lefi AI') && <Icon name="smart_toy" size={14} />}{' '}
                      {c.requested_by}
                    </td>
                    <td className={styles.mono}>
                      {c.result
                        ? `pan ${c.result.pan}° · tilt ${c.result.tilt}° · zoom ${c.result.zoom}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      <PhotoViewer photoId={viewing} onClose={() => setViewing(undefined)} />
    </Card>
  );
}

export function PhotoThumb({
  photo,
  onOpen,
  caption,
}: {
  photo: CameraPhoto;
  onOpen: () => void;
  /** Shown before the time, e.g. the camera's name. */
  caption?: string;
}) {
  const platform = usePlatform();
  const img = useQuery(liveQueries.cameraPhoto(platform, photo.id));
  return (
    <button
      type="button"
      className={styles.photoThumb}
      onClick={onOpen}
      title={photo.note ?? undefined}
    >
      {img.data ? (
        <img
          src={`data:image/jpeg;base64,${img.data.jpeg_base64}`}
          alt={`Photo ${seconds(photo.taken_at)}`}
        />
      ) : (
        <span className={styles.muted}>…</span>
      )}
      <span>
        {photo.by_ai && <Icon name="smart_toy" size={13} />} {caption ? `${caption} · ` : ''}
        {seconds(photo.taken_at)}
      </span>
    </button>
  );
}

/** A photo at full size, with who took it, where the camera looked and why. */
export function PhotoViewer({ photoId, onClose }: { photoId?: string; onClose: () => void }) {
  const platform = usePlatform();
  const img = useQuery({
    ...liveQueries.cameraPhoto(platform, photoId ?? ''),
    enabled: !!photoId,
  });
  const p = img.data;
  return (
    <Dialog open={!!photoId} onClose={onClose} labelledBy="photo-title" width={1000}>
      <div className={styles.dialogHead}>
        <h2 id="photo-title">Photo{p ? ` · ${p.camera_id}` : ''}</h2>
        <button type="button" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={22} />
        </button>
      </div>
      <div className={styles.pad}>
        {img.isError ? (
          <p className={styles.error}>{describeError(img.error)}</p>
        ) : !p ? (
          <p className={styles.muted}>Loading…</p>
        ) : (
          <>
            <img
              className={styles.photoFull}
              src={`data:image/jpeg;base64,${p.jpeg_base64}`}
              width={p.width}
              height={p.height}
              alt={p.note ?? `Photo from ${p.camera_id}`}
            />
            <p className={styles.muted}>
              <ProvenanceBadge origin={p.origin} /> {stamp(p.taken_at)} · {p.width}×{p.height} · by{' '}
              {p.taken_by}
              {p.pan !== null && ` · pan ${p.pan}°, tilt ${p.tilt}°, zoom ${p.zoom}`}
              {p.note && ` · “${p.note}”`}
            </p>
            <AnalysisBox photoId={p.id} />
          </>
        )}
      </div>
    </Dialog>
  );
}
