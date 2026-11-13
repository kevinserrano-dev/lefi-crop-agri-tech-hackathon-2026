import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { live, liveQueries, roboticsQueries, type FieldDeviceDetail } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { timeAgo } from '../../shared/lib/time';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  KpiRow,
  KpiTile,
  ProvenanceBadge,
  Segmented,
  Select,
  Skeleton,
} from '../../shared/ui';
import { useCan } from '../session';
import { RobotsDevices } from '../robots-live/RobotDevice';
import { AddNodeDialog, AddSensorDialog, CredentialsDialog, type AddMode } from './NodeDialogs';
import { BoardLog } from './BoardLog';
import { CamerasLive } from './CamerasLive';
import { DeviceEvents, HealthFacts } from './DeviceHealth';
import { SensorCard } from './SensorCard';
import { ConfirmButton, ConnectionBadge, useBrainNow, useLiveMutation, usePlaces } from './common';
import styles from './live.module.css';

/**
 * Devices & Health against the real Lefi Brain (ADR-052): the ESP32 sensor nodes, which of their
 * channels are enabled, where each one measures and whether data arrives. Everything shown comes
 * from Lefi Brain; nothing here is sample data.
 */
export function FieldDevicesLive() {
  const platform = usePlatform();
  const canManage = useCan('device.manage');
  const now = useBrainNow();
  const list = useQuery(liveQueries.devices(platform));
  const places = usePlaces();
  const [selected, setSelected] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<AddMode>('manual');
  const [view, setView] = useState<'nodes' | 'cameras' | 'robots'>('nodes');
  const enrolments = useQuery({ ...liveQueries.enrolments(platform), enabled: canManage });
  // Every device added to the installation: sensor nodes, cameras (not retired) and robots.
  const cameras = useQuery(liveQueries.cameras(platform));
  const robots = useQuery({ ...roboticsQueries.robots(platform), refetchInterval: 5_000 });
  const cameraCount = cameras.data?.length;
  const robotCount = robots.data?.filter((r) => r.device).length;
  const total =
    list.data && cameraCount !== undefined && robotCount !== undefined
      ? list.data.length + cameraCount + robotCount
      : undefined;
  const asking = enrolments.data?.length ?? 0;
  const openAdd = (m: AddMode) => {
    setMode(m);
    setAdding(true);
  };
  const devices = list.data ?? [];
  const current = selected ?? devices.find((d) => d.status === 'PENDING')?.id ?? devices[0]?.id;
  // Keep the first choice: approving a device must not move the panel to another one.
  if (selected === undefined && current !== undefined) setSelected(current);
  const zoneName = new Map((places.data?.zones ?? []).map((z) => [z.id, z.name]));

  if (list.isError) {
    return (
      <EmptyState mascot="sad" title="Could not load the devices">
        {describeError(list.error)}
      </EmptyState>
    );
  }

  return (
    <>
      <KpiRow min={150}>
        <KpiTile label="All devices" value={total} />
        <KpiTile label="Sensor nodes" value={list.data?.length} />
        <KpiTile
          label="Online"
          value={list.data?.filter((d) => d.connection === 'online').length}
          color="var(--lefi-ok-fg)"
        />
        <KpiTile
          label="Pending approval"
          value={list.data?.filter((d) => d.status === 'PENDING').length}
          color="var(--lefi-warn-fg)"
        />
        <KpiTile
          label="Sensors enabled"
          value={list.data?.reduce((n, d) => n + d.sensors_enabled, 0)}
          color="var(--lefi-info-fg)"
        />
      </KpiRow>
      <div className={styles.toolbar}>
        <Segmented<'nodes' | 'cameras' | 'robots'>
          label="Devices"
          value={view}
          onChange={setView}
          options={[
            { value: 'nodes', label: `Sensor nodes (${devices.length})` },
            {
              value: 'cameras',
              label: cameraCount === undefined ? 'Cameras' : `Cameras (${cameraCount})`,
            },
            {
              value: 'robots',
              label: robotCount === undefined ? 'Robots' : `Robots (${robotCount})`,
            },
          ]}
        />
        {canManage && view === 'nodes' && (
          <span className={styles.assign}>
            {asking > 0 && (
              <Button variant="secondary" icon="wifi_find" onClick={() => openAdd('discovered')}>
                {asking} asking to join
              </Button>
            )}
            <Button icon="add" onClick={() => openAdd('manual')}>
              Add device
            </Button>
          </span>
        )}
        {canManage && view === 'robots' && (
          <Button icon="add" onClick={() => openAdd('robot')}>
            Add simulated robot
          </Button>
        )}
      </div>
      {view === 'robots' ? (
        <RobotsDevices onAdd={() => openAdd('robot')} />
      ) : view === 'cameras' ? (
        <CamerasLive canManage={canManage} now={now} />
      ) : list.isPending ? (
        <Skeleton height={240} />
      ) : devices.length === 0 ? (
        <EmptyState
          mascot="curious"
          title="No sensor nodes yet"
          action={
            canManage ? (
              <Button icon="add" onClick={() => openAdd(asking > 0 ? 'discovered' : 'manual')}>
                Add device
              </Button>
            ) : undefined
          }
        >
          Add a device by hand, or flash a Lefi Crop board with the enrolment password: it asks to
          join and you accept it with the claim code it prints.
        </EmptyState>
      ) : (
        <div className={styles.devLayout}>
          <nav className={styles.devList} aria-label="Sensor nodes">
            {devices.map((d) => (
              <button
                key={d.id}
                type="button"
                className={styles.devItem}
                aria-current={d.id === current ? 'true' : undefined}
                onClick={() => setSelected(d.id)}
              >
                <span className={styles.devItemHead}>
                  <b>{d.name}</b>
                  {d.status === 'PENDING' ? (
                    <Badge tone="warn" title="Announced itself; a person must approve it">
                      Pending
                    </Badge>
                  ) : d.status === 'RETIRED' ? (
                    <Badge tone="off">Retired</Badge>
                  ) : (
                    <ConnectionBadge connection={d.connection} />
                  )}
                </span>
                <span className={styles.mono}>{d.id}</span>
                <span className={styles.muted}>
                  {d.zone_ids.length
                    ? d.zone_ids.map((z) => zoneName.get(z) ?? '—').join(', ')
                    : 'No zone'}{' '}
                  · {d.sensors_enabled}/{d.sensors_total} sensors on
                  {d.origin === 'SIMULATED' ? ' · SIMULATED' : ''}
                </span>
              </button>
            ))}
          </nav>
          {current && <NodePanel key={current} id={current} canManage={canManage} now={now} />}
        </div>
      )}
      <AddNodeDialog
        open={adding}
        mode={mode}
        onMode={setMode}
        onClose={() => setAdding(false)}
        onAdded={(id) => {
          setAdding(false);
          setSelected(id);
        }}
        onRobotAdded={() => {
          setAdding(false);
          setView('robots');
        }}
      />
    </>
  );
}

function NodePanel({ id, canManage, now }: { id: string; canManage: boolean; now?: string }) {
  const platform = usePlatform();
  const detail = useQuery(liveQueries.device(platform, id));
  const [creds, setCreds] = useState<Awaited<ReturnType<typeof live.credentials>>>();
  const [addingSensor, setAddingSensor] = useState(false);
  const approve = useLiveMutation(
    () => live.approveDevice(platform, id),
    () => 'Device approved',
  );
  const retire = useLiveMutation(
    () => live.retireDevice(platform, id),
    () => 'Device retired',
  );
  const issue = useLiveMutation(() => live.credentials(platform, id));
  const places = usePlaces();
  const place = useLiveMutation(
    (zone: string | null) => live.updateDevice(platform, id, { zone_id: zone }),
    (r) => (r.zone_id ? 'Installed-in zone saved' : 'No longer installed in a zone'),
  );
  // Zones it serves (ADR-083); Lefi Brain refuses taking away a zone where a sensor measures.
  const serve = useLiveMutation(
    (zoneIds: string[]) => live.updateDevice(platform, id, { zone_ids: zoneIds }),
    () => 'Zones saved',
  );
  const [tab, setTab] = useState<'overview' | 'sensors' | 'activity'>();
  const d: FieldDeviceDetail | undefined = detail.data;
  if (!d) return <Skeleton height={320} />;
  const retired = d.status === 'RETIRED';
  // A device that still needs zones or sensors opens on its overview; otherwise on its sensors.
  const shownTab = tab ?? (d.sensors.length && d.zone_ids.length ? 'sensors' : 'overview');
  return (
    <Card
      className={styles.devPanel}
      title={d.name}
      subtitle={
        <span className={styles.mono}>
          {d.id} · {d.profile_id}
        </span>
      }
      actions={
        <span className={styles.assign}>
          <ProvenanceBadge origin={d.origin} />
          {canManage && !retired && d.status === 'PENDING' && (
            <Button
              size="sm"
              icon="verified"
              onClick={() => approve.mutate(undefined)}
              disabled={approve.isPending}
            >
              Approve
            </Button>
          )}
          {canManage && !retired && (
            <Button
              size="sm"
              variant="secondary"
              icon="key"
              disabled={issue.isPending}
              onClick={() => issue.mutate(undefined, { onSuccess: (c) => setCreds(c) })}
              title="Creates or replaces this device's MQTT password, for flashing it"
            >
              {d.mqtt_account ? 'New password' : 'Create password'}
            </Button>
          )}
          {canManage && !retired && (
            <ConfirmButton
              label="Retire"
              icon="delete"
              confirm="Its sensors stop counting and its MQTT account is removed."
              disabled={retire.isPending}
              onConfirm={() => retire.mutate(undefined)}
            />
          )}
        </span>
      }
    >
      {d.status === 'PENDING' && (
        <p className={styles.muted}>
          This device announced itself. Its readings are kept but not used until you approve it.
        </p>
      )}
      <div className={styles.devTabs}>
        <Segmented<'overview' | 'sensors' | 'activity'>
          label="Device sections"
          value={shownTab}
          onChange={setTab}
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'sensors', label: `Sensors (${d.sensors_enabled}/${d.sensors.length})` },
            { value: 'activity', label: 'Activity' },
          ]}
        />
      </div>
      {shownTab === 'overview' && (
        <>
          <dl className={styles.facts}>
            <div>
              <dt>Status</dt>
              <dd>
                {d.status === 'PENDING' ? 'Pending approval' : retired ? 'Retired' : 'Active'}
              </dd>
            </div>
            <div>
              <dt>Connection</dt>
              <dd>
                <ConnectionBadge connection={d.connection} />
              </dd>
            </div>
            <div>
              <dt>Last seen</dt>
              <dd>{timeAgo(d.last_seen_at, now)}</dd>
            </div>
            <div>
              <dt>Firmware</dt>
              <dd>{d.firmware ?? '—'}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>
                {d.network === 'ethernet' ? 'Ethernet' : d.network === 'wifi' ? 'Wi-Fi' : '—'}
                {d.mac ? <span className={styles.mono}> · {d.mac}</span> : null}
              </dd>
            </div>
            <div>
              <dt>Wi-Fi signal</dt>
              <dd>{d.rssi_dbm === null ? '—' : `${d.rssi_dbm} dBm`}</dd>
            </div>
            <div>
              <dt>Installed in</dt>
              <dd>
                {canManage && !retired ? (
                  <Select
                    aria-label="Zone where this ESP32 is installed"
                    value={d.zone_id ?? ''}
                    onChange={(e) => place.mutate(e.target.value || null)}
                  >
                    <option value="">Not set</option>
                    {(places.data?.zones ?? []).map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  (places.data?.zones.find((z) => z.id === d.zone_id)?.name ?? 'Not set')
                )}
              </dd>
            </div>
            <div className={styles.factWide}>
              <dt>Zones it serves</dt>
              <dd>
                {canManage && !retired ? (
                  <div
                    className={styles.checkList}
                    role="group"
                    aria-label="Zones this ESP32 serves"
                  >
                    {(places.data?.zones ?? []).map((z) => (
                      <label key={z.id}>
                        <input
                          type="checkbox"
                          checked={d.zone_ids.includes(z.id)}
                          disabled={serve.isPending}
                          onChange={(e) =>
                            serve.mutate(
                              e.target.checked
                                ? [...d.zone_ids, z.id]
                                : d.zone_ids.filter((x) => x !== z.id),
                            )
                          }
                        />
                        {z.name}
                        {z.id === d.zone_id ? ' (installed)' : ''}
                      </label>
                    ))}
                  </div>
                ) : d.zone_ids.length ? (
                  d.zone_ids
                    .map((z) => places.data?.zones.find((x) => x.id === z)?.name ?? '—')
                    .join(', ')
                ) : (
                  'No zone'
                )}
              </dd>
            </div>
            <div>
              <dt>MQTT account</dt>
              <dd>{d.mqtt_account ? 'Created' : 'Not created yet'}</dd>
            </div>
          </dl>
          <HealthFacts device={d} />
        </>
      )}
      {shownTab === 'sensors' && (
        <>
          <div className={styles.sectionHead}>
            <h3>Sensors</h3>
            {canManage && !retired && (
              <Button
                size="sm"
                icon="add"
                disabled={d.available_sensors.length === 0}
                title={
                  d.available_sensors.length === 0
                    ? 'Every sensor this device type supports is already added'
                    : undefined
                }
                onClick={() => setAddingSensor(true)}
              >
                Add sensor
              </Button>
            )}
          </div>
          {d.sensors.length === 0 && (
            <p className={styles.muted}>
              No sensors yet.{' '}
              {canManage && !retired
                ? 'Add the ones wired to this device; only those its type supports are offered.'
                : ''}
            </p>
          )}
          <div className={styles.sensorGrid}>
            {d.sensors.map((s) => (
              <SensorCard
                key={s.id}
                device={d}
                sensor={s}
                canManage={canManage && !retired}
                now={now}
              />
            ))}
          </div>
        </>
      )}
      {shownTab === 'activity' && (
        <>
          <DeviceEvents id={d.id} />
          {canManage && d.supports_logs && <BoardLog id={d.id} />}
          <p className={styles.muted}>
            Restarts, sensor changes and connection drops the board reported appear here.
          </p>
        </>
      )}
      <AddSensorDialog device={d} open={addingSensor} onClose={() => setAddingSensor(false)} />
      <CredentialsDialog credentials={creds} onClose={() => setCreds(undefined)} />
    </Card>
  );
}
