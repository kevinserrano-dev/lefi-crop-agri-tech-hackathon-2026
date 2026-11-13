import { describe, expect, it } from 'vitest';
import type { PairedDevice, PairedDevices } from '../console';
import { isThisPc, localState } from './pairing';

const dev = (over: Partial<PairedDevice>): PairedDevice => ({
  id: 'd1',
  name: 'Lefi Desktop on TEST',
  platform: 'macos',
  status: 'active',
  issued_at: '',
  expires_at: '',
  last_seen_at: null,
  revoked_at: null,
  revoked_reason: null,
  machine_id: null,
  ...over,
});
const data = (over: Partial<PairedDevices>): PairedDevices => ({
  available: true,
  devices: [],
  local_installed: true,
  ...over,
});

describe('Lefi Desktop on this PC', () => {
  it('is connected only with a usable pairing that Lefi Brain still accepts', () => {
    expect(
      localState(data({ local_paired: true, local_device_id: 'd1', devices: [dev({})] })),
    ).toBe('paired');
    expect(
      localState(
        data({ local_paired: true, local_device_id: 'd1', devices: [dev({ status: 'revoked' })] }),
      ),
    ).toBe('broken');
  });

  it('shows the last attempt instead of waiting silently', () => {
    const at = 1;
    expect(
      localState(data({ local_status: { state: 'retrying', message: 'x', url: null, at } })),
    ).toBe('retrying');
    expect(
      localState(data({ local_status: { state: 'failed', message: 'x', url: null, at } })),
    ).toBe('failed');
    expect(localState(data({ offer_waiting: true }))).toBe('connecting');
    expect(localState(data({ local_installed: false }))).toBe('not_installed');
  });

  it('recognises this PC by its machine id, also after its pairing files are gone', () => {
    const d = data({ local_machine_id: 'm'.repeat(64) });
    expect(isThisPc(dev({ id: 'old', machine_id: 'm'.repeat(64) }), d)).toBe(true);
    expect(isThisPc(dev({ id: 'other', machine_id: 'n'.repeat(64) }), d)).toBe(false);
  });
});
