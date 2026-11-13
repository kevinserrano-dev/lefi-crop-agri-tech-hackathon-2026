import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WorkforcePersonDetail } from '@lefi/api';
import type { ApiRequest, Platform } from '@lefi/platform';
import { fakePlatform, renderWithProviders } from '../../test/render';
import { useToast } from '../../shared/ui';
import { PersonPanel } from './PersonPanel';

const ok = { allowed: true, reason: null };
const SELF = { allowed: false, reason: 'You cannot deactivate your own account.' };
const person: WorkforcePersonDetail = {
  id: 'fake-person',
  name: 'Fake Person',
  email: 'fake@example.invalid',
  role_id: 'worker',
  role_name: 'Worker',
  zones: ['Z1'],
  status: 'On shift',
  phone: '(000) 555-0100',
  last_active: '09:00',
  zone_access: [
    { id: 'All', label: 'All zones', on: false },
    { id: 'Z1', label: 'Z1', on: true },
  ],
  roles: [
    { id: 'worker', label: 'Worker' },
    { id: 'scout', label: 'Scout' },
  ],
  notifications: {
    channels: [
      { key: 'app', label: 'In-app', available: ok },
      { key: 'sms', label: 'SMS', available: { allowed: false, reason: 'No SMS gateway.' } },
    ],
    events: [{ key: 'crit', label: 'Critical alerts', on: [true, false] }],
    can_edit: ok,
  },
  recent: [],
  actions: { change_role: ok, edit_zones: ok, deactivate: SELF },
  origin: 'SIMULATED',
};

function platformWith(calls: ApiRequest[]): Platform {
  const p = fakePlatform();
  p.api = async <T,>(req: ApiRequest): Promise<T> => {
    calls.push(req);
    if (req.method === 'GET') return person as T;
    return { item: person, message: 'Saved.' } as T;
  };
  return p;
}

describe('Workforce profile', () => {
  it('sends role and zone changes to the Brain', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<PersonPanel id="fake-person" />, { platform: platformWith(calls) });
    await userEvent.selectOptions(await screen.findByRole('combobox'), 'scout');
    await userEvent.click(screen.getByRole('button', { name: 'All zones' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([
        { role: 'scout' },
        { zone: 'All' },
      ]),
    );
  });

  it('keeps unavailable channels and self-deactivation locked with the Brain reason', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<PersonPanel id="fake-person" />, { platform: platformWith(calls) });
    await userEvent.click(await screen.findByRole('switch', { name: 'Critical alerts · SMS' }));
    expect(useToast.getState().toast?.msg).toBe('No SMS gateway.');
    await userEvent.click(screen.getByRole('button', { name: /revoke sessions/i }));
    expect(useToast.getState().toast?.msg).toBe('You cannot deactivate your own account.');
    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });
});
