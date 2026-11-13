import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OperatingRanges, Zone, ZoneHistory } from '@lefi/api';
import type { ApiRequest, Platform } from '@lefi/platform';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { useToast } from '../../shared/ui';
import { HistoryCard } from './HistoryCard';
import { OperatingRangesCard } from './OperatingRangesCard';

const zone: Zone = {
  id: 'Z1',
  name: 'Test zone',
  greenhouse_id: 'GH-T',
  greenhouse_name: 'Test house',
  crop: null,
  health: 'HEALTHY',
};
const base: ZoneHistory = {
  zone_id: 'Z1',
  variable: 'ph',
  label: 'pH',
  unit: 'pH',
  decimals: 2,
  range: { min: 5.6, max: 6.2, is_placeholder: true },
  source: 'estimate',
  origin: 'SIMULATED',
  freshness: 'LIVE',
  labels: ['2026-11-05T08:00:00Z', '2026-11-05T09:00:00Z'],
  values: [5.8, 5.9],
  stats: { current: 5.9, average: 5.85, min: 5.8, max: 5.9, time_in_range_pct: 100 },
  unavailable_note: null,
};
const path = '/zones/Z1/history';

describe('HistoryCard', () => {
  it('labels model estimates as not a measurement', async () => {
    renderWithProviders(
      <HistoryCard zone={zone} variable="ph" range="24h" onRange={() => undefined} />,
      {
        platform: fakePlatform({ [path]: base }),
      },
    );
    expect(await screen.findByText(/Estimated values — no sensor installed/)).toBeInTheDocument();
    expect(screen.getByText('100 %')).toBeInTheDocument();
  });

  it('shows the Brain’s note when the sensor has no data', async () => {
    renderWithProviders(
      <HistoryCard zone={zone} variable="ph" range="24h" onRange={() => undefined} />,
      {
        platform: fakePlatform({
          [path]: {
            ...base,
            source: 'none',
            values: [],
            labels: [],
            stats: null,
            unavailable_note: 'Probe offline since 06:12.',
          },
        }),
      },
    );
    expect(await screen.findByText('Sensor unavailable')).toBeInTheDocument();
    expect(screen.getByText('Probe offline since 06:12.')).toBeInTheDocument();
  });
});

const ranges: OperatingRanges = {
  profile: { id: 'p', name: 'Fake profile', is_placeholder: true },
  rows: [{ variable: 'rh', label: 'Relative humidity', unit: '%', min: 60, max: 75, step: 1 }],
  can_edit: { allowed: true, reason: null },
};

describe('OperatingRangesCard', () => {
  it('sends edited ranges to the Brain and shows its message', async () => {
    const calls: ApiRequest[] = [];
    const p0 = fakePlatform({ '/operating-ranges': ranges });
    const platform: Platform = {
      ...p0,
      api: async <T,>(req: ApiRequest) => {
        calls.push(req);
        if (req.method === 'PUT') return { item: ranges, message: 'Saved.' } as T;
        return p0.api<T>(req);
      },
    };
    renderWithProviders(<OperatingRangesCard />, {
      platform,
      session: session(['nav.environment']),
    });
    expect(await screen.findByText('Placeholder profile')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Configure ranges' }));
    const max = screen.getByLabelText('Relative humidity max');
    await userEvent.clear(max);
    await userEvent.type(max, '74');
    await userEvent.click(screen.getByRole('button', { name: 'Save & apply' }));
    await waitFor(() => expect(useToast.getState().toast?.msg).toBe('Saved.'));
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
      body: { rows: [{ variable: 'rh', min: 60, max: 74 }] },
    });
  });
});
