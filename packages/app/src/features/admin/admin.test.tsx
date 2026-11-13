import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PermissionMatrix, SystemConfig } from '@lefi/api';
import type { ApiRequest, Platform } from '@lefi/platform';
import { fakePlatform, renderWithProviders } from '../../test/render';
import { useToast } from '../../shared/ui';
import { ConfigTab } from './ConfigTab';
import { RolesTab } from './RolesTab';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => () => undefined }));

const ok = { allowed: true, reason: null };
const matrix: PermissionMatrix = {
  note: '',
  can_edit: ok,
  roles: [
    { id: 'admin', short: 'Admin', name: 'Admin', users: 1 },
    { id: 'worker', short: 'Worker', name: 'Worker', users: 2 },
  ],
  groups: [
    {
      label: 'Admin',
      rows: [{ key: 'user.manage', label: 'Manage users', roles: ['admin'], locked: ['admin'] }],
    },
  ],
};
const config: SystemConfig = {
  can_edit: ok,
  origin: 'SIMULATED',
  sections: [
    {
      title: 'Security',
      fields: [
        {
          key: 'session_hours',
          label: 'Session timeout',
          kind: 'number',
          unit: 'h',
          value: '12',
          hint: null,
          editable: ok,
        },
        {
          key: 'broker',
          label: 'MQTT broker',
          kind: 'text',
          unit: null,
          value: 'mqtt://fake:1883',
          hint: null,
          editable: { allowed: false, reason: 'Set by the installer.' },
        },
      ],
    },
  ],
};

function platformWith(calls: ApiRequest[]): Platform {
  const p = fakePlatform();
  p.api = async <T,>(req: ApiRequest): Promise<T> => {
    calls.push(req);
    if (req.path === '/admin/permissions' && req.method === 'GET') return matrix as T;
    if (req.path === '/admin/config' && req.method === 'GET') return config as T;
    return { item: req.path.includes('config') ? config : matrix, message: 'Saved.' } as T;
  };
  return p;
}

describe('Administration', () => {
  it('sends a grant to the Brain and refetches the own session', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<RolesTab />, { platform: platformWith(calls) });
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Worker · Manage users' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        permission: 'user.manage',
        role: 'worker',
        granted: true,
      }),
    );
    expect(screen.getByRole('checkbox', { name: 'Admin · Manage users' })).toHaveAttribute(
      'data-locked',
      'true',
    );
  });

  it('saves only the changed, editable values', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<ConfigTab />, { platform: platformWith(calls) });
    const [session, broker] = await screen.findAllByRole('textbox');
    expect(broker).toHaveAttribute('readonly');
    await userEvent.clear(session!);
    await userEvent.type(session!, '8');
    await userEvent.click(screen.getByRole('button', { name: 'Save configuration' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        values: { session_hours: '8' },
      }),
    );
    expect(useToast.getState().toast?.msg).toBe('Saved.');
  });
});
