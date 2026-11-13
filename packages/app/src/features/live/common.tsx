import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { liveKeys, liveQueries, type FieldSensor, type Places, type SensorScope } from '@lefi/api';
import type { Tone } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { formatValue } from '../../shared/lib/format';
import { timeAgo } from '../../shared/lib/time';
import { Badge, Button, useToast } from '../../shared/ui';
import { useBrainKind } from '../shell/useBrainKind';
import styles from './live.module.css';

/** Lefi Brain's clock (ADR-008): "x s ago" is never computed from this PC's clock alone. */
export function useBrainNow(): string | undefined {
  const t = useBrainKind().health.data?.time;
  return typeof t === 'string' ? t : undefined;
}

export function usePlaces() {
  const platform = usePlatform();
  return useQuery(liveQueries.places(platform));
}

/** A change sent to Lefi Brain: its own answer decides; errors are shown as Lefi Brain said them. */
export function useLiveMutation<A, R>(fn: (a: A) => Promise<R>, ok?: (r: R) => string) {
  const qc = useQueryClient();
  const toast = useToast((t) => t.show);
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: liveKeys.all });
      if (ok) toast(ok(r), 'ok');
    },
    onError: (e) => toast(describeError(e), 'bad'),
  });
}

const STATE: Record<FieldSensor['data_state'], { tone: Tone; label: string; hint: string }> = {
  disabled: { tone: 'off', label: 'Not enabled', hint: 'Its readings are kept but not used' },
  waiting: { tone: 'info', label: 'Waiting for data', hint: 'Enabled; nothing received yet' },
  receiving: { tone: 'ok', label: 'Receiving', hint: 'Values are arriving' },
  error: { tone: 'crit', label: 'Cannot read', hint: 'The device reports it cannot read it' },
  not_receiving: { tone: 'warn', label: 'No data', hint: 'Nothing received for 60 seconds' },
};

export function DataStateBadge({ state }: { state: FieldSensor['data_state'] }) {
  const s = STATE[state];
  return (
    <Badge tone={s.tone} dot title={s.hint}>
      {s.label}
    </Badge>
  );
}

export function ConnectionBadge({ connection }: { connection: 'unknown' | 'online' | 'offline' }) {
  const tone: Tone = connection === 'online' ? 'ok' : connection === 'offline' ? 'crit' : 'off';
  const label =
    connection === 'unknown' ? 'Never connected' : connection === 'online' ? 'Online' : 'Offline';
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

/** "21.5 °C · 60 %RH", or why there is nothing to show. */
export function LatestValues({ sensor, now }: { sensor: FieldSensor; now?: string }) {
  const values = sensor.latest.filter((v) => v.value !== null);
  if (values.length === 0) return <span className={styles.muted}>No value yet</span>;
  const unused = !sensor.enabled;
  const at =
    values
      .map((v) => v.received_at)
      .sort()
      .at(-1) ?? null;
  return (
    <span className={styles.values} data-unused={unused || undefined}>
      {values.map((v) => (
        <span key={v.variable} title={v.label}>
          <b>{formatValue(v.value, v.decimals)}</b> {v.unit ?? ''}
        </span>
      ))}
      <span className={styles.muted}>
        {timeAgo(at, now)}
        {unused && ' · not used: this sensor is not enabled'}
      </span>
    </span>
  );
}

export const SCOPE_LABEL: Record<NonNullable<SensorScope>, string> = {
  device: 'Air around this ESP32',
  zone: 'A zone',
  container: 'A growing location',
  plant: 'A plant',
};

/** Choices for "where it measures", from the places Lefi Brain knows. */
/** Places a sensor can measure; with `zoneIds`, only inside those zones (a device's, ADR-083). */
export function targetsFor(
  scope: SensorScope,
  places: Places | undefined,
  plants: { id: string; code: string; name: string | null; zone_id: string }[],
  zoneIds?: readonly string[],
) {
  if (!places || scope === null || scope === 'device') return [];
  const inZones = (z: string) => !zoneIds || zoneIds.includes(z);
  const zoneName = new Map(places.zones.map((z) => [z.id, z.name]));
  if (scope === 'zone')
    return places.zones.filter((z) => inZones(z.id)).map((z) => ({ id: z.id, label: z.name }));
  if (scope === 'container')
    return places.containers
      .filter((c) => inZones(c.zone_id))
      .map((c) => ({
        id: c.id,
        label: `${c.code}${c.spot ? ` (${c.spot})` : ''} · ${zoneName.get(c.zone_id) ?? 'zone ?'}`,
      }));
  return plants
    .filter((p) => inZones(p.zone_id))
    .map((p) => ({ id: p.id, label: p.name ? `${p.code} · ${p.name}` : p.code }));
}

/** Two-step button for actions that take something away: the first click asks, the second does. */
export function ConfirmButton({
  label,
  confirm,
  icon,
  onConfirm,
  disabled,
}: {
  label: string;
  confirm: string;
  icon: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <Button variant="danger" icon={icon} disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  return (
    <span className={styles.assign}>
      <span className={styles.muted}>{confirm}</span>
      <Button
        variant="danger"
        icon={icon}
        disabled={disabled}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        Yes, {label.toLowerCase()}
      </Button>
      <Button variant="ghost" onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  );
}
