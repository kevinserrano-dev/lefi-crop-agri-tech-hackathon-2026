import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  live,
  liveQueries,
  type DeviceCredentials,
  type DeviceNetwork,
  type Enrolment,
  type FieldDeviceDetail,
} from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { stamp } from '../../shared/lib/time';
import { Badge, Button, Dialog, FormField, Icon, Segmented, Select } from '../../shared/ui';
import { useLiveMutation, usePlaces } from './common';
import { AddRobotForm } from '../robots-live/RobotDevice';
import styles from './live.module.css';

export type AddMode = 'manual' | 'discovered' | 'robot';

const NETWORK_LABEL: Record<DeviceNetwork, string> = { wifi: 'Wi-Fi', ethernet: 'Ethernet (LAN)' };
const ALL_NETWORKS: DeviceNetwork[] = ['wifi', 'ethernet'];

/**
 * Add a device (ADR-058): by hand, or accept one that asked to join by itself. Either way it
 * starts with no sensors; they are added from the device, among those its type supports.
 */
export function AddNodeDialog({
  open,
  mode,
  onMode,
  onClose,
  onAdded,
  onRobotAdded,
}: {
  open: boolean;
  mode: AddMode;
  onMode: (m: AddMode) => void;
  onClose: () => void;
  onAdded: (id: string) => void;
  /** The simulated robot is being installed (ADR-090). */
  onRobotAdded?: () => void;
}) {
  const platform = usePlatform();
  const enrolments = useQuery({ ...liveQueries.enrolments(platform), enabled: open });
  const waiting = enrolments.data?.length ?? 0;
  return (
    <Dialog open={open} onClose={onClose} labelledBy="add-node-title" width={680}>
      <div className={styles.dialogHead}>
        <h2 id="add-node-title">Add device</h2>
        <button type="button" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={22} />
        </button>
      </div>
      <div className={styles.dialogTabs}>
        <Segmented<AddMode>
          label="How to add it"
          value={mode}
          onChange={onMode}
          options={[
            { value: 'manual', label: 'Manually' },
            {
              value: 'discovered',
              label: waiting ? `Asking to join (${waiting})` : 'Asking to join',
            },
            { value: 'robot', label: 'Simulated robot' },
          ]}
        />
      </div>
      {mode === 'robot' ? (
        <AddRobotForm onClose={onClose} onAdded={() => onRobotAdded?.()} />
      ) : mode === 'manual' ? (
        <ManualForm onClose={onClose} onAdded={onAdded} />
      ) : (
        <Discovered
          enrolments={enrolments.data}
          error={enrolments.isError ? describeError(enrolments.error) : undefined}
          onClose={onClose}
          onAdded={onAdded}
        />
      )}
    </Dialog>
  );
}

function ManualForm({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const platform = usePlatform();
  const places = usePlaces();
  const profiles = useQuery(liveQueries.profiles(platform));
  const [profileId, setProfileId] = useState('');
  const [name, setName] = useState('');
  const [zone, setZone] = useState('');
  const [network, setNetwork] = useState<DeviceNetwork | ''>('');
  const [mac, setMac] = useState('');
  const [simulated, setSimulated] = useState(false);
  const profile = profiles.data?.find((p) => p.id === profileId) ?? profiles.data?.[0];
  const supported = profile?.network ?? [];
  const net: DeviceNetwork | undefined =
    network && supported.includes(network) ? network : supported[0];
  const add = useLiveMutation(
    () =>
      live.addDevice(platform, {
        profile_id: profile?.id,
        name,
        zone_id: zone || null,
        network: net ?? null,
        mac: mac.trim() || null,
        simulated,
      }),
    (d) => `${d.name} added as ${d.id}`,
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate(undefined, {
      onSuccess: (d) => {
        setName('');
        setZone('');
        setMac('');
        setSimulated(false);
        onAdded(d.id);
      },
    });
  };
  return (
    <form onSubmit={submit}>
      <div className={styles.form}>
        <FormField label="Device type">
          <Select
            value={profile?.id ?? ''}
            onChange={(e) => {
              setProfileId(e.target.value);
              setNetwork('');
            }}
          >
            {(profiles.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Name">
          <input
            required
            maxLength={64}
            value={name}
            placeholder="e.g. Bench 1 node"
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
        <FormField label="How it connects">
          <Select value={net ?? ''} onChange={(e) => setNetwork(e.target.value as DeviceNetwork)}>
            {ALL_NETWORKS.map((n) => (
              <option key={n} value={n} disabled={!supported.includes(n)}>
                {NETWORK_LABEL[n]}
                {supported.includes(n) ? '' : ' — not on this device type'}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={`${net === 'ethernet' ? 'Ethernet' : 'Wi-Fi'} MAC (optional)`}>
          <input
            value={mac}
            placeholder="24:6F:28:AA:BB:CC"
            onChange={(e) => setMac(e.target.value)}
          />
        </FormField>
        <FormField label="Zone where it is placed (optional)" span={2}>
          <Select value={zone} onChange={(e) => setZone(e.target.value)}>
            <option value="">Not placed yet</option>
            {(places.data?.zones ?? []).map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </Select>
        </FormField>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={simulated}
            onChange={(e) => setSimulated(e.target.checked)}
          />
          <span>
            Simulated node — for tests and demos: its id starts with sim- and every reading is
            labelled SIMULATED
          </span>
        </label>
      </div>
      <p className={styles.note}>
        Lefi Brain gives it the next id (esp32-01, esp32-02…). It starts with no sensors: open it
        and add the ones that are wired, among those its type supports. Then create its connection
        password and write it into the board when you flash it.
      </p>
      <div className={styles.dialogFoot}>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" icon="add" disabled={add.isPending || !name.trim() || !profile}>
          Add
        </Button>
      </div>
    </form>
  );
}

function Discovered({
  enrolments,
  error,
  onClose,
  onAdded,
}: {
  enrolments: Enrolment[] | undefined;
  error?: string;
  onClose: () => void;
  onAdded: (id: string) => void;
}) {
  const platform = usePlatform();
  const [picked, setPicked] = useState<string>();
  const [creds, setCreds] = useState<DeviceCredentials>();
  const account = useLiveMutation(() => live.enrolmentAccount(platform));
  const list = enrolments ?? [];
  const current = list.find((e) => e.id === picked);
  return (
    <div>
      <p className={styles.note}>
        A Lefi Crop board flashed without its own password asks to join by itself. Accept it only
        with the <b>claim code</b> the board prints in the Serial Monitor (or on its label): that
        proves you have that board in hand. Its connection password then travels encrypted for that
        board alone.
      </p>
      {error ? (
        <p className={styles.pad}>{error}</p>
      ) : list.length === 0 ? (
        <p className={`${styles.muted} ${styles.pad}`}>
          No device is asking to join. Boards need the shared enrolment password in their firmware
          to ask.
        </p>
      ) : (
        <div className={styles.enrolList}>
          {list.map((e) => (
            <button
              key={e.id}
              type="button"
              className={styles.enrolRow}
              aria-pressed={e.id === picked}
              onClick={() => setPicked(e.id)}
            >
              <span>
                <b>{e.profile_name ?? e.profile_id}</b>{' '}
                <span className={styles.mono}>{e.hardware_id}</span>
              </span>
              <span className={styles.muted}>
                {NETWORK_LABEL[e.network]} · MAC {e.mac} · firmware {e.firmware} · first asked{' '}
                {stamp(e.first_seen_at)} · {e.requests}×
              </span>
              {e.same_hardware > 0 && (
                <Badge tone="warn" variant="tag">
                  {e.same_hardware + 1} requests with this hardware id: only one matches the board
                </Badge>
              )}
            </button>
          ))}
        </div>
      )}
      {current && <AcceptForm key={current.id} enrolment={current} onAdded={onAdded} />}
      <div className={styles.dialogFoot}>
        <Button
          type="button"
          variant="secondary"
          icon="key"
          disabled={account.isPending}
          title="The shared password boards use to ask to join. Creating a new one stops the old one."
          onClick={() => account.mutate(undefined, { onSuccess: (c) => setCreds(c) })}
        >
          Enrolment password for firmware
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <CredentialsDialog credentials={creds} shared onClose={() => setCreds(undefined)} />
    </div>
  );
}

function AcceptForm({
  enrolment,
  onAdded,
}: {
  enrolment: Enrolment;
  onAdded: (id: string) => void;
}) {
  const platform = usePlatform();
  const places = usePlaces();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [zone, setZone] = useState('');
  const accept = useLiveMutation(
    () =>
      live.acceptEnrolment(platform, enrolment.id, {
        claim_code: code,
        name,
        zone_id: zone || null,
      }),
    (d: FieldDeviceDetail) => `${d.name} joined as ${d.id}`,
  );
  const reject = useLiveMutation(
    () => live.rejectEnrolment(platform, enrolment.id),
    () => 'Request rejected',
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        accept.mutate(undefined, { onSuccess: (d) => onAdded(d.id) });
      }}
    >
      <div className={styles.form}>
        <FormField label="Claim code (from the board)">
          <input
            required
            value={code}
            autoComplete="off"
            spellCheck={false}
            placeholder="ABCD-EFGH-JKLM"
            className={styles.mono}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </FormField>
        <FormField label="Name">
          <input
            required
            maxLength={64}
            value={name}
            placeholder="e.g. Bench 2 node"
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
        <FormField label="Zone where it is placed (optional)" span={2}>
          <Select value={zone} onChange={(e) => setZone(e.target.value)}>
            <option value="">Not placed yet</option>
            {(places.data?.zones ?? []).map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </Select>
        </FormField>
        {enrolment.wrong_codes > 0 && (
          <span className={styles.muted} style={{ gridColumn: 'span 2' }}>
            {enrolment.wrong_codes} wrong code(s) so far; after 5 the request is rejected.
          </span>
        )}
      </div>
      <div className={styles.dialogFoot}>
        <Button
          type="button"
          variant="danger"
          icon="block"
          disabled={reject.isPending}
          onClick={() => reject.mutate(undefined)}
        >
          Reject
        </Button>
        <Button
          type="submit"
          icon="verified"
          disabled={accept.isPending || !code.trim() || !name.trim()}
        >
          Accept
        </Button>
      </div>
    </form>
  );
}

/** Shown once: Lefi Brain keeps only a hash, so closing this loses the password for good. */
export function CredentialsDialog({
  credentials,
  shared = false,
  onClose,
}: {
  credentials: DeviceCredentials | undefined;
  /** The enrolment account every new board uses, not one device's. */
  shared?: boolean;
  onClose: () => void;
}) {
  const rows: Array<[string, string]> = credentials
    ? [
        ...(shared ? [] : ([['Device id', credentials.device_id]] as Array<[string, string]>)),
        ['Broker', `${credentials.host}:${credentials.port}`],
        ['Username', credentials.username],
        ['Password', credentials.password],
      ]
    : [];
  return (
    <Dialog open={!!credentials} onClose={onClose} labelledBy="creds-title" width={620}>
      <div className={styles.dialogHead}>
        <h2 id="creds-title">
          {shared ? 'Enrolment password' : `Connection details for ${credentials?.device_id}`}
        </h2>
      </div>
      <p className={styles.note}>
        {shared
          ? 'Shown only now. Put it in the firmware of boards that should ask to join by themselves (secrets.h). It only lets a board ask; nothing joins until a person accepts it with its claim code. The previous enrolment password has stopped working.'
          : 'Shown only now. Lefi Brain does not keep this password: write it into the ESP32 when you flash it. Any earlier password of this device has stopped working.'}
      </p>
      {rows.map(([k, v]) => (
        <div key={k} className={styles.secret}>
          <span className={styles.muted}>{k}</span>
          <code>{v}</code>
          <Button
            size="sm"
            variant="ghost"
            icon="content_copy"
            aria-label={`Copy ${k}`}
            onClick={() => void navigator.clipboard?.writeText(v)}
          />
        </div>
      ))}
      <div className={styles.dialogFoot} style={{ paddingTop: 16 }}>
        <Button onClick={onClose}>I saved it</Button>
      </div>
    </Dialog>
  );
}

/** The sensors this device's type supports and that are not added yet (ADR-058). */
export function AddSensorDialog({
  device,
  open,
  onClose,
}: {
  device: FieldDeviceDetail;
  open: boolean;
  onClose: () => void;
}) {
  const platform = usePlatform();
  const add = useLiveMutation(
    (key: string) => live.addSensor(platform, device.id, key),
    (s) => `${s.channel.label} added — enable it once it is wired`,
  );
  const options = device.available_sensors;
  return (
    <Dialog open={open} onClose={onClose} labelledBy="add-sensor-title" width={640}>
      <div className={styles.dialogHead}>
        <h2 id="add-sensor-title">Add a sensor to {device.name}</h2>
        <button type="button" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={22} />
        </button>
      </div>
      <p className={styles.note}>
        Only the sensors a <b>{device.profile_id}</b> supports are offered. A sensor is added
        switched off: enable it when it is wired and say what it measures.
      </p>
      {options.length === 0 ? (
        <p className={`${styles.muted} ${styles.pad}`}>
          Every sensor this device type supports is already added.
        </p>
      ) : (
        <div className={styles.enrolList}>
          {options.map(({ channel: c, detected }) => (
            <div key={c.sensor_key} className={styles.sensorOption}>
              <span>
                <b>{c.label}</b>{' '}
                <span className={styles.mono}>
                  {c.sensor_key} · {c.model ?? 'model not confirmed'}
                  {c.interface ? ` · ${c.interface}` : ''}
                </span>
                <br />
                <span className={styles.muted}>
                  Measures{' '}
                  {c.variables.map((v) => `${v.label}${v.unit ? ` (${v.unit})` : ''}`).join(', ')}
                </span>
              </span>
              <span className={styles.assign}>
                {detected === true && (
                  <Badge tone="ok" variant="tag" title="The device reported it at boot">
                    Detected
                  </Badge>
                )}
                {detected === false && (
                  <Badge tone="off" variant="tag" title="The device did not find it at boot">
                    Not detected
                  </Badge>
                )}
                {!c.model_confirmed && (
                  <Badge tone="warn" variant="tag" title="Can be added, not enabled">
                    Model not confirmed
                  </Badge>
                )}
                <Button
                  size="sm"
                  icon="add"
                  disabled={add.isPending}
                  onClick={() => add.mutate(c.sensor_key)}
                >
                  Add
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}
      <div className={styles.dialogFoot}>
        <Button type="button" variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}
