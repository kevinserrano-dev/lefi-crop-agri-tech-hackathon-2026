import { useQuery } from '@tanstack/react-query';
import { liveQueries, type DeviceEvent, type FieldDeviceDetail } from '@lefi/api';
import type { Tone } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { stamp } from '../../shared/lib/time';
import { Badge } from '../../shared/ui';
import styles from './live.module.css';

const RESET: Record<string, string> = {
  power_on: 'Power on',
  software: 'Software restart',
  panic: 'Crash (panic)',
  watchdog: 'Watchdog (it hung)',
  brownout: 'Brownout (power dip)',
  deep_sleep: 'Deep sleep',
  other: 'Other',
};

const EVENT: Record<string, string> = {
  boot: 'Started',
  sensor_lost: 'Sensor lost',
  sensor_recovered: 'Sensor back',
  sensor_errors: 'Repeated sensor errors',
  wifi_restored: 'Wi-Fi back',
  mqtt_restored: 'Broker connection back',
  rssi_weak: 'Weak Wi-Fi signal',
  rssi_ok: 'Wi-Fi signal OK',
  heap_low: 'Low memory',
  loop_slow: 'Board was slow',
};

const TONE: Record<DeviceEvent['severity'], Tone> = { info: 'info', warn: 'warn', crit: 'crit' };

function seconds(ms: unknown): string | null {
  return typeof ms === 'number' ? `${Math.round(ms / 1000)} s` : null;
}

/** Board and network health from its last heartbeat, as the board reported it (ADR-059). */
export function HealthFacts({ device }: { device: FieldDeviceDetail }) {
  const h = device.health;
  if (!h) return null;
  const rows: Array<[string, string | null]> = [
    ['Last restart', h.reset_reason ? (RESET[h.reset_reason] ?? h.reset_reason) : null],
    ['Wi-Fi drops since boot', h.wifi_reconnects?.toString() ?? null],
    ['Broker reconnects', h.mqtt_reconnects?.toString() ?? null],
    ['Not sent while offline', h.telemetry_skipped_offline?.toString() ?? null],
    [
      'Free memory (lowest)',
      h.free_heap != null
        ? `${Math.round(h.free_heap / 1024)} KB${h.min_free_heap != null ? ` (${Math.round(h.min_free_heap / 1024)} KB)` : ''}`
        : null,
    ],
    ['IP address', h.ip ?? null],
  ];
  return (
    <dl className={styles.facts}>
      {rows
        .filter(([, v]) => v !== null)
        .map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
    </dl>
  );
}

/** What the board said happened, newest first. Facts only: alerts come from Lefi Brain's rules. */
export function DeviceEvents({ id }: { id: string }) {
  const platform = usePlatform();
  const events = useQuery(liveQueries.deviceEvents(platform, id));
  const list = events.data ?? [];
  if (list.length === 0) return null;
  return (
    <div>
      <div className={styles.sectionHead}>
        <h3>What the board reported</h3>
      </div>
      <ul className={styles.events}>
        {list.slice(0, 10).map((e) => {
          const down = seconds(e.facts.down_ms);
          return (
            <li key={e.id}>
              <Badge tone={TONE[e.severity]} variant="tag">
                {EVENT[e.type] ?? e.type}
              </Badge>{' '}
              {e.sensor_id && <span className={styles.mono}>{e.sensor_id} </span>}
              {down && <span>after {down} </span>}
              {e.detail && <span className={styles.muted}>{e.detail} </span>}
              <span className={styles.muted}>· {stamp(e.received_at)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
