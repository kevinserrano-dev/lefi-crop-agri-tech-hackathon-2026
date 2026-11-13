import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DeviceDetail } from '@lefi/api';
import type { ApiRequest, Platform } from '@lefi/platform';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { useToast } from '../../shared/ui';
import { DeviceDetailPanel } from './DeviceDetailPanel';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => () => undefined }));

const ok = { allowed: true, reason: null };
const NO_POWER =
  'Not available: LEFI CROP does not operate relays, PoE ports or other power controls.';

const device = (over: Partial<DeviceDetail> = {}): DeviceDetail => ({
  id: 'TEST-DEV-01',
  category: 'sensor',
  type: 'Fake probe',
  brand: 'Fake brand',
  model: 'Fake model',
  serial: 'FAKE-1',
  greenhouse_id: 'GH-T',
  zone_id: 'Z1',
  zone_label: 'Z1',
  position: 'Row 1',
  location_label: 'Test · Z1',
  protocol: 'LoRaWAN',
  firmware: '1.0.0',
  signal: '—',
  battery: '—',
  last_seen_label: '09:00',
  status: 'Online',
  health: 90,
  mode: 'on',
  lifecycle: 'ACTIVE',
  origin: 'SIMULATED',
  service: { interval_days: 90, due_days: 10, last: 'Oct 1', next: 'Nov 15' },
  power_control: 'Relay ch 1',
  installed: '—',
  warranty_until: '—',
  history: [],
  modes: {
    on: { allowed: false, reason: 'Already in this mode.' },
    ai: ok,
    paused: ok,
    off: { allowed: false, reason: NO_POWER },
  },
  actions: {
    schedule_maintenance: ok,
    approve: { allowed: false, reason: 'x' },
    reject: { allowed: false, reason: 'x' },
  },
  ...over,
});

function platformFor(d: DeviceDetail, calls: ApiRequest[]): Platform {
  const base = fakePlatform({ [`/devices/${d.id}`]: d });
  return {
    ...base,
    api: async <T,>(req: ApiRequest) => {
      calls.push(req);
      if (req.method === 'POST') return { item: { ...d, mode: 'ai' }, message: 'Isolated.' } as T;
      return base.api<T>(req);
    },
  };
}

describe('DeviceDetailPanel', () => {
  it('locks "Powered off" with the Brain’s reason (no actuator control)', async () => {
    renderWithProviders(<DeviceDetailPanel id="TEST-DEV-01" onRejected={() => undefined} />, {
      platform: platformFor(device(), []),
      session: session(['nav.devices']),
    });
    const off = await screen.findByRole('button', { name: /Powered off/ });
    expect(off).toHaveAttribute('title', NO_POWER);
    expect(off).toHaveAttribute('data-locked', 'true');
  });

  it('asks the Brain to change the mode and shows its answer', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<DeviceDetailPanel id="TEST-DEV-01" onRejected={() => undefined} />, {
      platform: platformFor(device(), calls),
      session: session(['nav.devices']),
    });
    await userEvent.click(await screen.findByRole('button', { name: /AI isolated/ }));
    await waitFor(() => expect(useToast.getState().toast?.msg).toBe('Isolated.'));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      path: '/devices/TEST-DEV-01/mode',
      body: { mode: 'ai' },
    });
  });

  it('shows approval for a pending (announced) device', async () => {
    renderWithProviders(<DeviceDetailPanel id="TEST-DEV-01" onRejected={() => undefined} />, {
      platform: platformFor(
        device({
          lifecycle: 'PENDING',
          status: 'Pending approval',
          actions: { schedule_maintenance: ok, approve: ok, reject: ok },
        }),
        [],
      ),
      session: session(['nav.devices']),
    });
    expect(await screen.findByText('Waiting for approval')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });
});
