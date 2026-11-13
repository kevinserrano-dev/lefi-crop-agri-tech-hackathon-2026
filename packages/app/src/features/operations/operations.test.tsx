import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Overview, OverviewTrends, PlantHealthPage, PlantObservation } from '@lefi/api';
import type { ApiRequest, Platform } from '@lefi/platform';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { DashboardLive } from './DashboardLive';
import { PlantHealthLive } from './PlantHealthLive';

const NOW = '2026-11-10T10:00:00Z';
const HEALTH = { status: 'ok', service: 'lefi-brain', version: '0.5.1', time: NOW };
const VISION = { available: false as const, reason: 'No camera images reach Lefi Brain (test).' };

const overview: Overview = {
  brain_time: NOW,
  places: { greenhouses: 1, zones: 1, locations: 2, plants: 1, active_crops: 1, crop_plants: 12 },
  zones: [
    {
      id: 'z1',
      name: 'Fake zone',
      greenhouse: 'Fake GH',
      status: 'active',
      plants: 12,
      active_crops: 1,
      alerts_critical: 0,
      alerts_warning: 1,
    },
  ],
  crops: [{ crop: 'Fake lettuce', assignments: 1, plants: 12 }],
  plant_health: {
    plants: 1,
    healthy: 0,
    watch: 0,
    problem: 1,
    not_checked: 0,
    open_requests: 0,
    recent: [
      {
        plant_id: 'p1',
        plant: 'P-FAKE',
        health: 'problem',
        issues: ['pest'],
        by: 'Fake Scout',
        at: NOW,
      },
    ],
    vision: VISION,
  },
  devices: {
    total: 1,
    online: 1,
    offline: 0,
    never_connected: 0,
    pending: 0,
    simulated: 1,
    sensors: { receiving: 1 },
  },
  readings: [
    {
      sensor_id: 'fake:air',
      sensor: 'Air temperature',
      device: 'Fake ESP32',
      place: 'Fake zone',
      zone_id: 'z1',
      origin: 'SIMULATED',
      state: 'receiving',
      values: [
        {
          variable: 'temperature',
          label: 'Temperature',
          value: 21.5,
          unit: '°C',
          received_at: NOW,
          range: { min: 15, max: 20, rule: 'Fake range' },
          in_range: false,
        },
      ],
    },
  ],
  ai: {
    state: 'unconfigured',
    reason: 'OLLAMA_MODEL is not set (test).',
    model: null,
    kill_switch: false,
  },
  people: { active_users: 3, signed_in_now: 1 },
  alerts: {
    active: 1,
    critical: 0,
    warning: 1,
    unacknowledged: 1,
    latest: [
      {
        id: 'a1',
        title: 'Fake ESP32 is not in contact',
        severity: 'warning',
        status: 'open',
        subject: 'Fake ESP32',
        subject_kind: 'device',
        zone_id: 'z1',
        origin: 'SIMULATED',
        opened_at: NOW,
        updated_at: NOW,
      },
    ],
    monitor_state: 'watching',
    monitor_reason: 'watching (test)',
  },
};

const DAYS = Array.from(
  { length: 30 },
  (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
);
const trends: OverviewTrends = {
  brain_time: NOW,
  recent: { since: '2026-11-10T08:00:00Z', step_s: 300, count: 24 },
  sensors: [
    {
      sensor_id: 'fake:air',
      variable: 'temperature',
      values: [...Array<null>(20).fill(null), 20, 21, 21.5, 21.5],
    },
  ],
  day: { since: '2026-11-09T10:00:00Z', step_s: 1800, count: 48 },
  environment: [
    {
      variable: 'air_temperature',
      label: 'Air temperature',
      unit: '°C',
      sensors: 1,
      origins: ['SIMULATED'],
      values: [...Array<null>(44).fill(null), 20, 21, 21.5, 21.5],
    },
  ],
  plant_health: {
    days: DAYS,
    healthy: Array<number>(30).fill(0),
    watch: Array<number>(30).fill(0),
    problem: [...Array<number>(29).fill(0), 1],
    not_checked: [...Array<number>(29).fill(1), 0],
  },
};

describe('Executive Dashboard against the real Lefi Brain', () => {
  it('lays out the design with what Lefi Brain holds and says what it cannot provide', async () => {
    renderWithProviders(<DashboardLive />, {
      platform: fakePlatform({
        '/overview': overview,
        '/overview/trends': trends,
        '/health': HEALTH,
      }),
      session: session(['nav.dashboard']),
    });
    // Current conditions: the value, the range a person set, and the verdict on it.
    expect(await screen.findByText('Temperature')).toBeInTheDocument();
    expect(screen.getByText('21.5')).toBeInTheDocument();
    expect(screen.getByText('15–20 °C')).toBeInTheDocument();
    expect(screen.getByText('Out of range')).toBeInTheDocument();
    expect(screen.getAllByText(/SIMULATED|SIM ·/).length).toBeGreaterThan(0);
    // Status tile and zones from real counts.
    expect(screen.getByText('Greenhouse status')).toBeInTheDocument();
    expect(screen.getByText('Attention')).toBeInTheDocument();
    expect(screen.getByText('1 warning')).toBeInTheDocument();
    // Alerts and the summary composed from data — never labelled as AI-generated.
    expect(screen.getAllByText('Fake ESP32 is not in contact').length).toBeGreaterThan(0);
    expect(screen.getByText(/From Lefi Brain data/)).toBeInTheDocument();
    expect(screen.queryByText(/AI-generated/i)).not.toBeInTheDocument();
    expect(screen.getByText('Not set up')).toBeInTheDocument();
    // Follow-ups from people's observations; what does not exist yet says so.
    expect(screen.getByText('Plant P-FAKE')).toBeInTheDocument();
    expect(screen.getByText('Not available yet')).toBeInTheDocument();
    expect(screen.getByText(/Shifts and handover are not available yet/)).toBeInTheDocument();
    // Charts from the trends endpoint.
    expect(await screen.findByText('Average of 1 sensor · last 24 h')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'Trend chart' })).toHaveLength(2);
  });

  it('shows no chart when nothing was stored instead of drawing one', async () => {
    const none: OverviewTrends = {
      ...trends,
      sensors: [],
      environment: [],
      plant_health: { ...trends.plant_health, problem: Array<number>(30).fill(0) },
    };
    renderWithProviders(<DashboardLive />, {
      platform: fakePlatform({
        '/overview': overview,
        '/overview/trends': none,
        '/health': HEALTH,
      }),
      session: session(['nav.dashboard']),
    });
    expect(await screen.findByText('No readings stored in the last 24 h.')).toBeInTheDocument();
    expect(screen.getByText(/No plant health recorded in the last 30 days/)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Trend chart' })).not.toBeInTheDocument();
  });
});

const page: PlantHealthPage = {
  vision: VISION,
  counts: { plants: 1, healthy: 0, watch: 0, problem: 0, not_checked: 1, open_requests: 0 },
  plants: [
    {
      plant_id: 'p1',
      code: 'P-FAKE',
      name: null,
      crop: 'Fake lettuce',
      zone_id: 'z1',
      zone: 'Fake zone',
      container_id: null,
      planted_on: null,
      latest: null,
      open_request: null,
    },
  ],
  issues: ['pest', 'disease', 'other'],
  can_observe: true,
  can_request: true,
};

function brain(calls: ApiRequest[], over: Partial<PlantHealthPage> = {}): Platform {
  const p = fakePlatform();
  p.api = async <T,>(req: ApiRequest): Promise<T> => {
    calls.push(req);
    if (req.path === '/health') return HEALTH as T;
    if (req.path === '/plant-health') return { ...page, ...over } as T;
    if (req.path.startsWith('/health-reviews'))
      return { brain_time: '2026-11-07T10:00:00Z', reviews: [] } as T;
    if (req.path === '/plants/p1/observations' && req.method === 'GET')
      return [] as PlantObservation[] as T;
    if (req.method === 'POST') return { observation: {}, requests_done: 0 } as T;
    throw new Error(`unexpected ${req.method} ${req.path}`);
  };
  return p;
}

describe('AI Plant Health against the real Lefi Brain', () => {
  it('says vision is unavailable and records what a person saw', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<PlantHealthLive />, {
      platform: brain(calls),
      session: session(['nav.plantHealth', 'plant.observe', 'ai.request']),
    });
    expect(await screen.findByText('AI vision per plant is not available')).toBeInTheDocument();
    expect(screen.getByText('No camera images reach Lefi Brain (test).')).toBeInTheDocument();
    const form = await screen.findByRole('form', { name: 'Record what you saw' });
    await userEvent.click(within(form).getByRole('radio', { name: 'Problem' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Pest' }));
    await userEvent.type(within(form).getByLabelText('Note'), 'aphids');
    await userEvent.click(within(form).getByRole('button', { name: /save observation/i }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.method === 'POST' && c.path.includes('/observations'))?.body,
      ).toEqual({
        health: 'problem',
        issues: ['pest'],
        note: 'aphids',
      }),
    );
  });

  it('offers nothing to change without the permissions', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<PlantHealthLive />, {
      platform: brain(calls, { can_observe: false, can_request: false }),
      session: session(['nav.plantHealth']),
    });
    expect(await screen.findByText('No inspection asked.')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Record what you saw' })).toBeNull();
    expect(screen.queryByRole('button', { name: /ask for inspection/i })).toBeNull();
  });
});
