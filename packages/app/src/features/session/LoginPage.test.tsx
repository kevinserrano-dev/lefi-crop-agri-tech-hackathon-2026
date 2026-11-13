import { screen, waitFor } from '@testing-library/react';
import { ApiError, BrainUnreachableError, type BrainEndpoint, type Platform } from '@lefi/platform';
import userEvent from '@testing-library/user-event';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { deriveGate } from './brainGate';
import { LoginPage } from './LoginPage';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => () => undefined }));

function platform(
  health: () => unknown,
  source: BrainEndpoint['source'] | null = 'config',
): Platform {
  return {
    ...fakePlatform(),
    api: async <T,>(req: { path: string }): Promise<T> => {
      if (req.path === '/health') return health() as T;
      throw new ApiError(401, { error: { code: 'NOT_AUTHENTICATED', message: 'sign in first' } });
    },
    discoverBrain: async () =>
      source ? [{ name: 'Test Brain', url: 'https://192.0.2.1:8443', source }] : [],
  };
}

const down = () => {
  throw new BrainUnreachableError();
};
const ok = () => ({ status: 'ok', service: 'lefi-brain', version: '9.9.9-test' });

describe('sign-in depends on the Brain', () => {
  it('shows the form only when the Brain answers', async () => {
    renderWithProviders(<LoginPage />, { platform: platform(ok) });
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByText(/Brain 9\.9\.9-test/)).toBeInTheDocument();
  });

  it('a PC never connected: says what is missing, no password field', async () => {
    renderWithProviders(<LoginPage />, { platform: platform(down, null) });
    expect(await screen.findByText('Connecting this PC to Lefi Brain')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(await screen.findByText('No Lefi Brain found on this network.')).toBeInTheDocument();
  });

  it('a PC never connected lists what answers on the network, as not trusted', async () => {
    const p = {
      ...platform(down, null),
      findBrains: async () => [
        {
          url: 'https://lefi-main.local:8443',
          addresses: ['192.0.2.10'],
          via: 'mdns' as const,
          state: 'on' as const,
          version: '0.2.0',
        },
      ],
    };
    renderWithProviders(<LoginPage />, { platform: p });
    expect(await screen.findByText('https://lefi-main.local:8443')).toBeInTheDocument();
    expect(screen.getByText(/Lefi Brain 0\.2\.0/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is trusted until then/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('a known Brain that is silent: what to check, then sign-in appears when it answers', async () => {
    let up = false;
    const { unmount } = renderWithProviders(<LoginPage />, {
      platform: platform(() => (up ? ok() : down())),
    });
    expect(await screen.findByText('Lefi Brain is not answering')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    up = true;
    screen.getByRole('button', { name: /Check now/ }).click();
    await waitFor(() => expect(screen.getByLabelText('Password')).toBeInTheDocument());
    unmount();
  });

  it('the gateway answers but the Brain service does not', async () => {
    const gateway = () => {
      throw new ApiError(502, null);
    };
    renderWithProviders(<LoginPage />, { platform: platform(gateway) });
    expect(await screen.findByText('Lefi Brain service is not running')).toBeInTheDocument();
  });
});

describe('deriveGate', () => {
  const base = {
    pending: false,
    health: undefined,
    error: null,
    source: 'config',
    paired: false,
  } as const;

  it('never claims ready without a real Brain answer', () => {
    expect(deriveGate({ ...base, pending: true }).kind).toBe('checking');
    expect(deriveGate(base).kind).toBe('unreachable');
    const other = { status: 'ok', service: 'nginx', version: '1' };
    expect(deriveGate({ ...base, health: other }).kind).toBe('not_a_brain');
  });

  it('an error wins over an older good answer', () => {
    const health = { status: 'ok', service: 'lefi-brain', version: '1' };
    const error = new BrainUnreachableError();
    expect(deriveGate({ ...base, health, error }).kind).toBe('unreachable');
  });

  it('tells the causes apart', () => {
    const d = (status: number) => deriveGate({ ...base, error: new ApiError(status, null) }).kind;
    expect([d(503), d(401), d(403), d(404)]).toEqual([
      'brain_down',
      'not_allowed',
      'not_allowed',
      'not_a_brain',
    ]);
    const silent = { ...base, error: new BrainUnreachableError() };
    expect(deriveGate({ ...silent, source: undefined }).kind).toBe('not_set_up');
    expect(deriveGate({ ...silent, source: undefined, paired: true }).kind).toBe('unreachable');
  });
});

describe('a temporary password must be changed first', () => {
  it('asks for a new password after sign-in and continues once the Brain accepts it', async () => {
    const calls: Array<{ path: string; body?: unknown }> = [];
    const base = session([]);
    const p: Platform = {
      ...fakePlatform(),
      api: async <T,>(req: { path: string; body?: unknown }): Promise<T> => {
        calls.push(req);
        if (req.path === '/health') return ok() as T;
        if (req.path === '/auth/login') return { ...base, must_change_password: true } as T;
        if (req.path === '/auth/password') {
          const b = req.body as { new_password: string };
          if (b.new_password.length < 10)
            throw new ApiError(422, {
              error: { code: 'WEAK_PASSWORD', message: 'at least 10 characters', details: {} },
            });
          return base as T;
        }
        throw new ApiError(401, { error: { code: 'NOT_AUTHENTICATED', message: 'sign in first' } });
      },
      discoverBrain: async () => [
        { name: 'Test Brain', url: 'https://192.0.2.1:8443', source: 'config' as const },
      ],
    };
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { platform: p });
    const pw = await screen.findByLabelText('Password');
    await user.clear(pw);
    await user.type(pw, 'temporary-1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Choose a new password')).toBeInTheDocument();
    // The password just typed is reused as the current one; it is not asked again.
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('New password again'), 'shorx');
    expect(screen.getByText('The two new passwords are different.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save and continue' })).toBeDisabled();

    await user.clear(screen.getByLabelText('New password again'));
    await user.type(screen.getByLabelText('New password again'), 'short');
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(await screen.findByText('at least 10 characters')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('New password'));
    await user.clear(screen.getByLabelText('New password again'));
    await user.type(screen.getByLabelText('New password'), 'my-own-password-1');
    await user.type(screen.getByLabelText('New password again'), 'my-own-password-1');
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() =>
      expect(screen.queryByText('Choose a new password')).not.toBeInTheDocument(),
    );
    expect(calls.filter((c) => c.path === '/auth/password').at(-1)?.body).toEqual({
      current_password: 'temporary-1',
      new_password: 'my-own-password-1',
    });
  });
});

describe('pairing this PC', () => {
  const found = [
    {
      url: 'https://lefi-main.local:8443',
      addresses: ['192.0.2.10'],
      via: 'mdns' as const,
      state: 'on' as const,
      version: '0.2.0',
    },
  ];

  it('Advanced: pairs with a code for the found Lefi Brain, then shows sign-in', async () => {
    let paired = false;
    const pairCalls: string[][] = [];
    const p: Platform = {
      ...fakePlatform(),
      kind: 'tauri',
      api: async <T,>(req: { path: string }): Promise<T> => {
        if (req.path === '/health' && paired) return ok() as T;
        if (req.path === '/health') throw new BrainUnreachableError();
        throw new ApiError(401, { error: { code: 'NOT_AUTHENTICATED', message: 'sign in first' } });
      },
      discoverBrain: async () =>
        paired ? [{ name: 'Lefi Brain', url: found[0]!.url, source: 'paired' as const }] : [],
      findBrains: async () => found,
      device: async () =>
        paired
          ? {
              deviceId: 'dev-1',
              caFingerprint: 'ab',
              pairedAt: '1',
              url: found[0]!.url,
              expiresAt: '2027-11-07T00:00:00Z',
            }
          : null,
      pair: async (url: string, code: string) => {
        pairCalls.push([url, code]);
        paired = true;
        return {
          deviceId: 'dev-1',
          caFingerprint: 'ab',
          pairedAt: '1',
          url,
          expiresAt: '2027-11-07T00:00:00Z',
        };
      },
    };
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { platform: p });
    await user.click(await screen.findByRole('button', { name: /Advanced/ }));
    expect(screen.getByLabelText('Main PC address')).toHaveValue('https://lefi-main.local:8443');
    await user.type(screen.getByLabelText('Pairing code'), 'abcd-efgh-jkmn');
    await user.click(screen.getByRole('button', { name: 'Pair this PC' }));
    expect(await screen.findByLabelText('Password', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(pairCalls).toEqual([['https://lefi-main.local:8443', 'abcd-efgh-jkmn']]);
    expect(screen.getByText('This PC is paired with Lefi Brain')).toBeInTheDocument();
  });

  it('shows what Lefi Brain said when the code is refused', async () => {
    const p: Platform = {
      ...platform(down, null),
      findBrains: async () => found,
      pair: async () => {
        throw new Error(
          'Lefi Brain refused this code: it is wrong, used or expired. Create a new one in Lefi Crop Helper.',
        );
      },
    };
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { platform: p });
    await user.click(await screen.findByRole('button', { name: /Advanced/ }));
    await user.type(screen.getByLabelText('Main PC address'), 'https://192.0.2.10:8443');
    await user.type(screen.getByLabelText('Pairing code'), 'ZZZZ-ZZZZ-ZZZZ');
    await user.click(screen.getByRole('button', { name: 'Pair this PC' }));
    expect(await screen.findByText(/refused this code/)).toBeInTheDocument();
  });

  it('a revoked PC is told so and can forget its pairing', async () => {
    let forgot = false;
    const p: Platform = {
      ...platform(ok),
      api: async <T,>(req: { path: string }): Promise<T> => {
        if (req.path === '/health') return ok() as T;
        throw new ApiError(401, {
          error: { code: 'DEVICE_REVOKED', message: 'this device is no longer allowed' },
        });
      },
      forgetPairing: async () => {
        forgot = true;
      },
    };
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { platform: p });
    expect(await screen.findByText('Lefi Brain refused this PC')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Forget this pairing/ }));
    await waitFor(() => expect(forgot).toBe(true));
  });
});
