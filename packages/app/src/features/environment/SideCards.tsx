import { useQuery } from '@tanstack/react-query';
import { queries, type Zone } from '@lefi/api';
import { toneVars } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { ActionButton, Card, Icon, ProvenanceBadge, useToast } from '../../shared/ui';
import { statusTone } from '../devices/presentation';
import { useCan } from '../session';
import styles from './environment.module.css';

/** Pump card in the design's place, locked: irrigation is interface-only (no actuator control). */
export function IrrigationPumpCard({ zone }: { zone: Zone }) {
  const irrigation = useQuery(queries.irrigation(usePlatform()));
  const toast = useToast((s) => s.show);
  // The Brain reports irrigation as DISABLED by design; the control stays locked with its reason.
  const reason = irrigation.data?.reason ?? 'Irrigation is disabled by design.';
  const locked = { allowed: false, reason };
  return (
    <Card className={styles.side}>
      <div className={styles.sideHead}>
        <span className={styles.sideTitle}>Irrigation pump</span>
        <span className={styles.mono}>PUMP-{zone.greenhouse_id}-A</span>
      </div>
      <div className={styles.pump}>
        <span className={styles.pumpIcon}>
          <Icon name="water_pump" size={24} />
        </span>
        <div className={styles.pumpText}>
          <b>Disabled by design</b>
          <span>Interface only — LEFI CROP never operates pumps or valves.</span>
        </div>
      </div>
      <ActionButton
        label="Pause pump"
        icon="power_settings_new"
        availability={locked}
        onClick={() => toast(reason, 'bad')}
      />
    </Card>
  );
}

/** Sensors and actuators of the zone with their link status (design: "Device connectivity"). */
export function ConnectivityCard({ zone }: { zone: Zone }) {
  const platform = usePlatform();
  const allowed = useCan('nav.devices');
  const devices = useQuery({ ...queries.devices(platform, { zone: zone.id }), enabled: allowed });
  const rows =
    devices.data?.filter((d) => d.category === 'sensor' || d.category === 'actuator') ?? [];
  return (
    <Card title="Device connectivity" className={styles.side}>
      {!allowed && <span className={styles.muted}>Your role cannot view the device registry.</span>}
      {rows.map((d) => {
        const t = toneVars(statusTone(d.status));
        return (
          <div key={d.id} className={styles.connRow}>
            <span className={styles.dot} style={{ background: t.dot }} />
            <div className={styles.connText}>
              <span className={styles.mono}>{d.id}</span>
              <span className={styles.muted}>
                {d.type} · {d.status} · {d.last_seen_label}
              </span>
            </div>
            <ProvenanceBadge origin={d.origin} />
          </div>
        );
      })}
    </Card>
  );
}
