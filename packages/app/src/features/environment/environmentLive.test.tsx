import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EnvironmentView } from '@lefi/api';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { EnvironmentLive } from './EnvironmentLive';

const NOW = '2026-11-11T10:00:00Z';
const HEALTH = { status: 'ok', service: 'lefi-brain', version: '0.7.1', time: NOW };

const view: EnvironmentView = {
  brain_time: NOW,
  zones: [
    {
      id: 'z1',
      name: 'Fake zone A',
      code: 'ZA',
      greenhouse: 'Fake GH',
      status: 'active',
      sensors: 1,
      alerts_critical: 0,
      alerts_warning: 1,
    },
    {
      id: 'z2',
      name: 'Fake zone B',
      code: 'ZB',
      greenhouse: 'Fake GH',
      status: 'active',
      sensors: 0,
      alerts_critical: 0,
      alerts_warning: 0,
    },
  ],
  zone_id: 'z1',
  window: { range: '24h', since: '2026-11-10T10:00:00Z', step_s: 1800, count: 4 },
  values: [
    {
      sensor_id: 'fake:air-1',
      sensor: 'Air temperature and humidity',
      device: 'Fake node',
      place: 'air around Fake node',
      origin: 'SIMULATED',
      state: 'receiving',
      variable: 'air_temperature',
      label: 'Air temperature',
      unit: '°C',
      value: 21.5,
      received_at: '2026-11-11T09:59:50Z',
      range: { min: 18, max: 20, rule: 'Fake range' },
      in_range: false,
    },
    {
      sensor_id: 'fake:tds-1',
      sensor: 'TDS',
      device: 'Fake node',
      place: 'Fake zone A',
      origin: 'LIVE',
      state: 'no_data',
      variable: 'water_tds',
      label: 'Water TDS',
      unit: 'ppm',
      value: null,
      received_at: null,
      range: null,
      in_range: null,
    },
  ],
  series: [
    {
      variable: 'air_temperature',
      label: 'Air temperature',
      unit: '°C',
      sensors: 1,
      origins: ['SIMULATED'],
      values: [null, 19.5, 20.5, 21.5],
      range: { min: 18, max: 20, rule: 'Fake range' },
      stats: {
        current: 21.5,
        average: 20.5,
        min: 19.5,
        max: 21.5,
        time_in_range: 0.5,
        readings: 3,
      },
    },
    {
      variable: 'water_tds',
      label: 'Water TDS',
      unit: 'ppm',
      sensors: 1,
      origins: ['LIVE'],
      values: [60, 62, null, 66],
      range: null,
      stats: { current: null, average: 62.7, min: 60, max: 66, time_in_range: null, readings: 3 },
    },
  ],
  rules: [
    {
      id: 'r1',
      name: 'Fake range',
      variable: 'air_temperature',
      label: 'Air temperature',
      unit: '°C',
      min: 18,
      max: 20,
      applies_to: 'zone',
      target_id: 'z1',
      severity: 'warning',
    },
  ],
  can_configure: false,
  irrigation: { available: false, reason: 'Irrigation is disabled by design (test).' },
};

describe('EnvironmentLive', () => {
  it('shows a zone from what Lefi Brain holds, with provenance and people’s ranges', async () => {
    renderWithProviders(<EnvironmentLive />, {
      platform: fakePlatform({ '/environment': view, '/health': HEALTH }),
      session: session(['nav.environment']),
    });
    expect(await screen.findByRole('button', { name: /ZA/ })).toBeInTheDocument();
    expect(screen.getByText('Outside the range')).toBeInTheDocument();
    // A sensor without current data gets no card (never a made-up value); it stays listed below.
    expect(screen.queryByText('No data')).not.toBeInTheDocument();
    // Its only button is its history chart, not a value card.
    expect(
      screen.getAllByRole('button', { name: /Water TDS/ }).map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Show Water TDS history']);
    expect(screen.getByText('fake:tds-1')).toBeInTheDocument();
    expect(screen.getAllByText(/SIMULATED|SIM ·/).length).toBeGreaterThan(0);
    expect(screen.getByText('50 %')).toBeInTheDocument();
    expect(screen.getByText('Air temperature · ZA')).toBeInTheDocument();
    // Irrigation is never controllable; no pump button exists.
    expect(screen.getByText('Irrigation is disabled by design (test).')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pump/i })).not.toBeInTheDocument();
    // Ranges come from people; without env.configure there is nothing to configure.
    expect(screen.getByText('this zone', { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Configure ranges' })).not.toBeInTheDocument();
  });

  it('charts every other measurement it has, and makes the chosen one the main chart', async () => {
    renderWithProviders(<EnvironmentLive />, {
      platform: fakePlatform({ '/environment': view, '/health': HEALTH }),
      session: session(['nav.environment']),
    });
    const tds = await screen.findByRole('button', { name: 'Show Water TDS history' });
    expect(screen.queryByRole('button', { name: 'Show Air temperature history' })).toBeNull();
    await userEvent.click(tds);
    expect(await screen.findByText('Water TDS · ZA')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show Air temperature history' }),
    ).toBeInTheDocument();
  });

  it('says so when a zone has no sensor, instead of drawing anything', async () => {
    renderWithProviders(<EnvironmentLive />, {
      platform: fakePlatform({
        '/environment': { ...view, zone_id: 'z2', values: [], series: [], rules: [] },
        '/health': HEALTH,
      }),
      session: session(['nav.environment']),
    });
    expect(await screen.findByText('No sensor measures in Fake zone B yet')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Trend chart' })).not.toBeInTheDocument();
    // No crop and no rule: nothing is invented, and it says how a range comes to apply.
    expect(screen.getByText(/No crop grows in Fake zone B/)).toBeInTheDocument();
    expect(screen.getByText(/None — the species’ ranges above are used/)).toBeInTheDocument();
  });

  it('shows the species’ ranges of the zone and why a crop gives none (ADR-097)', async () => {
    renderWithProviders(<EnvironmentLive />, {
      platform: fakePlatform({
        '/environment': {
          ...view,
          rules: [],
          crop_ranges: [
            {
              crop: 'Spinach',
              profile: 'Spinach v2',
              profile_id: 'p2',
              measurement: 'air_temperature',
              label: 'Air temperature',
              unit: '°C',
              optimal: [25, 32],
              warning: [null, null],
              critical: [null, null],
              verification: 'unverified',
              stage: null,
              max_change: null,
              change_window_min: null,
            },
          ],
          crops: [
            {
              crop: 'Spinach (Malabar Spinach)',
              crop_type_id: 'c1',
              plants: 2,
              batch: false,
              knowledge: 'ranges',
              profile: 'Spinach v2',
              profile_id: 'p2',
              parameters: 1,
              draft_id: null,
            },
            {
              crop: 'Lettuce',
              crop_type_id: 'c2',
              plants: null,
              batch: true,
              knowledge: 'no_parameters',
              profile: 'Lettuce v1',
              profile_id: 'p3',
              parameters: 0,
              draft_id: null,
            },
          ],
          can_edit_knowledge: true,
        },
        '/health': HEALTH,
      }),
      session: session(['nav.environment']),
    });
    expect(await screen.findByRole('table', { name: 'Species ranges' })).toBeInTheDocument();
    expect(screen.getByText(/25 – 32 °C/)).toBeInTheDocument();
    expect(screen.getByText(/published profile has no parameters/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /species ranges/i })).toBeInTheDocument();
  });
});
