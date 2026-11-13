import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queries, type NewDevice } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { Button, Dialog, FormField, Icon } from '../../shared/ui';
import { useDeviceActions } from './useDeviceActions';
import styles from './devices.module.css';

const TYPES = [
  'Temp / RH probe',
  'PAR light sensor',
  'Substrate moisture',
  'pH probe',
  'EC / TDS probe',
  'CO₂ sensor',
  'Vision camera',
];
const PROTOCOLS = [
  'LoRaWAN',
  'SDI-12 → LoRaWAN',
  'Wi-Fi',
  'PoE / Ethernet',
  'MQTT · Wi-Fi',
  'Zigbee',
];

/**
 * Register device (design wizard). A registered device is only a PENDING record until it
 * announces itself and a technician approves it (ADR-016). QR scanning needs a camera flow
 * that the desktop app does not have yet.
 */
export function RegisterDeviceDialog({
  open,
  onClose,
  onRegistered,
}: {
  open: boolean;
  onClose: () => void;
  onRegistered?: (id: string) => void;
}) {
  const [step, setStep] = useState<'method' | 'form'>('method');
  const close = () => {
    setStep('method');
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} labelledBy="reg-title" width={840}>
      <div className={styles.dialogHead}>
        <div>
          <span id="reg-title" className={styles.dialogTitle}>
            Register device
          </span>
          <span className={styles.muted}>
            Sensors and cameras · new devices start as PENDING until approved
          </span>
        </div>
        <button type="button" className={styles.close} aria-label="Close" onClick={close}>
          <Icon name="close" size={22} />
        </button>
      </div>
      {step === 'method' ? (
        <Method onManual={() => setStep('form')} />
      ) : (
        <RegisterForm
          onBack={() => setStep('method')}
          onDone={(id) => {
            close();
            onRegistered?.(id);
          }}
        />
      )}
    </Dialog>
  );
}

function Method({ onManual }: { onManual: () => void }) {
  return (
    <>
      <div className={styles.methods}>
        <button
          type="button"
          className={styles.method}
          disabled
          title="Not available yet: the desktop app has no camera scanning flow"
        >
          <Icon name="qr_code_scanner" size={34} color="var(--lefi-text-faint)" />
          <b>Scan QR or barcode</b>
          <span>
            Not available on the desktop yet. Use the mobile app (planned) or enter the label
            manually.
          </span>
        </button>
        <button type="button" className={styles.method} onClick={onManual}>
          <Icon name="edit_note" size={34} color="var(--lefi-forest-800)" />
          <b>Enter manually</b>
          <span>
            For devices without a code, damaged labels or models not yet in the catalogue.
          </span>
        </button>
      </div>
      <div className={styles.infoNote}>
        <Icon name="info" size={18} />
        ESP32 nodes register themselves when they announce on the network; they appear here as
        “Pending approval”. Location and service interval are always confirmed by you.
      </div>
    </>
  );
}

function RegisterForm({ onBack, onDone }: { onBack: () => void; onDone: (id: string) => void }) {
  const platform = usePlatform();
  const zones = useQuery(queries.zones(platform));
  const { register } = useDeviceActions(undefined);
  const [f, setF] = useState<NewDevice>({
    type: 'Substrate moisture',
    brand: '',
    model: '',
    serial: '',
    zone_id: '',
    protocol: 'LoRaWAN',
    interval_days: 90,
  });
  const set = (k: keyof NewDevice) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: k === 'interval_days' ? Number(e.target.value) : e.target.value }));
  const zoneId = f.zone_id || zones.data?.[0]?.id || '';

  function submit(e: FormEvent) {
    e.preventDefault();
    register.mutate({ ...f, zone_id: zoneId }, { onSuccess: (r) => onDone(r.item.id) });
  }

  return (
    <form onSubmit={submit} className={styles.regForm}>
      <div className={styles.regGrid}>
        <FormField label="Device type *">
          <select value={f.type} onChange={set('type')}>
            {TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Brand / manufacturer *">
          <input value={f.brand} onChange={set('brand')} placeholder="As printed on the label" />
        </FormField>
        <FormField label="Model *">
          <input value={f.model} onChange={set('model')} placeholder="As printed on the label" />
        </FormField>
        <FormField label="Serial number *">
          <input value={f.serial} onChange={set('serial')} placeholder="From label" />
        </FormField>
        <FormField label="MAC / DevEUI">
          <input value={f.mac ?? ''} onChange={set('mac')} />
        </FormField>
        <FormField label="Firmware">
          <input value={f.firmware ?? ''} onChange={set('firmware')} />
        </FormField>
        <FormField label="Zone *">
          <select value={zoneId} onChange={set('zone_id')}>
            {zones.data?.map((z) => (
              <option key={z.id} value={z.id}>
                {z.id} · {z.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Exact position">
          <input
            value={f.position ?? ''}
            onChange={set('position')}
            placeholder="Row 14 · post 3 · 0.4 m"
          />
        </FormField>
        <FormField label="Protocol">
          <select value={f.protocol} onChange={set('protocol')}>
            {PROTOCOLS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Service every (days)">
          <input
            type="number"
            min={1}
            value={f.interval_days ?? 90}
            onChange={set('interval_days')}
          />
        </FormField>
      </div>
      <div className={styles.infoNote}>
        <Icon name="lock" size={18} />
        Power control is not configurable: LEFI CROP does not operate relays or PoE ports. New
        devices start AI-isolated and PENDING.
      </div>
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" disabled={register.isPending}>
          Save device
        </Button>
      </div>
    </form>
  );
}
