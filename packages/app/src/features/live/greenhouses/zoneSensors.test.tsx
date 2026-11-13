import { screen } from '@testing-library/react';
import type { ZoneItem } from '@lefi/api';
import { fakePlatform, renderWithProviders, session } from '../../../test/render';
import { ZoneSensors } from './ZoneView';

const zoneB = { id: 'zb', greenhouse_id: 'g1', name: 'Zona B' } as ZoneItem;
const zoneC = { id: 'zc', greenhouse_id: 'g1', name: 'Zona C' } as ZoneItem;

const channel = (label: string) => ({
  key: label,
  label,
  kind: 'air',
  variables: [{ variable: 'air_temperature', label: 'Air temperature', unit: '°C', decimals: 1 }],
  scopes: ['zone'],
  default_scope: 'zone',
});

const sensor = (key: string, label: string, zone: string) => ({
  id: `esp32-04:${key}`,
  device_id: 'esp32-04',
  sensor_key: key,
  channel: channel(label),
  enabled: true,
  scope: 'zone',
  target_id: zone,
  target_label: zone,
  zone_id: zone,
  data_state: 'receiving',
  detected: true,
  last_value_at: '2026-11-12T05:25:55Z',
  last_error: null,
  last_error_at: null,
  latest: [],
  enabled_at: null,
});

// The owner's real layout: ESP32-01 is installed in Zona B and serves B and C; two of its
// sensors measure in Zona C.
const device = {
  id: 'esp32-04',
  name: 'ESP32-01',
  status: 'ACTIVE',
  origin: 'LIVE',
  zone_id: 'zb',
  zone_ids: ['zb', 'zc'],
};

const platform = () =>
  fakePlatform({
    '/field-devices': [device],
    '/field-devices/esp32-04': {
      ...device,
      sensors: [
        sensor('air-1', 'Air B', 'zb'),
        sensor('air-2', 'Air C', 'zc'),
        sensor('water-temp-2', 'Water C', 'zc'),
      ],
    },
  });

describe('Sensors of a zone (ADR-083, ADR-092)', () => {
  it('shows in Zona C the sensors measuring there, though their device is installed in B', async () => {
    renderWithProviders(<ZoneSensors zone={zoneC} now="2026-11-12T05:26:00Z" />, {
      platform: platform(),
      session: session(['nav.devices']),
    });
    expect(await screen.findByText('Air C')).toBeInTheDocument();
    expect(screen.getByText('Water C')).toBeInTheDocument();
    expect(screen.queryByText('Air B')).not.toBeInTheDocument();
  });

  it('keeps Zona C’s sensors out of Zona B', async () => {
    renderWithProviders(<ZoneSensors zone={zoneB} now="2026-11-12T05:26:00Z" />, {
      platform: platform(),
      session: session(['nav.devices']),
    });
    expect(await screen.findByText('Air B')).toBeInTheDocument();
    expect(screen.queryByText('Air C')).not.toBeInTheDocument();
    expect(screen.queryByText('Water C')).not.toBeInTheDocument();
  });
});
