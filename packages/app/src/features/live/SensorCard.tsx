import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  live,
  liveQueries,
  type FieldDeviceDetail,
  type FieldSensor,
  type SensorScope,
} from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { formatValue } from '../../shared/lib/format';
import { stamp } from '../../shared/lib/time';
import { Badge, Button, Select, Switch } from '../../shared/ui';
import {
  DataStateBadge,
  LatestValues,
  SCOPE_LABEL,
  targetsFor,
  useLiveMutation,
  usePlaces,
} from './common';
import styles from './live.module.css';

/**
 * One channel of a node: what it is, whether it is enabled, where it measures, its last values.
 * Lefi Brain refuses anything invalid (scope not allowed, no target, model not confirmed) and its
 * message is shown as is.
 */
export function SensorCard({
  device,
  sensor,
  canManage,
  now,
}: {
  device: FieldDeviceDetail;
  sensor: FieldSensor;
  canManage: boolean;
  now?: string;
}) {
  const platform = usePlatform();
  const places = usePlaces();
  const plants = useQuery({ ...liveQueries.plants(platform), enabled: canManage });
  const ch = sensor.channel;
  const [scope, setScope] = useState<SensorScope>(sensor.scope ?? ch.default_scope);
  const [target, setTarget] = useState<string>(sensor.target_id ?? '');
  const [history, setHistory] = useState(false);
  const save = useLiveMutation(
    (enabled: boolean) =>
      live.configureSensor(platform, device.id, sensor.sensor_key, {
        enabled,
        scope,
        target_id: scope === 'device' ? null : target || null,
      }),
    (s) => `${ch.label}: ${s.enabled ? 'enabled' : 'disabled'}`,
  );
  const remove = useLiveMutation(
    () => live.removeSensor(platform, device.id, sensor.sensor_key),
    () => `${ch.label} removed from ${device.name}`,
  );
  const targets = targetsFor(scope, places.data, plants.data ?? [], device.zone_ids);
  const changed = scope !== sensor.scope || (target || null) !== sensor.target_id;

  return (
    <div className={styles.sensor}>
      <div className={styles.sensorHead}>
        <span>
          <b>{ch.label}</b>{' '}
          <span className={styles.mono}>
            {sensor.sensor_key} · {ch.model ?? 'model not confirmed'}
            {ch.interface ? ` · ${ch.interface}` : ''}
          </span>
        </span>
        <span className={styles.assign}>
          {sensor.detected === false && (
            <Badge tone="off" variant="tag" title="The device did not find this sensor at boot">
              Not detected
            </Badge>
          )}
          <DataStateBadge state={sensor.data_state} />
          {canManage && (
            <Switch
              label={`${sensor.enabled ? 'Disable' : 'Enable'} ${ch.label}`}
              on={sensor.enabled}
              disabled={!ch.model_confirmed || save.isPending}
              title={
                ch.model_confirmed
                  ? undefined
                  : 'The sensor model is not confirmed yet, so it cannot be enabled'
              }
              onChange={() => ch.model_confirmed && save.mutate(!sensor.enabled)}
            />
          )}
        </span>
      </div>
      <LatestValues sensor={sensor} now={now} />
      {sensor.last_error && sensor.data_state === 'error' && (
        <span className={styles.muted}>
          The device reports: {sensor.last_error.replace('_', ' ')}
        </span>
      )}
      {canManage ? (
        <div className={styles.assign}>
          <span className={styles.muted}>Measures</span>
          <Select
            aria-label={`What ${ch.label} measures`}
            value={scope ?? ''}
            onChange={(e) => {
              setScope(e.target.value as SensorScope);
              setTarget('');
            }}
          >
            {ch.scopes.map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABEL[s]}
              </option>
            ))}
          </Select>
          {scope !== 'device' && (
            <Select
              aria-label={`Which ${scope} ${ch.label} measures`}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">Choose…</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
          )}
          {changed && sensor.enabled && (
            <Button size="sm" onClick={() => save.mutate(true)} disabled={save.isPending}>
              Save
            </Button>
          )}
          {scope !== 'device' && targets.length === 0 && (
            <span className={styles.muted}>
              {device.zone_ids.length === 0
                ? 'Give this device its zones first (above): its sensors measure only in them.'
                : "Nothing to choose in this device's zones yet: create it in Greenhouses & Crops, or add the zone to the device."}
            </span>
          )}
        </div>
      ) : (
        <span className={styles.muted}>
          Measures: {sensor.scope ? SCOPE_LABEL[sensor.scope] : '—'}
          {sensor.target_label ? ` · ${sensor.target_label}` : ''}
        </span>
      )}
      <div>
        <Button size="sm" variant="link" onClick={() => setHistory((h) => !h)}>
          {history ? 'Hide readings' : 'Show last readings'}
        </Button>
        {canManage && !sensor.enabled && (
          <Button
            size="sm"
            variant="link"
            disabled={remove.isPending}
            title="Removes it from this device; its readings stay in history"
            onClick={() => remove.mutate(undefined)}
          >
            Remove sensor
          </Button>
        )}
      </div>
      {history && <Readings sensorId={sensor.id} />}
    </div>
  );
}

export function Readings({ sensorId }: { sensorId: string }) {
  const platform = usePlatform();
  const page = useQuery(liveQueries.readings(platform, sensorId));
  const items = page.data?.items ?? [];
  if (page.isPending) return <span className={styles.muted}>Loading…</span>;
  if (items.length === 0) return <span className={styles.muted}>Nothing received yet.</span>;
  return (
    <table className={styles.readings}>
      <thead>
        <tr>
          <th>Received</th>
          <th>Variable</th>
          <th>Value</th>
          <th>Used</th>
        </tr>
      </thead>
      <tbody>
        {items.slice(0, 20).map((r) => (
          <tr key={r.id}>
            <td>{stamp(r.received_at)}</td>
            <td>{r.variable}</td>
            <td>{r.value === null ? `— (${r.error ?? 'error'})` : formatValue(r.value)}</td>
            <td title={r.late ? 'Arrived late' : undefined}>
              {r.in_use ? 'Yes' : r.late ? 'No · late' : 'No'}
              {r.origin === 'SIMULATED' && ' · SIM'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
