import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cameraZones, live, liveQueries, type Camera, type UsbCamera } from '@lefi/api';
import type { Tone } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { timeAgo } from '../../shared/lib/time';
import { Badge, Button, Card, Dialog, FormField, Icon, ProvenanceBadge } from '../../shared/ui';
import { CameraPanel } from './CameraPanel';
import { ConfirmButton, useLiveMutation, usePlaces } from './common';
import styles from './live.module.css';

const CONNECTION: Record<Camera['connection'], { tone: Tone; label: string; hint: string }> = {
  connected: { tone: 'ok', label: 'Connected', hint: "Plugged into Lefi Brain's PC now" },
  not_connected: {
    tone: 'crit',
    label: 'Not connected',
    hint: "Not plugged into Lefi Brain's PC, or plugged into another port with another camera",
  },
  unknown: {
    tone: 'off',
    label: 'Unknown',
    hint: 'Lefi Brain cannot list USB devices on its system',
  },
};

/**
 * USB cameras plugged into the PC that runs Lefi Brain (ADR-073). Lefi Brain lists what is
 * plugged in; a person adds a camera of a supported model. Preview and commands come later.
 */
export function CamerasLive({ canManage, now }: { canManage: boolean; now?: string }) {
  const platform = usePlatform();
  const cameras = useQuery(liveQueries.cameras(platform));
  const usb = useQuery(liveQueries.usbCameras(platform));
  const places = usePlaces();
  const [adding, setAdding] = useState<UsbCamera>();
  const [open, setOpen] = useState<string>();
  const zones = places.data?.zones ?? [];
  const zoneName = new Map(zones.map((z) => [z.id, z.name]));
  const detected = usb.data?.items ?? [];
  const waiting = detected.filter((d) => d.model_id && !d.camera_id);

  const opened = (cameras.data ?? []).find((c) => c.id === open);
  return (
    <>
      <Card
        title="Cameras"
        subtitle="USB cameras plugged into the PC that runs Lefi Brain"
        actions={
          waiting.length > 0 ? (
            <Badge tone="info" dot>
              {waiting.length} detected, not added
            </Badge>
          ) : undefined
        }
      >
        {cameras.isError ? (
          <p className={styles.error}>{describeError(cameras.error)}</p>
        ) : (cameras.data ?? []).length === 0 ? (
          <p className={styles.muted}>
            No cameras added yet. Plug a USB camera into Lefi Brain&apos;s PC: it appears below
            under &quot;Detected by USB&quot; within a few seconds.
          </p>
        ) : (
          (cameras.data ?? []).map((c) => (
            <CameraRow
              key={c.id}
              camera={c}
              zones={zones}
              zoneNames={cameraZones(c).map((z) => zoneName.get(z) ?? z)}
              canManage={canManage}
              now={now}
              opened={c.id === open}
              onOpen={() => setOpen(c.id === open ? undefined : c.id)}
            />
          ))
        )}

        <div className={styles.sectionHead}>
          <h3>Detected by USB</h3>
        </div>
        {usb.isError ? (
          <p className={styles.error}>{describeError(usb.error)}</p>
        ) : usb.data && !usb.data.available ? (
          <p className={styles.muted}>Not available here: {usb.data.reason}</p>
        ) : detected.length === 0 ? (
          <p className={styles.muted}>
            {usb.isPending
              ? 'Looking…'
              : "No USB camera is plugged into Lefi Brain's PC. Plug one in: it appears here within a few seconds."}
          </p>
        ) : (
          <ul className={styles.enrolList}>
            {detected.map((d) => (
              <li key={d.key} className={styles.sensor}>
                <div className={styles.sensorHead}>
                  <span>
                    <b>{d.product_name ?? 'USB camera'}</b>{' '}
                    <span className={styles.mono}>
                      {d.vendor_id}:{d.product_id} · port {d.location}
                    </span>
                  </span>
                  <span className={styles.assign}>
                    {d.controls ? (
                      <Badge tone="info" title="Lefi Brain can aim and zoom this model">
                        Video + controls
                      </Badge>
                    ) : (
                      <Badge
                        tone="off"
                        title="Any USB camera gives live video and photos; aim and zoom only for models checked on real hardware"
                      >
                        Video only
                      </Badge>
                    )}
                    {d.camera_id ? (
                      <Badge tone="ok">Added as {d.camera_id}</Badge>
                    ) : canManage ? (
                      <Button size="sm" icon="add" onClick={() => setAdding(d)}>
                        Add
                      </Button>
                    ) : (
                      <Badge tone="info">Not added</Badge>
                    )}
                  </span>
                </div>
                <span className={styles.muted}>
                  {d.vendor_name ?? 'Unknown maker'}
                  {d.serial ? ` · serial ${d.serial}` : ' · no USB serial number'}
                  {d.release ? ` · USB release ${d.release}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        <AddCameraDialog
          camera={adding}
          zones={zones}
          onClose={() => setAdding(undefined)}
          onAdded={(id) => setOpen(id)}
        />
      </Card>
      {opened && (
        <>
          <div className={styles.pad} />
          <CameraPanel
            key={opened.id}
            camera={opened}
            canManage={canManage}
            now={now}
            onClose={() => setOpen(undefined)}
          />
        </>
      )}
    </>
  );
}

function CameraRow({
  camera: c,
  zones,
  zoneNames,
  canManage,
  now,
  opened,
  onOpen,
}: {
  camera: Camera;
  zones: { id: string; name: string }[];
  zoneNames: string[];
  canManage: boolean;
  now?: string;
  opened: boolean;
  onOpen: () => void;
}) {
  const platform = usePlatform();
  const place = useLiveMutation(
    (ids: string[]) => live.updateCamera(platform, c.id, { zone_ids: ids }),
    (r) =>
      r.zone_ids.length === 0
        ? 'Camera no longer looks at any zone'
        : `Camera looks at ${r.zone_ids.length} zone${r.zone_ids.length === 1 ? '' : 's'}`,
  );
  const retire = useLiveMutation(
    () => live.retireCamera(platform, c.id),
    () => 'Camera retired',
  );
  const state = CONNECTION[c.connection];
  return (
    <div className={styles.sensor} data-open={opened || undefined}>
      <div className={styles.sensorHead}>
        <button type="button" className={styles.rowLink} onClick={onOpen} aria-expanded={opened}>
          <Icon name="videocam" size={18} /> <b>{c.name}</b>{' '}
          <span className={styles.mono}>
            {c.id} · {c.model_name ?? c.model_id}
          </span>
        </button>
        <span className={styles.assign}>
          {c.ai_control && (
            <Badge tone="info" title="Lefi AI may use this camera">
              Lefi AI
            </Badge>
          )}
          <ProvenanceBadge origin={c.origin} />
          <Badge tone={state.tone} dot title={state.hint}>
            {state.label}
          </Badge>
          <Button
            size="sm"
            variant={opened ? 'primary' : 'secondary'}
            icon={opened ? 'close' : 'live_tv'}
            onClick={onOpen}
          >
            {opened ? 'Close' : 'Watch live'}
          </Button>
        </span>
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>Last seen</dt>
          <dd>{timeAgo(c.last_seen_at, now)}</dd>
        </div>
        <div>
          <dt>USB port</dt>
          <dd className={styles.mono}>{c.connected_at?.location ?? '—'}</dd>
        </div>
        <div>
          <dt>Serial</dt>
          <dd>{c.serial ?? 'None (matched by port)'}</dd>
        </div>
        <div>
          <dt>Zones it looks at</dt>
          <dd>{zoneNames.length ? zoneNames.join(' · ') : 'Not placed'}</dd>
        </div>
      </dl>
      {canManage && c.status === 'ACTIVE' && (
        <ZoneChecks
          label={`Zones ${c.name} looks at`}
          zones={zones}
          value={cameraZones(c)}
          disabled={place.isPending}
          onChange={(ids) => place.mutate(ids)}
        />
      )}
      {canManage && (
        <div className={styles.actions}>
          <ConfirmButton
            label="Retire"
            icon="delete"
            confirm="It stops being used; plugged in again, it can be added again."
            disabled={retire.isPending}
            onConfirm={() => retire.mutate(undefined)}
          />
        </div>
      )}
    </div>
  );
}

function AddCameraDialog({
  camera,
  zones,
  onClose,
  onAdded,
}: {
  camera?: UsbCamera;
  zones: { id: string; name: string }[];
  onClose: () => void;
  onAdded: (id: string) => void;
}) {
  const platform = usePlatform();
  const [name, setName] = useState('');
  const [zoneIds, setZoneIds] = useState<string[]>([]);
  const [ai, setAi] = useState(true);
  const defaultName = camera?.model_name ?? camera?.product_name ?? 'Camera';
  const add = useLiveMutation(
    (key: string) =>
      live.addCamera(platform, {
        key,
        name: name.trim() || defaultName,
        zone_ids: zoneIds,
        ai_control: ai,
      }),
    (c) => `${c.name} added as ${c.id}`,
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!camera) return;
    add.mutate(camera.key, {
      onSuccess: (c) => {
        setName('');
        setZoneIds([]);
        setAi(true);
        onClose();
        onAdded(c.id); // open it: live video right away
      },
    });
  };
  return (
    <Dialog open={camera !== undefined} onClose={onClose} labelledBy="add-camera-title" width={560}>
      <div className={styles.dialogHead}>
        <h2 id="add-camera-title">Add camera</h2>
        <button type="button" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={22} />
        </button>
      </div>
      <form onSubmit={submit}>
        <div className={styles.form}>
          <FormField label="Camera">
            <span>
              {defaultName} <span className={styles.mono}>port {camera?.location}</span>
              <br />
              <span className={styles.muted}>
                {camera?.controls
                  ? 'Live video, photos, and aim/zoom from Lefi Desktop.'
                  : 'Live video and photos. Aim and zoom are only for models checked on real hardware.'}
              </span>
            </span>
          </FormField>
          <FormField label="Name">
            <input
              maxLength={80}
              value={name}
              placeholder={defaultName}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>
          <FormField label="Zones it looks at (optional, one or more)" span={2}>
            <ZoneChecks
              label="Zones the new camera looks at"
              zones={zones}
              value={zoneIds}
              onChange={setZoneIds}
            />
          </FormField>
          <label className={styles.check}>
            <input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} />
            <span>
              Lefi AI may use this camera to watch the plants —{' '}
              {camera?.controls ? 'aim, zoom and take photos' : 'take photos'} when someone asks in
              the chat. Every action is recorded; you can turn it off at any time.
            </span>
          </label>
        </div>
        <p className={styles.note}>
          After adding it opens with live video. Lefi Brain gives it the next id (cam-01, cam-02…).
          It must stay plugged into Lefi Brain&apos;s PC; without a USB serial number it is
          recognised by its port.
        </p>
        <div className={styles.dialogFoot}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" icon="add" disabled={add.isPending}>
            Add
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * The zones a camera looks at (ADR-087): one or several. Its photos are listed in each of them,
 * and each zone's Visual monitoring (Greenhouses & Crops) shows it.
 */
function ZoneChecks({
  label,
  zones,
  value,
  disabled,
  onChange,
}: {
  label: string;
  zones: { id: string; name: string }[];
  value: string[];
  disabled?: boolean;
  onChange: (ids: string[]) => void;
}) {
  if (zones.length === 0)
    return <p className={styles.muted}>No zones yet: create one in Zones &amp; Inventory.</p>;
  const toggle = (id: string, on: boolean) =>
    onChange(on ? [...value, id] : value.filter((z) => z !== id));
  return (
    <fieldset className={styles.zoneChecks} aria-label={label} disabled={disabled}>
      {zones.map((z) => (
        <label key={z.id} className={styles.check}>
          <input
            type="checkbox"
            checked={value.includes(z.id)}
            onChange={(e) => toggle(z.id, e.target.checked)}
          />
          <span>{z.name}</span>
        </label>
      ))}
    </fieldset>
  );
}
