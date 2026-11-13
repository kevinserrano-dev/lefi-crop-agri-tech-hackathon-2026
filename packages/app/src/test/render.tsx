import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { queryKeys, type Session } from '@lefi/api';
import type { Platform } from '@lefi/platform';
import { PlatformProvider } from '../platform/PlatformContext';

/** A Platform whose `api` answers from a path → value map; anything else rejects. */
export function fakePlatform(routes: Record<string, unknown> = {}): Platform {
  return {
    kind: 'web',
    api: async <T,>(req: { path: string }): Promise<T> => {
      if (req.path in routes) return routes[req.path] as T;
      throw new Error(`unexpected ${req.path}`);
    },
    subscribe: () => () => undefined,
    notify: () => undefined,
    secrets: { get: async () => null, set: async () => undefined, del: async () => undefined },
    discoverBrain: async () => [],
    findBrains: async () => [],
    device: async () => null,
    pair: async () => {
      throw new Error('no');
    },
    forgetPairing: async () => undefined,
    pairingStatus: async () => null,
  };
}

export function renderWithProviders(
  ui: ReactElement,
  opts: { platform?: Platform; session?: Session } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (opts.session) qc.setQueryData(queryKeys.session, opts.session);
  return render(
    <PlatformProvider platform={opts.platform ?? fakePlatform()}>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </PlatformProvider>,
  );
}

export const session = (permissions: string[]): Session => ({
  user: { id: 'u1', username: 'test', email: 'test@example.invalid', display_name: 'Test User' },
  role: { id: 'worker', name: 'Greenhouse Worker', short: 'Worker' },
  permissions,
  must_change_password: false,
  session: { id: 's1', expires_at: '2026-11-08T10:00:00Z', idle_timeout_s: 28800 },
});
