import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError, BrainUnreachableError, type Platform } from '@lefi/platform';
import { fakePlatform, renderWithProviders } from '../../test/render';
import { LoginPage } from './LoginPage';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => () => undefined }));

const found = {
  url: 'https://lefi-main.local:8443',
  addresses: ['192.0.2.10'],
  via: 'mdns' as const,
  state: 'on' as const,
  version: '0.3.1',
};

/** Not paired. `mode` changes Lefi Brain's answer; the network search alternates. */
function flakyPlatform(mode: { health: 'unreachable' | 'down' }): Platform {
  let search = 0;
  return {
    ...fakePlatform(),
    api: async () => {
      throw mode.health === 'down'
        ? new ApiError(502, { error: { code: 'BAD_GATEWAY', message: 'x' } })
        : new BrainUnreachableError();
    },
    discoverBrain: async () => [],
    device: async () => null,
    findBrains: async () => (search++ % 2 ? [found] : []),
  };
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('the sign-in page while this PC is not paired', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps an open pairing form and what was typed across every re-check', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const mode = { health: 'unreachable' as 'unreachable' | 'down' };
    renderWithProviders(<LoginPage />, { platform: flakyPlatform(mode) });
    await user.click(await screen.findByRole('button', { name: /Advanced: pair with a code/ }));
    await user.type(screen.getByLabelText('Pairing code'), 'ABCD-EFGH');
    for (let i = 0; i < 16; i++) {
      if (i === 6) mode.health = 'down'; // the gate changes under the open form
      await tick(2500);
      expect(screen.getByLabelText('Pairing code')).toHaveValue('ABCD-EFGH');
    }
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Pairing code')).not.toBeInTheDocument();
  });

  it('does not jump between "found" and "not found" when one search misses', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 0;
    const p: Platform = {
      ...flakyPlatform({ health: 'unreachable' }),
      findBrains: async () => (n++ === 0 || n % 2 ? [found] : []),
    };
    renderWithProviders(<LoginPage />, { platform: p });
    expect(await screen.findByText('Found on this network')).toBeInTheDocument();
    for (let i = 0; i < 6; i++) {
      await tick(10_000);
      expect(screen.queryByText('No Lefi Brain found on this network.')).not.toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /Check now/ })).toBeInTheDocument();
  });
});
