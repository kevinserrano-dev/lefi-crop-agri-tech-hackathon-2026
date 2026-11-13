import { screen } from '@testing-library/react';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { AlertInsightPanel, ZoneInsights } from './AlertInsights';

const insight = (extra: Record<string, unknown> = {}) => ({
  id: 'i1',
  alert_id: 'a1',
  zone_id: 'zc',
  alert_title: 'Air temperature high for Spinach · Zona C',
  alert_severity: 'warning',
  created_at: '2026-11-12T10:00:00Z',
  trigger: 'opened',
  requested_by: 'Lefi Brain (alert)',
  status: 'done',
  diagnosis: 'The zone is warmer than the species allows.',
  causes: ['Vents closed'],
  recommendations: ['Check the vents'],
  actions: ['Open the vents'],
  role: 'grower',
  role_label: 'grower: crop conditions, climate, irrigation, nutrition',
  tasks: [{ title: 'Check Zona C', for_role: 'grower', assigned: false, status: 'open' }],
  model: 'test-model',
  error: null,
  ai_at: '2026-11-12T10:00:05Z',
  origin: 'LIVE',
  ...extra,
});

describe('Lefi AI’s analysis of alerts (ADR-092)', () => {
  it('shows the diagnosis, causes, actions, suggested role and the tasks Lefi Brain made', async () => {
    renderWithProviders(<ZoneInsights zoneId="zc" now="2026-11-12T10:01:00Z" />, {
      platform: fakePlatform({ '/alert-insights': { brain_time: '', insights: [insight()] } }),
      session: session(['nav.alerts']),
    });
    expect(await screen.findByText(/warmer than the species allows/)).toBeInTheDocument();
    expect(screen.getByText('Vents closed')).toBeInTheDocument();
    expect(screen.getByText('Open the vents')).toBeInTheDocument();
    expect(screen.getByText(/to check/)).toBeInTheDocument();
    expect(screen.getByText(/grower: crop conditions/)).toBeInTheDocument();
    expect(screen.getByText(/waiting for a person/)).toBeInTheDocument();
  });

  it('never shows an answer that did not fit, and says why', async () => {
    renderWithProviders(<AlertInsightPanel alertId="a1" />, {
      platform: fakePlatform({
        '/alert-insights': {
          brain_time: '',
          insights: [
            insight({ status: 'invalid', diagnosis: null, error: 'the role is not one of …' }),
          ],
        },
      }),
      session: session(['nav.alerts']),
    });
    expect(await screen.findByText(/did not fit and is not shown/)).toBeInTheDocument();
    expect(screen.queryByText(/warmer than the species/)).not.toBeInTheDocument();
  });

  it('shows nothing without access to alerts', () => {
    const { container } = renderWithProviders(<ZoneInsights zoneId="zc" />, {
      platform: fakePlatform({}),
      session: session(['nav.greenhouses']),
    });
    expect(container).toBeEmptyDOMElement();
  });
});
