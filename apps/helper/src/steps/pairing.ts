/** What this card says about the Lefi Desktop of this PC (ADR-055). Pure, tested. */
import type { PairedDevice, PairedDevices } from '../console';
import type { Tone } from '../ui';

export type LocalState =
  'not_installed' | 'paired' | 'connecting' | 'retrying' | 'failed' | 'broken';

/** A device is this PC when its machine id matches, or it is the pairing Lefi Desktop holds here. */
export function isThisPc(d: PairedDevice, data: PairedDevices): boolean {
  return (
    (!!data.local_machine_id && d.machine_id === data.local_machine_id) ||
    d.id === data.local_device_id
  );
}

export function localState(data: PairedDevices): LocalState {
  if (!data.local_installed) return 'not_installed';
  const active = data.devices.some((d) => d.status === 'active' && d.id === data.local_device_id);
  if (data.local_paired && active) return 'paired';
  const st = data.local_status?.state;
  if (st === 'retrying') return 'retrying';
  if (data.offer_waiting || st === 'pairing') return 'connecting';
  if (st === 'failed') return 'failed';
  // A pairing Lefi Brain no longer accepts: the main service replaces it within minutes.
  if (data.local_device_id) return 'broken';
  return 'connecting';
}

export const LOCAL_TEXT: Record<LocalState, { label: string; tone: Tone; text: string }> = {
  not_installed: {
    label: 'Not installed',
    tone: 'off',
    text: 'Lefi Desktop is not installed on this PC.',
  },
  paired: {
    label: 'Connected',
    tone: 'ok',
    text: 'Lefi Desktop on this PC reaches Lefi Brain. People sign in with their username and password.',
  },
  connecting: {
    label: 'Connecting…',
    tone: 'info',
    text: 'Lefi Crop Helper is connecting Lefi Desktop on this PC by itself. Open Lefi Desktop if it is closed.',
  },
  retrying: {
    label: 'Trying again',
    tone: 'warn',
    text: 'Lefi Desktop could not reach Lefi Brain yet and keeps trying by itself.',
  },
  failed: {
    label: 'Not connected',
    tone: 'crit',
    text: 'The last attempt failed. A new one starts by itself; “Connect again” starts it now.',
  },
  broken: {
    label: 'Needs a new connection',
    tone: 'warn',
    text: 'Its connection was revoked or replaced. It is replaced by itself within a few minutes; “Connect again” does it now.',
  },
};
