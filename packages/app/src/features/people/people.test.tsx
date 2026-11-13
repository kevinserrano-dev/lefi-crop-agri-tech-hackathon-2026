import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BrainUser, BrainUserDetail, BrainUserList } from '@lefi/api';
import type { ApiRequest, Platform } from '@lefi/platform';
import { screens } from '../../app/screens';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { AdminLive } from './AdminLive';
import { WorkforceLive } from './WorkforceLive';

const ROLES = [
  { id: 'admin', name: 'System Administrator', short: 'Sys Admin' },
  { id: 'worker', name: 'Greenhouse Worker', short: 'Worker' },
] as BrainUserList['roles'];

const user = (over: Partial<BrainUser>): BrainUser => ({
  id: 'u-admin',
  username: 'admin',
  display_name: 'Administrator',
  email: null,
  role: ROLES[0]!,
  status: 'active',
  must_change_password: false,
  locked_until: null,
  created_at: '2026-11-10T08:00:00Z',
  last_login_at: '2026-11-10T09:00:00Z',
  active_sessions: 1,
  is_you: true,
  ...over,
});

const ADMIN = user({});
const WORKER = user({
  id: 'u-fake',
  username: 'fake.worker',
  display_name: 'Fake Worker',
  email: 'fake@example.invalid',
  role: ROLES[1]!,
  must_change_password: true,
  is_you: false,
  last_login_at: null,
  active_sessions: 0,
});

const detail = (u: BrainUser): BrainUserDetail => ({
  ...u,
  permissions: ['nav.greenhouses'],
  sessions: [],
  recent: [],
});

const HEALTH = {
  status: 'ok',
  service: 'lefi-brain',
  version: '0.5.1',
  time: '2026-11-10T10:00:00Z',
};

function brain(calls: ApiRequest[], canManage = true): Platform {
  const p = fakePlatform();
  p.api = async <T,>(req: ApiRequest): Promise<T> => {
    calls.push(req);
    if (req.path === '/health') return HEALTH as T;
    if (req.path === '/users' && req.method === 'GET')
      return { users: [ADMIN, WORKER], roles: ROLES, can_manage: canManage } as T;
    if (req.path === '/users' && req.method === 'POST')
      return {
        user: user({
          id: 'u-new',
          username: 'new.person',
          display_name: 'New Person',
          is_you: false,
        }),
        temporary_password: 'abcd-efgh-jkmn-pqrs',
      } as T;
    if (req.path === '/users/u-fake' && req.method === 'GET') return detail(WORKER) as T;
    if (req.path === '/users/u-admin' && req.method === 'GET') return detail(ADMIN) as T;
    if (req.path === '/users/u-new' && req.method === 'GET') return detail(WORKER) as T;
    if (req.path === '/users/u-fake' && req.method === 'PATCH') return WORKER as T;
    if (req.path === '/users/u-fake/password')
      return { user: WORKER, temporary_password: 'zzzz-yyyy-xxxx-wwww' } as T;
    throw new Error(`unexpected ${req.method} ${req.path}`);
  };
  return p;
}

describe('Workforce against the real Lefi Brain', () => {
  it('is used only when Lefi Brain serves /users', () => {
    const def = screens.find((s) => s.id === 'workforce');
    expect(def?.live?.endpoint).toBe('/users');
    expect(screens.find((s) => s.id === 'admin')?.live?.endpoint).toBe('/audit');
  });

  it('lists the accounts and adds a user with a temporary password shown once', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<WorkforceLive />, {
      platform: brain(calls),
      session: session(['nav.workforce', 'user.manage']),
    });
    expect(await screen.findByText('Fake Worker')).toBeInTheDocument();
    expect(screen.getAllByText('Temporary password').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: /add user/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByPlaceholderText('e.g. María López'), 'New Person');
    await userEvent.type(within(dialog).getByPlaceholderText('e.g. maria.lopez'), 'New.Person');
    await userEvent.click(within(dialog).getByRole('button', { name: /add user/i }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({
      username: 'new.person',
      display_name: 'New Person',
      email: null,
      role: 'worker',
      password: null,
    });
    expect(await screen.findByTestId('temporary-password')).toHaveTextContent(
      'abcd-efgh-jkmn-pqrs',
    );
  });

  it('changes a role, resets a password and deactivates through Lefi Brain', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<WorkforceLive />, {
      platform: brain(calls),
      session: session(['nav.workforce', 'user.manage']),
    });
    await userEvent.click(await screen.findByText('Fake Worker'));
    const panel = await screen.findByRole('complementary', { name: 'Fake Worker profile' });
    await userEvent.selectOptions(within(panel).getByRole('combobox'), 'admin');
    await userEvent.click(within(panel).getByRole('button', { name: /reset password/i }));
    expect(await screen.findByTestId('temporary-password')).toHaveTextContent(
      'zzzz-yyyy-xxxx-wwww',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await userEvent.click(within(panel).getByRole('button', { name: /deactivate/i }));
    await userEvent.click(within(panel).getByRole('button', { name: /yes, deactivate/i }));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([
        { role: 'admin' },
        { status: 'disabled' },
      ]),
    );
  });

  it('never offers changes to people without user.manage, nor self-lockout', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<WorkforceLive />, {
      platform: brain(calls, false),
      session: session(['nav.workforce']),
    });
    const panel = await screen.findByRole('complementary', { name: 'Administrator profile' });
    expect(screen.queryByRole('button', { name: /add user/i })).toBeNull();
    expect(within(panel).queryByRole('combobox')).toBeNull();
    expect(within(panel).queryByRole('button', { name: /deactivate/i })).toBeNull();
  });
});

describe('Administration against the real Lefi Brain', () => {
  const routes = {
    '/health': HEALTH,
    '/roles': {
      roles: ROLES,
      permissions: {},
      editable: false,
      groups: [
        {
          name: 'Administration',
          permissions: [
            { id: 'user.manage', label: 'Create users', roles: ['admin'], lockout: true },
          ],
        },
      ],
    },
    '/audit': {
      entries: [
        {
          seq: 7,
          at: '2026-11-10T09:30:00Z',
          actor: { type: 'user', id: 'u-admin', name: 'Administrator', client_device_id: null },
          action: 'user.role_changed',
          outcome: 'success',
          origin: 'SYSTEM',
          target_type: 'user',
          target_id: 'u-fake',
          target_name: 'Fake Worker',
          request_id: null,
          details: { from: 'worker', to: 'scout' },
        },
      ],
      next_before: null,
      total: 1,
    },
  };

  it('shows the enforced matrix and the audit trail by permission', async () => {
    renderWithProviders(<AdminLive />, {
      platform: fakePlatform(routes),
      session: session(['nav.admin', 'admin.roles', 'admin.audit']),
    });
    const matrix = await screen.findByRole('table', { name: 'Roles and permissions' });
    expect(within(matrix).getByLabelText('System Administrator: yes')).toBeInTheDocument();
    expect(within(matrix).getByLabelText('Greenhouse Worker: no')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Paired PCs' })).toBeNull();

    await userEvent.click(screen.getByRole('tab', { name: 'Audit trail' }));
    expect(await screen.findByText(/Role changed/)).toBeInTheDocument();
    expect(screen.getByText('worker → scout')).toBeInTheDocument();
  });
});
