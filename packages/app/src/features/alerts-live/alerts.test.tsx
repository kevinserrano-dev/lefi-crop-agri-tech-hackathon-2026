import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AlertDetail, AlertItem, AlertList } from '@lefi/api';
import type { ApiRequest, Platform } from '@lefi/platform';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { AlertsLive } from './AlertsLive';

const NOW = '2026-11-10T10:00:00Z';
const HEALTH = { status: 'ok', service: 'lefi-brain', version: '0.5.1', time: NOW };

const alert: AlertItem = {
  id: 'a1',
  rule: 'device.offline',
  source: 'rule',
  title: 'Fake ESP32 is not in contact',
  detail: 'No contact with Fake ESP32 (test).',
  severity: 'warning',
  status: 'open',
  subject: { kind: 'device', id: 'sim-x', label: 'Fake ESP32', zone_id: null, plant_id: null },
  origin: 'SIMULATED',
  condition_active: true,
  opened_at: NOW,
  updated_at: NOW,
  occurrences: 1,
  facts: {},
  acknowledged_by: null,
  acknowledged_at: null,
  assigned_to: null,
  assigned_to_id: null,
  resolved_by: null,
  resolved_at: null,
  resolution: null,
  reported_by: null,
};

const list = (over: Partial<AlertList> = {}): AlertList => ({
  alerts: [alert],
  counts: { active: 1, critical: 0, warning: 1, info: 0, unacknowledged: 1 },
  monitor: { state: 'watching', reason: 'watching (test)', last_check: NOW, value_rules: 0 },
  people: [{ id: 'u1', name: 'Fake Person' }],
  can: { report: true, acknowledge: true, assign: true, resolve: true, configure: false },
  ...over,
});

function brain(calls: ApiRequest[], data: AlertList): Platform {
  const p = fakePlatform();
  p.api = async <T,>(req: ApiRequest): Promise<T> => {
    calls.push(req);
    if (req.path === '/health') return HEALTH as T;
    if (req.path === '/alerts' && req.method === 'GET') return data as T;
    if (req.path === '/alerts/a1') return { ...alert, events: [] } satisfies AlertDetail as T;
    if (req.method === 'POST') return alert as T;
    throw new Error(`unexpected ${req.method} ${req.path}`);
  };
  return p;
}

describe('Alerts & Incidents against the real Lefi Brain', () => {
  it('shows why an alert was raised and lets a person acknowledge and assign it', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<AlertsLive />, {
      platform: brain(calls, list()),
      session: session(['nav.alerts', 'incident.report', 'incident.ack', 'incident.assign']),
    });
    // Nothing is open until a person picks an alert; then its detail opens below and the page
    // scrolls down to it.
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    expect(screen.queryByRole('complementary', { name: 'Alert details' })).toBeNull();
    await userEvent.click(
      await screen.findByRole('button', { name: /Fake ESP32 is not in contact/ }),
    );
    const panel = await screen.findByRole('complementary', { name: 'Alert details' });
    await waitFor(() =>
      expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' }),
    );
    expect(within(panel).getByText('No contact with Fake ESP32 (test).')).toBeInTheDocument();
    expect(within(panel).getByText('Still present')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: /acknowledge/i }));
    await userEvent.selectOptions(within(panel).getByLabelText('Assign to'), 'u1');
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'POST').map((c) => [c.path, c.body])).toEqual([
        ['/alerts/a1/acknowledge', undefined],
        ['/alerts/a1/assign', { user_id: 'u1' }],
      ]),
    );
  });

  it('never lets a person resolve a rule alert whose condition is still there', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<AlertsLive />, {
      platform: brain(calls, list()),
      session: session(['nav.alerts', 'incident.resolve']),
    });
    await userEvent.click(
      await screen.findByRole('button', { name: /Fake ESP32 is not in contact/ }),
    );
    const panel = await screen.findByRole('complementary', { name: 'Alert details' });
    expect(within(panel).getByRole('button', { name: /resolve/i })).toBeDisabled();
    expect(
      within(panel).getByText(
        'Lefi Brain resolves this alert by itself when the condition clears.',
      ),
    ).toBeInTheDocument();
  });

  it('says when Lefi Brain cannot judge devices yet', async () => {
    renderWithProviders(<AlertsLive />, {
      platform: brain([], {
        ...list({ alerts: [] }),
        monitor: {
          state: 'grace',
          reason: 'devices get 120 s (test)',
          last_check: NOW,
          value_rules: 0,
        },
      }),
      session: session(['nav.alerts']),
    });
    expect(await screen.findByText('Waiting for devices to report')).toBeInTheDocument();
    expect(screen.getByText('devices get 120 s (test)')).toBeInTheDocument();
    expect(screen.getByText('No active alerts')).toBeInTheDocument();
  });

  it('lists alerts as cards with their number and filters them (ADR-097)', async () => {
    const ai: AlertItem = {
      ...alert,
      id: 'a2',
      rule: 'ai.vision:wilting',
      source: 'ai',
      severity: 'critical',
      title: 'Lefi AI saw possible wilting in Zona C',
      subject: { kind: 'zone', id: 'zc', label: 'Zona C', zone_id: 'zc', plant_id: null },
      number: 'INC-0006',
    };
    const data = list({ alerts: [{ ...alert, number: 'INC-0007' }, ai] });
    const p = fakePlatform();
    p.api = async <T,>(req: ApiRequest): Promise<T> => {
      if (req.path === '/health') return HEALTH as T;
      if (req.path === '/alerts') return data as T;
      if (req.path === '/alerts/a1') return { ...alert, events: [] } as T;
      if (req.path === '/alerts/a2') return { ...ai, events: [] } as T;
      if (req.path === '/alert-insights') return { brain_time: NOW, insights: [] } as T;
      throw new Error(`unexpected ${req.method} ${req.path}`);
    };
    renderWithProviders(<AlertsLive />, { platform: p, session: session(['nav.alerts']) });
    const list_ = await screen.findByRole('list', { name: 'Alert list' });
    expect(within(list_).getByText('INC-0007')).toBeInTheDocument();
    expect(within(list_).getByText('Lefi AI · to confirm')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Critical' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Alert list' })).queryByText(
          'Fake ESP32 is not in contact',
        ),
      ).toBeNull(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    await userEvent.type(screen.getByLabelText('Search alerts'), 'INC-0007');
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Alert list' })).queryByText(
          'Lefi AI saw possible wilting in Zona C',
        ),
      ).toBeNull(),
    );
  });
});
