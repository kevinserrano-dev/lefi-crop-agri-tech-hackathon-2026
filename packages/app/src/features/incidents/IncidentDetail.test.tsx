import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IncidentDetail } from '@lefi/api';
import type { ApiRequest, Platform } from '@lefi/platform';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { useToast } from '../../shared/ui';
import { IncidentDetailView } from './IncidentDetail';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => () => undefined }));

const locked = (reason: string) => ({ allowed: false, reason });
const ok = { allowed: true, reason: null };

const incident: IncidentDetail = {
  id: 'INC-0001',
  detected_at: '2026-11-05T08:40:00Z',
  zone_id: 'Z1',
  zone_label: 'Z1',
  area: 'Test area',
  plant_id: null,
  title: 'Fake incident for tests',
  severity: 'critical',
  source: { kind: 'automatic', label: 'Automatic · sensor' },
  ai_confidence: 90,
  status: 'New',
  assignee: 'Someone',
  origin: 'SIMULATED',
  ack_minutes: null,
  evidence: ['Fake evidence'],
  recommendation: { text: 'Fake recommendation', simulated: true },
  timeline: [],
  escalation: [],
  notifications: [],
  missions: [],
  resolution: null,
  actions: {
    acknowledge: ok,
    investigate: ok,
    resolve: ok,
    close: locked('Only resolved incidents can be closed.'),
    assign: locked('Requires permission: Assign incidents'),
  },
};

function platformWith(calls: ApiRequest[]): Platform {
  const base = fakePlatform({ '/incidents/INC-0001': incident, '/people': [] });
  return {
    ...base,
    api: async <T,>(req: ApiRequest) => {
      calls.push(req);
      if (req.method === 'POST') {
        return {
          item: { ...incident, status: 'Acknowledged' },
          message: 'INC-0001: acknowledged.',
        } as T;
      }
      return base.api<T>(req);
    },
  };
}

describe('IncidentDetailView', () => {
  it('shows the Brain’s reason on locked actions and marks simulated data', async () => {
    renderWithProviders(<IncidentDetailView id="INC-0001" onBack={() => undefined} />, {
      platform: platformWith([]),
      session: session(['nav.alerts']),
    });
    const close = await screen.findByRole('button', { name: 'Close incident' });
    expect(close).toHaveAttribute('title', 'Only resolved incidents can be closed.');
    expect(screen.getAllByText('Simulated').length).toBeGreaterThan(0);
    expect(screen.getByText(/A recommendation is not an action/)).toBeInTheDocument();
  });

  it('sends the transition to the Brain and shows its message', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<IncidentDetailView id="INC-0001" onBack={() => undefined} />, {
      platform: platformWith(calls),
      session: session(['nav.alerts']),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(useToast.getState().toast?.msg).toBe('INC-0001: acknowledged.'));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      path: '/incidents/INC-0001/transition',
      body: { action: 'acknowledge' },
    });
  });
});
