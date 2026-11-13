import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cameraZones, live, liveKeys, liveQueries, type Camera, type ZoneItem } from '@lefi/api';
import type { Tone } from '@lefi/ui';
import { usePlatform } from '../../../platform/PlatformContext';
import { describeError } from '../../../shared/lib/errors';
import { stamp, timeAgo } from '../../../shared/lib/time';
import { Badge, Button, Icon, ProvenanceBadge, Skeleton, useToast } from '../../../shared/ui';
import { useCan } from '../../session';
import { AnalysisBadge } from '../AnalysisBox';
import { CameraPanel, PhotoThumb, PhotoViewer, videoProblem } from '../CameraPanel';
import { MarkersDialog } from '../MarkersDialog';
import { LastScan, everyLabel } from '../ZoneViewsPanel';
import liveStyles from '../live.module.css';
import crops from '../../crops/crops.module.css';
import styles from './greenhouses.module.css';

const CONNECTION: Record<Camera['connection'], { tone: Tone; label: string }> = {
  connected: { tone: 'ok', label: 'Connected' },
  not_connected: { tone: 'crit', label: 'Not connected' },
  unknown: { tone: 'off', label: 'Unknown' },
};

/**
 * Visual monitoring of one zone (ADR-087): the cameras a person set to look at it, the photos
 * taken for it, and live video opened right below — the page scrolls to it. Needs `nav.devices`,
 * like the zone's sensors and Devices & Health.
 */
export function ZoneCameras({ zone, now }: { zone: ZoneItem; now: string | undefined }) {
  const platform = usePlatform();
  const qc = useQueryClient();
  const toast = useToast((t) => t.show);
  const canSee = useCan('nav.devices');
  const canManage = useCan('device.manage');
  const cameras = useQuery({ ...liveQueries.cameras(platform), enabled: canSee });
  const photos = useQuery({ ...liveQueries.zonePhotos(platform, zone.id), enabled: canSee });
  const views = useQuery({ ...liveQueries.zoneViews(platform, zone.id), enabled: canSee });
  const photoIds = (photos.data ?? []).map((p) => p.id);
  const analyses = useQuery({
    ...liveQueries.photoAnalyses(platform, photoIds),
    enabled: canSee && photoIds.length > 0,
  });
  const [watching, setWatching] = useState<string>();
  const [printing, setPrinting] = useState(false);
  const [viewing, setViewing] = useState<string>();
  const liveBox = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  // Opening live video brings it into view and gives it the keyboard (arrows aim, P = photo).
  useEffect(() => {
    if (!watching) return;
    liveBox.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    stage.current?.focus({ preventScroll: true });
  }, [watching]);

  const viewOf = new Map((views.data ?? []).map((v) => [v.camera_id, v]));
  // With a saved view of this zone, a manager's photo aims there first and is for this zone only.
  const shoot = useMutation({
    mutationFn: async (id: string) => {
      if (canManage && viewOf.has(id)) {
        const [p] = await live.scanNow(platform, id, [zone.id]);
        if (!p) throw new Error('The camera could not photograph the zone: see its last scan');
        return p;
      }
      return live.takePhoto(platform, id, `Zone ${zone.name}`);
    },
    onSuccess: (p) => {
      toast('Photo taken', 'ok');
      void qc.invalidateQueries({ queryKey: liveKeys.zonePhotos(zone.id) });
      void qc.invalidateQueries({ queryKey: liveKeys.cameraPhotos(p.camera_id) });
      setViewing(p.id);
    },
    onError: (e) => toast(videoProblem(e), 'bad'),
  });

  const watch = (id: string | undefined) => {
    setWatching(id);
    const v = id ? viewOf.get(id) : undefined;
    if (id && v && v.pan !== null && canManage) {
      // Look at this zone first; the video follows the camera as it turns.
      live.goToView(platform, id, zone.id).catch((e: unknown) => toast(videoProblem(e), 'bad'));
    }
  };

  if (!canSee) return null;
  const all = cameras.data ?? [];
  const here = all.filter((c) => c.status === 'ACTIVE' && cameraZones(c).includes(zone.id));
  const names = new Map(all.map((c) => [c.id, c.name]));
  const watched = here.find((c) => c.id === watching);

  return (
    <section className={crops.card} aria-label="Visual monitoring">
      <div className={crops.rowBetween}>
        <span className={crops.titleBlock}>
          <span className={crops.cardTitle}>Visual monitoring</span>
          <span className={crops.faint}>
            Cameras looking at this zone · photos taken for it · live video
          </span>
        </span>
        <span className={styles.cameraActions}>
          {here.length > 0 && (
            <span className={crops.faint}>
              {here.length} {here.length === 1 ? 'camera' : 'cameras'}
            </span>
          )}
          <Button size="sm" variant="ghost" icon="qr_code_2" onClick={() => setPrinting(true)}>
            Print zone marker
          </Button>
        </span>
      </div>

      {cameras.isPending ? (
        <Skeleton height={80} />
      ) : cameras.isError ? (
        <p className={styles.note}>
          <Icon name="videocam_off" size={17} />
          {describeError(cameras.error)}
        </p>
      ) : here.length === 0 ? (
        <p className={styles.note}>
          <Icon name="videocam" size={17} />
          No camera looks at this zone. In Devices &amp; Health → Cameras, tick this zone on a
          camera.
        </p>
      ) : (
        <ul className={styles.cameraList}>
          {here.map((c) => {
            const connected = c.connection === 'connected';
            const open = c.id === watching;
            return (
              <li key={c.id} className={styles.cameraTile} data-open={open || undefined}>
                <span className={crops.titleBlock}>
                  <b>
                    <Icon name="videocam" size={16} /> {c.name}
                  </b>
                  <span className={crops.faint}>
                    {c.id} · {connected ? 'now' : `last seen ${timeAgo(c.last_seen_at, now)}`}
                    {cameraZones(c).length > 1 && ` · looks at ${cameraZones(c).length} zones`}
                  </span>
                  {viewOf.get(c.id) ? (
                    <span className={styles.cameraActions}>
                      <span className={crops.faint}>
                        {everyLabel(viewOf.get(c.id)?.every_minutes)}
                        {viewOf.get(c.id)?.next_scan_at &&
                          viewOf.get(c.id)?.every_minutes &&
                          ` · next ${stamp(viewOf.get(c.id)!.next_scan_at!).slice(11, 16)}`}
                      </span>
                      <LastScan v={viewOf.get(c.id)!} now={now} />
                    </span>
                  ) : (
                    <span className={crops.faint}>
                      No saved view of this zone: calibrate the camera in Devices &amp; Health
                    </span>
                  )}
                </span>
                <span className={styles.cameraActions}>
                  <ProvenanceBadge origin={c.origin} />
                  <Badge tone={CONNECTION[c.connection].tone} dot>
                    {CONNECTION[c.connection].label}
                  </Badge>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="photo_camera"
                    disabled={!connected || shoot.isPending}
                    title={connected ? undefined : "Not plugged into Lefi Brain's PC now"}
                    onClick={() => shoot.mutate(c.id)}
                  >
                    Take photo
                  </Button>
                  <Button
                    size="sm"
                    variant={open ? 'primary' : 'secondary'}
                    icon={open ? 'close' : 'live_tv'}
                    disabled={!connected && !open}
                    aria-expanded={open}
                    onClick={() => watch(open ? undefined : c.id)}
                  >
                    {open ? 'Close live' : 'Watch live'}
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {watched && (
        <div ref={liveBox} className={styles.liveBox}>
          <CameraPanel
            key={watched.id}
            camera={watched}
            canManage={canManage}
            now={now}
            compact
            stageRef={stage}
            onClose={() => watch(undefined)}
          />
        </div>
      )}

      <div className={liveStyles.sectionHead}>
        <h3>Photos of this zone</h3>
        <span className={crops.faint}>
          Taken by people, on the zone&apos;s schedule, or by Lefi AI for someone
        </span>
      </div>
      {photos.isError ? (
        <p className={crops.faint}>{describeError(photos.error)}</p>
      ) : (photos.data ?? []).length === 0 ? (
        <p className={crops.faint}>
          {photos.isPending
            ? 'Loading…'
            : 'No photos of this zone yet. Take one from a camera above, or ask Lefi to.'}
        </p>
      ) : (
        <ul className={liveStyles.photoStrip}>
          {(photos.data ?? []).map((p) => (
            <li key={p.id}>
              <PhotoThumb
                photo={p}
                caption={names.get(p.camera_id) ?? p.camera_id}
                onOpen={() => setViewing(p.id)}
              />
              <AnalysisBadge a={(analyses.data ?? []).find((a) => a.photo_id === p.id)} />
            </li>
          ))}
        </ul>
      )}
      <PhotoViewer photoId={viewing} onClose={() => setViewing(undefined)} />
      <MarkersDialog
        open={printing}
        zones={[{ id: zone.id, name: zone.name, code: zone.code ?? null }]}
        onClose={() => setPrinting(false)}
      />
    </section>
  );
}
