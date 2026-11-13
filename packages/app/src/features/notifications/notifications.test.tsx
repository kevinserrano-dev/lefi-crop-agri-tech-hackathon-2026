import { act, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BrainNotification, BrainNotifications } from '@lefi/api';
import type { ApiRequest, Platform } from '@lefi/platform';
import { PlatformProvider } from '../../platform/PlatformContext';
import { fakePlatform } from '../../test/render';
import { useNotificationFeed } from './useNotificationFeed';

const NOW = '2026-11-11T10:00:00Z';
const note = (id: string, over: Partial<BrainNotification> = {}): BrainNotification => ({
  id,
  kind: 'alert_raised',
  severity: 'warning',
  title: `Fake alert ${id}`,
  body: 'Fake body (test)',
  alert_id: 'a1',
  alert_status: 'open',
  origin: 'LIVE',
  created_at: NOW,
  read: false,
  ...over,
});

function setup(first: BrainNotifications) {
  let current = first;
  const shown: string[] = [];
  const calls: ApiRequest[] = [];
  const p: Platform = fakePlatform();
  p.api = async <T,>(req: ApiRequest): Promise<T> => {
    calls.push(req);
    return current as T;
  };
  p.notify = ({ title }) => shown.push(title);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PlatformProvider platform={p}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </PlatformProvider>
  );
  return {
    shown,
    calls,
    qc,
    wrapper,
    next: (n: BrainNotifications) => {
      current = n;
    },
  };
}

describe('notifications from Lefi Brain', () => {
  it('pops up only what arrives while the app runs, once, labelled when simulated', async () => {
    const t = setup({ items: [note('n1')], unread: 1, preference: 'warning' });
    const { result } = renderHook(() => useNotificationFeed(true), { wrapper: t.wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(t.shown).toEqual([]); // already there at start: only in the bell
    t.next({
      items: [note('n3', { origin: 'SIMULATED' }), note('n2', { read: true }), note('n1')],
      unread: 2,
      preference: 'warning',
    });
    await act(() => t.qc.refetchQueries());
    await waitFor(() => expect(t.shown).toEqual(['Fake alert n3 (SIMULATED)']));
    await act(() => t.qc.refetchQueries());
    expect(t.shown).toHaveLength(1);
  });
});

describe('the bell against the real Lefi Brain', () => {
  it('shows unread notifications and marks one read when opened', async () => {
    const { renderWithProviders } = await import('../../test/render');
    const { LiveNotificationsMenu } = await import('./LiveNotificationsMenu');
    const calls: ApiRequest[] = [];
    const p = fakePlatform();
    p.api = async <T,>(req: ApiRequest): Promise<T> => {
      calls.push(req);
      if (req.path === '/notifications')
        return { items: [note('n1')], unread: 1, preference: 'warning' } as T;
      return { marked: 1, unread: 0 } as T;
    };
    p.notify = () => undefined;
    renderWithProviders(<LiveNotificationsMenu brainTime={NOW} />, { platform: p });
    const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    await userEvent.click(bell);
    expect(screen.getByText('Fake alert n1')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('warning');
    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/notifications/read')?.body).toEqual({}),
    );
  });
});
