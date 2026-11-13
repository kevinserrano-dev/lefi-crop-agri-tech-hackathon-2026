import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiRequest, Platform } from '@lefi/platform';
import type { RosterWeek } from '@lefi/api';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { ShiftsLive } from './ShiftsLive';

const days = Array.from({ length: 7 }, (_, i) => `2026-11-${String(9 + i).padStart(2, '0')}`);
const week = (over: Partial<RosterWeek> = {}): RosterWeek => ({
  brain_time: '2026-11-12T14:00:00Z',
  timezone: 'America/Toronto',
  start: days[0]!,
  days: days.map((d, i) => ({ day: d, label: `D${i}`, today: i === 3 })),
  types: [
    {
      id: 'day',
      name: 'Day',
      start: '06:00',
      end: '14:30',
      hours: 8.5,
      overnight: false,
      tone: 'ok',
      retired: false,
    },
  ],
  people: [
    {
      id: 'u1',
      name: 'Luis Ortega',
      role: 'maint',
      hours: 8.5,
      cells: days.map((d, i) => ({ day: d, shift_type_id: i === 3 ? 'day' : null, leave: false })),
    },
  ],
  coverage: days.map((d, i) => ({
    day: d,
    by_type: (i === 3 ? { day: 1 } : {}) as Record<string, number>,
  })),
  can_edit: true,
  ...over,
});

function brain(calls: ApiRequest[], w: RosterWeek): Platform {
  const p = fakePlatform();
  p.api = async <T,>(req: ApiRequest): Promise<T> => {
    calls.push(req);
    if (req.path === '/shifts/week') return w as T;
    if (req.path === '/shifts/assignments') return [] as T;
    throw new Error(`unexpected ${req.method} ${req.path}`);
  };
  return p;
}

describe('Workforce → Shifts against the real Lefi Brain (ADR-094)', () => {
  it('shows the week in greenhouse time and changes a day', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<ShiftsLive />, {
      platform: brain(calls, week()),
      session: session(['nav.workforce', 'shift.edit']),
    });
    expect(await screen.findByText('Luis Ortega')).toBeInTheDocument();
    expect(screen.getByText(/America\/Toronto/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Luis Ortega · D0'), 'leave');
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/shifts/assignments')?.body).toEqual({
        user_id: 'u1',
        day: days[0],
        shift_type_id: null,
        leave: true,
      }),
    );
  });

  it('asks to define shifts first, and is read-only without shift.edit', async () => {
    renderWithProviders(<ShiftsLive />, {
      platform: brain([], week({ types: [], can_edit: false })),
      session: session(['nav.workforce']),
    });
    expect(await screen.findByText('No shift types yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /define shifts/i })).not.toBeInTheDocument();
  });
});
