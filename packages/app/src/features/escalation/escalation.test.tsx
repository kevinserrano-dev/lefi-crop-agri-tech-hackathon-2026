import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EscalationConfig } from '@lefi/api';
import type { ApiRequest, Platform } from '@lefi/platform';
import { fakePlatform, renderWithProviders } from '../../test/render';
import { useToast } from '../../shared/ui';
import { LevelCards } from './LevelCards';
import { OnCallCard } from './OnCallCard';

const ok = { allowed: true, reason: null };
const NO_SMS = { allowed: false, reason: 'No SMS gateway is configured.' };
const config: EscalationConfig = {
  note: '',
  can_edit: ok,
  can_edit_oncall: { allowed: false, reason: 'Only Managers can change the on-call roster.' },
  mode: 'dynamic',
  description: '',
  fallback_notice: null,
  rules: [],
  incident_types: [],
  slots: [],
  channels: [
    { key: 'push', label: 'Push', description: 'In-app', available: ok },
    { key: 'sms', label: 'SMS', description: 'Needs a gateway', available: NO_SMS },
  ],
  levels: [
    { key: 'crit', severity: 'critical', description: '', channels: ['push'], timeout_min: 5 },
  ],
  chain: [],
  quiet_hours: { label: 'Quiet hours', description: '', on: true },
  oncall: [
    {
      id: 'fake-person',
      name: 'Fake Person',
      role_id: 'maint',
      role_label: 'Maintenance',
      phone: '(000) 555-0100',
      on: true,
      primary: true,
    },
  ],
  rotation: [],
  live: [],
  origin: 'SIMULATED',
};

function platformWith(calls: ApiRequest[]): Platform {
  const p = fakePlatform();
  p.api = async <T,>(req: ApiRequest): Promise<T> => {
    calls.push(req);
    if (req.path === '/escalation' && req.method === 'PUT')
      return { item: config, message: 'Escalate after 7 min without acknowledgement.' } as T;
    throw new Error(`unexpected ${req.path}`);
  };
  return p;
}

describe('Escalation rules', () => {
  it('does not send a channel the Brain reports unavailable, and says why', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<LevelCards c={config} />, { platform: platformWith(calls) });
    await userEvent.click(screen.getByRole('button', { name: 'SMS' }));
    expect(useToast.getState().toast?.msg).toBe('No SMS gateway is configured.');
    expect(calls).toHaveLength(0);
  });

  it('sends the acknowledgement window to the Brain', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<LevelCards c={config} />, { platform: platformWith(calls) });
    const input = screen.getByRole('spinbutton');
    await userEvent.clear(input);
    await userEvent.type(input, '7{Enter}');
    await waitFor(() =>
      expect(calls[0]).toMatchObject({
        method: 'PUT',
        path: '/escalation',
        body: { level: { key: 'crit', timeout_min: 7 } },
      }),
    );
  });

  it('keeps the on-call roster locked for roles the Brain does not allow', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<OnCallCard c={config} />, { platform: platformWith(calls) });
    await userEvent.click(screen.getByRole('switch', { name: /fake person/i }));
    expect(useToast.getState().toast?.msg).toBe('Only Managers can change the on-call roster.');
    expect(calls).toHaveLength(0);
  });
});
