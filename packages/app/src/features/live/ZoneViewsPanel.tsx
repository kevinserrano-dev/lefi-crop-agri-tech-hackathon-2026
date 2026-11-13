import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { live, liveQueries, type Calibration, type Camera, type ZoneViewT } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { stamp, timeAgo } from '../../shared/lib/time';
import { Badge, Button, Icon, Select, Switch } from '../../shared/ui';
import { ConfirmButton, useLiveMutation } from './common';
import { MarkersDialog } from './MarkersDialog';
import styles from './live.module.css';

/** How often a zone can be photographed (Lefi Brain accepts 5 min … 7 days). */
const EVERY: { value: number | null; label: string }[] = [
  { value: null, label: 'Not scheduled' },
  { value: 15, label: 'Every 15 min' },
  { value: 30, label: 'Every 30 min' },
  { value: 60, label: 'Every hour' },
  { value: 120, label: 'Every 2 h' },
  { value: 240, label: 'Every 4 h' },
  { value: 360, label: 'Every 6 h' },
  { value: 720, label: 'Every 12 h' },
  { value: 1440, label: 'Once a day' },
];

export const everyLabel = (m: number | null | undefined) =>
  EVERY.find((e) => e.value === (m ?? null))?.label ?? `Every ${m} min`;

function EverySelect({
  value,
  label,
  disabled,
  onChange,
}: {
  value: number | null;
  label: string;
  disabled?: boolean;
  onChange: (v: number | null) => void;
}) {
  const known = EVERY.some((e) => e.value === value);
  return (
    <Select
      aria-label={label}
      value={value === null ? '' : String(value)}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      {!known && value !== null && <option value={value}>{everyLabel(value)}</option>}
      {EVERY.map((e) => (
        <option key={e.label} value={e.value === null ? '' : e.value}>
          {e.label}
        </option>
      ))}
    </Select>
  );
}

/** Where the view looks, in words. */
function viewWhere(v: { pan: number | null; tilt: number | null; zoom: number | null }) {
  if (v.pan === null || v.tilt === null) return 'Whole picture (fixed camera)';
  return `pan ${Math.round(v.pan)}° · tilt ${Math.round(v.tilt)}°${v.zoom !== null ? ` · zoom ${Math.round(v.zoom)}` : ''}`;
}

const HOW: Record<ZoneViewT['method'], string> = {
  marker: 'Found by its marker',
  manual: 'Aimed by a person',
  fixed: 'In the fixed picture',
};

/** The last scheduled photo of a view, in a badge a person can act on. */
export function LastScan({ v, now }: { v: ZoneViewT; now?: string }) {
  if (!v.last_scan_outcome) return <span className={styles.muted}>Not photographed yet</span>;
  const when = timeAgo(v.last_scan_at, now);
  if (v.last_scan_outcome === 'failed')
    return (
      <Badge tone="crit" title={v.last_scan_error ?? undefined}>
        Failed {when}
      </Badge>
    );
  if (v.last_scan_outcome === 'postponed')
    return (
      <Badge tone="info" title="Someone was watching live: the camera was not moved">
        Waiting (someone watching)
      </Badge>
    );
  return (
    <span className={styles.assign}>
      <Badge tone="ok">Photographed {when}</Badge>
      {v.marker_seen === false && (
        <Badge tone="warn" title="The zone's QR code was not in the photo: check the camera">
          Marker not seen
        </Badge>
      )}
    </span>
  );
}

/**
 * The zones a camera looks at, where it looks for each, and how often Lefi Brain photographs
 * them (ADR-088). Calibration finds each zone's printed QR marker; a person reviews and saves.
 */
export function ZoneViewsPanel({
  camera,
  canManage,
  zones,
  now,
}: {
  camera: Camera;
  canManage: boolean;
  zones: { id: string; name: string }[];
  now?: string;
}) {
  const platform = usePlatform();
  const connected = camera.connection === 'connected' && camera.status === 'ACTIVE';
  const views = useQuery(liveQueries.cameraViews(platform, camera.id));
  const cal = useQuery(liveQueries.calibration(platform, camera.id));
  const vision = useQuery(liveQueries.visionStatus(platform));
  const [printing, setPrinting] = useState(false);
  const [hereZone, setHereZone] = useState('');
  const name = new Map(zones.map((z) => [z.id, z.name]));
  const zoneName = (id: string) => name.get(id) ?? 'Removed zone';

  const start = useLiveMutation(
    () => live.startCalibration(platform, camera.id),
    () => 'Calibration started: the camera is looking for zone markers',
  );
  const cancel = useLiveMutation(
    () => live.cancelCalibration(platform, camera.id),
    () => 'Calibration stopped',
  );
  const every = useLiveMutation(
    (a: { zone: string; every: number | null }) =>
      live.setViewEvery(platform, camera.id, a.zone, a.every),
    (v) => `${zoneName(v.zone_id)}: ${everyLabel(v.every_minutes).toLowerCase()}`,
  );
  const remove = useLiveMutation(
    (zone: string) => live.removeView(platform, camera.id, zone),
    () => 'View removed',
  );
  const here = useLiveMutation(
    (zone: string) => live.viewHere(platform, camera.id, zone, null),
    (v) => `This position is now the view of ${zoneName(v.zone_id)}`,
  );
  const go = useLiveMutation(
    (zone: string) => live.goToView(platform, camera.id, zone),
    () => 'The camera is looking at the zone',
  );
  const scan = useLiveMutation(
    (zone: string) => live.scanNow(platform, camera.id, [zone]),
    (p) => (p.length ? 'Photo taken for the zone' : 'No photo: see the last scan'),
  );
  const aiVision = useLiveMutation(
    (on: boolean) => live.updateCamera(platform, camera.id, { ai_vision: on }),
    (c) =>
      c.ai_vision
        ? 'Lefi AI will look at the scheduled photos'
        : 'Lefi AI no longer looks at the scheduled photos',
  );

  const running = cal.data?.state === 'running';
  const list = views.data ?? [];

  return (
    <>
      <div className={styles.sectionHead}>
        <h3>Zones it watches</h3>
        <span className={styles.assign}>
          <Button size="sm" variant="ghost" icon="qr_code_2" onClick={() => setPrinting(true)}>
            Print zone markers
          </Button>
          {canManage && (
            <Button
              size="sm"
              variant="secondary"
              icon="travel_explore"
              disabled={!connected || running || start.isPending}
              title={connected ? undefined : "Not plugged into Lefi Brain's PC now"}
              onClick={() => start.mutate(undefined)}
            >
              Calibrate with zone markers
            </Button>
          )}
        </span>
      </div>
      <p className={styles.muted}>
        Print each zone&apos;s QR marker and place it where the camera should look. Calibration
        {camera.controls
          ? ' turns the camera over its whole range at its widest zoom and saves, for each zone, the position where its marker was nearest the centre.'
          : ' reads the markers in the camera’s one picture.'}{' '}
        Lefi Brain then photographs each zone on its schedule, for that zone only.
      </p>

      {cal.data && (
        <CalibrationResult
          key={`${cal.data.started_at}-${cal.data.state}`}
          cal={cal.data}
          camera={camera}
          views={list}
          zoneName={zoneName}
          canManage={canManage}
          onCancel={() => cancel.mutate(undefined)}
        />
      )}

      {views.isError ? (
        <p className={styles.error}>{describeError(views.error)}</p>
      ) : list.length === 0 ? (
        <p className={styles.muted}>No zone views yet. Calibrate, or aim the camera and save.</p>
      ) : (
        <table className={styles.readings} aria-label="Zone views">
          <thead>
            <tr>
              <th>Zone</th>
              <th>Where</th>
              <th>Schedule</th>
              <th>Last photo</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((v) => (
              <tr key={v.zone_id}>
                <td>
                  <b>{zoneName(v.zone_id)}</b>
                  <br />
                  <span className={styles.muted}>{HOW[v.method]}</span>
                </td>
                <td className={styles.mono}>{viewWhere(v)}</td>
                <td>
                  {canManage ? (
                    <EverySelect
                      label={`How often ${zoneName(v.zone_id)} is photographed`}
                      value={v.every_minutes}
                      disabled={every.isPending}
                      onChange={(e) => every.mutate({ zone: v.zone_id, every: e })}
                    />
                  ) : (
                    everyLabel(v.every_minutes)
                  )}
                  {v.next_scan_at && v.every_minutes && (
                    <span className={styles.muted}>
                      {' '}
                      next {stamp(v.next_scan_at).slice(11, 16)}
                    </span>
                  )}
                </td>
                <td>
                  <LastScan v={v} now={now} />
                </td>
                <td>
                  {canManage && (
                    <span className={styles.assign}>
                      {camera.controls && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="my_location"
                          disabled={!connected || go.isPending}
                          onClick={() => go.mutate(v.zone_id)}
                        >
                          Look
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="photo_camera"
                        disabled={!connected || scan.isPending}
                        onClick={() => scan.mutate(v.zone_id)}
                      >
                        Photo now
                      </Button>
                      <ConfirmButton
                        label="Remove"
                        icon="delete"
                        confirm="The zone stays with the camera; it is no longer photographed on a schedule."
                        disabled={remove.isPending}
                        onConfirm={() => remove.mutate(v.zone_id)}
                      />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canManage && connected && (
        <div className={styles.actions}>
          <Select
            aria-label="Zone for the current position"
            value={hereZone}
            onChange={(e) => setHereZone(e.target.value)}
          >
            <option value="">Zone…</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="secondary"
            icon="add_location_alt"
            disabled={!hereZone || here.isPending}
            onClick={() => here.mutate(hereZone)}
          >
            {camera.controls
              ? 'Save where it looks now as this zone’s view'
              : 'Add zone to the picture'}
          </Button>
        </div>
      )}

      <div className={styles.aiRow}>
        <Icon name="visibility" size={22} />
        <span>
          <b>Lefi AI looks at the scheduled photos</b>
          <span className={styles.muted}>
            {vision.data?.available
              ? `Looks for yellowing, spots, wilting, damaged leaves, pests and mould with ${vision.data.model}. What it is at least ${Math.round((vision.data.alert_min_confidence ?? 0.6) * 100)} % sure of (medium or high) becomes an alert “Lefi AI · to confirm”.`
              : `Lefi AI cannot look at photos now: ${vision.data?.reason ?? '…'}`}
          </span>
        </span>
        {canManage ? (
          <Switch
            on={camera.ai_vision}
            label="Lefi AI looks at the scheduled photos"
            disabled={aiVision.isPending || camera.status === 'RETIRED'}
            onChange={() => aiVision.mutate(!camera.ai_vision)}
          />
        ) : (
          <Badge tone={camera.ai_vision ? 'ok' : 'off'}>{camera.ai_vision ? 'On' : 'Off'}</Badge>
        )}
      </div>

      <MarkersDialog
        open={printing}
        zones={camera.zone_ids.length ? zones.filter((z) => camera.zone_ids.includes(z.id)) : zones}
        onClose={() => setPrinting(false)}
      />
    </>
  );
}

function CalibrationResult({
  cal,
  camera,
  views,
  zoneName,
  canManage,
  onCancel,
}: {
  cal: Calibration;
  camera: Camera;
  views: ZoneViewT[];
  zoneName: (id: string) => string;
  canManage: boolean;
  onCancel: () => void;
}) {
  const platform = usePlatform();
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [freq, setFreq] = useState<Record<string, number | null>>({});
  const save = useLiveMutation(
    () => {
      const found = cal.found.filter((f) => chosen[f.zone_id] !== false);
      const kept = views.filter(
        (v) => !cal.found.some((f) => f.zone_id === v.zone_id) && chosen[v.zone_id] !== false,
      );
      return live.saveViews(platform, camera.id, [
        ...found.map((f) => ({
          zone_id: f.zone_id,
          method: 'marker' as const,
          pan: f.pan,
          tilt: f.tilt,
          zoom: f.zoom,
          every_minutes:
            freq[f.zone_id] !== undefined
              ? freq[f.zone_id]
              : (views.find((v) => v.zone_id === f.zone_id)?.every_minutes ?? 60),
        })),
        ...kept.map((v) => ({
          zone_id: v.zone_id,
          method: v.method,
          pan: v.pan,
          tilt: v.tilt,
          zoom: v.zoom,
          every_minutes: v.every_minutes,
        })),
      ]);
    },
    (r) => `${r.length} zone view${r.length === 1 ? '' : 's'} saved`,
  );

  if (cal.state === 'running') {
    const pct = cal.total ? Math.round((cal.step / cal.total) * 100) : 0;
    return (
      <div className={styles.calibration} role="status">
        <span>
          <Icon name="travel_explore" size={18} /> Looking for zone markers… position {cal.step} of{' '}
          {cal.total || '…'} · {cal.found.length} found
        </span>
        <div className={styles.calBar}>
          <div style={{ width: `${pct}%` }} />
        </div>
        {canManage && (
          <Button size="sm" variant="ghost" icon="stop" onClick={onCancel}>
            Stop
          </Button>
        )}
      </div>
    );
  }
  if (cal.state === 'failed')
    return <p className={styles.error}>Calibration failed: {cal.error}</p>;
  const others = views.filter((v) => !cal.found.some((f) => f.zone_id === v.zone_id));
  return (
    <div className={styles.calibration}>
      <b>
        Calibration {cal.state === 'cancelled' ? 'stopped' : 'finished'} ·{' '}
        {stamp(cal.finished_at ?? cal.started_at).slice(0, 16)} · {cal.found.length} zone
        {cal.found.length === 1 ? '' : 's'} found
      </b>
      {cal.found.length === 0 && (
        <span className={styles.muted}>
          No zone marker was seen. Check the markers face the camera, are lit, and are big enough;
          or aim the camera and save the view by hand.
        </span>
      )}
      {cal.unknown.length > 0 && (
        <span className={styles.muted}>
          {cal.unknown.length} other QR code{cal.unknown.length === 1 ? '' : 's'} seen that name no
          zone of this Lefi Brain (ignored).
        </span>
      )}
      {(cal.found.length > 0 || others.length > 0) && canManage && (
        <>
          <ul className={styles.calList}>
            {cal.found.map((f) => (
              <li key={f.zone_id}>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={chosen[f.zone_id] !== false}
                    onChange={(e) => setChosen({ ...chosen, [f.zone_id]: e.target.checked })}
                  />
                  <span>
                    <b>{zoneName(f.zone_id)}</b> <span className={styles.mono}>{viewWhere(f)}</span>
                  </span>
                </label>
                <EverySelect
                  label={`How often ${zoneName(f.zone_id)} is photographed`}
                  value={
                    freq[f.zone_id] !== undefined
                      ? (freq[f.zone_id] ?? null)
                      : (views.find((v) => v.zone_id === f.zone_id)?.every_minutes ?? 60)
                  }
                  onChange={(e) => setFreq({ ...freq, [f.zone_id]: e })}
                />
              </li>
            ))}
            {others.map((v) => (
              <li key={v.zone_id}>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={chosen[v.zone_id] !== false}
                    onChange={(e) => setChosen({ ...chosen, [v.zone_id]: e.target.checked })}
                  />
                  <span>
                    <b>{zoneName(v.zone_id)}</b>{' '}
                    <span className={styles.muted}>keep its current view (marker not seen)</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <span className={styles.assign}>
            <Button
              size="sm"
              icon="save"
              disabled={save.isPending}
              onClick={() => save.mutate(undefined)}
            >
              Save these views
            </Button>
            <span className={styles.muted}>
              The camera will look at the ticked zones only; the others are taken away from it.
            </span>
          </span>
        </>
      )}
    </div>
  );
}
