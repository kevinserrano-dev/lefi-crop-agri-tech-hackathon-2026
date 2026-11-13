import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiRequest, Platform } from '@lefi/platform';
import type { OnCall, RoutingPreview, RoutingView } from '@lefi/api';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { EscalationLive } from './EscalationLive';

const view = (over: Partial<RoutingView> = {}): RoutingView => ({
  brain_time: '2026-11-12T14:00:00Z',
  timezone: 'America/Toronto',
  policy: {
    mode: 'dynamic',
    roles: { environment: 'grower', plant: 'scout', device: 'maint', system: 'maint' },
    match_role: true,
    skip_unavailable: true,
    warnings: true,
    quiet: true,
    quiet_start: '22:00',
    quiet_end: '06:00',
    delays: [0, 5, 10],
    fixed: [],
    set_by_person: false,
    updated_by: null,
    updated_at: null,
  },
  categories: {
    environment: 'Climate / environment',
    plant: 'Plants',
    device: 'Devices & sensors',
    system: 'Lefi Brain',
  },
  roles: ['admin', 'manager', 'grower', 'supervisor', 'scout', 'maint', 'worker'],
  channels: [
    { key: 'in_app', label: 'In the apps', available: true, reason: null },
    { key: 'sms', label: 'SMS', available: false, reason: 'No phone service offline.' },
    { key: 'voice', label: 'Voice call', available: false, reason: 'No phone service offline.' },
  ],
  people: [],
  deliveries: [
    {
      at: '2026-11-12T13:50:00Z',
      alert_id: 'a1',
      alert: 'INC-0004',
      title: 'Air temperature high',
      level: 1,
      user: 'Gus Grower',
      channel: 'In the apps',
      reason: 'on shift (Day 06:00-14:30) · grower handles climate / environment',
    },
  ],
  can_edit: true,
  ...over,
});

const preview: RoutingPreview = {
  category: 'environment',
  category_label: 'Climate / environment',
  at: '2026-11-12T14:00:00Z',
  quiet_now: false,
  steps: [
    {
      level: 1,
      user_id: 'u1',
      name: 'Marcus Okafor',
      role: 'supervisor',
      after_min: 0,
      reason: 'on shift (Day 06:00-14:30) · supervisor',
      channel: 'In the apps',
    },
    {
      level: 2,
      user_id: 'u2',
      name: 'Tyler Brooks',
      role: 'maint',
      after_min: 5,
      reason: '24/7 on call · primary today',
      channel: 'In the apps',
    },
  ],
};

const oncall: OnCall = {
  brain_time: '2026-11-12T14:00:00Z',
  timezone: 'America/Toronto',
  members: [
    {
      user_id: 'u2',
      name: 'Tyler Brooks',
      role: 'maint',
      enabled: true,
      contact: '(519) 326-4396',
      primary_today: true,
    },
  ],
  candidates: [],
  days: [
    { day: '2026-11-09', label: 'Mon', today: false, user_id: null, name: null },
    { day: '2026-11-12', label: 'Thu', today: true, user_id: 'u2', name: 'Tyler Brooks' },
  ],
  can_edit: false,
};

function brain(calls: ApiRequest[], v: RoutingView): Platform {
  const p = fakePlatform();
  p.api = async <T,>(req: ApiRequest): Promise<T> => {
    calls.push(req);
    if (req.path === '/escalation') return v as T;
    if (req.path === '/escalation/preview') return preview as T;
    if (req.path === '/oncall') return oncall as T;
    if (req.path === '/escalation/policy') return v.policy as T;
    throw new Error(`unexpected ${req.method} ${req.path}`);
  };
  return p;
}

describe('Escalation Rules against the real Lefi Brain (ADR-096)', () => {
  it('previews who is told, says SMS and voice are not available, and saves a rule', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<EscalationLive />, {
      platform: brain(calls, view()),
      session: session(['nav.escalation', 'escalation.edit']),
    });
    expect(await screen.findByText('Marcus Okafor')).toBeInTheDocument();
    expect(screen.getByText('+5 min if no ack')).toBeInTheDocument();
    expect(screen.getByText('SMS · not available')).toBeInTheDocument();
    expect(screen.getByText('Voice call · not available')).toBeInTheDocument();
    expect(screen.getByText(/starting values/)).toBeInTheDocument();
    expect(screen.getByText('Primary today')).toBeInTheDocument();
    expect(screen.getByText('Gus Grower')).toBeInTheDocument(); // the log
    await userEvent.click(screen.getByRole('switch', { name: 'Escalate warnings too' }));
    await waitFor(() =>
      expect(
        (calls.find((c) => c.path === '/escalation/policy')?.body as { warnings: boolean })
          .warnings,
      ).toBe(false),
    );
  });

  it('is read-only without escalation.edit', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<EscalationLive />, {
      platform: brain(calls, view({ can_edit: false })),
      session: session(['nav.escalation']),
    });
    expect(await screen.findByText(/Read-only/)).toBeInTheDocument();
    const sw = screen.getByRole('switch', { name: 'Escalate warnings too' });
    expect(sw).toHaveAttribute('data-locked', 'true');
    await userEvent.click(sw);
    expect(calls.some((c) => c.path === '/escalation/policy')).toBe(false);
  });
});
