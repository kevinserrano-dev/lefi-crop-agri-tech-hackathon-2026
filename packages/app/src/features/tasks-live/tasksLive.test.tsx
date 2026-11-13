import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiRequest, Platform } from '@lefi/platform';
import type { TaskItem, TaskList } from '@lefi/api';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { TasksLive } from './TasksLive';

const task = (over: Partial<TaskItem>): TaskItem => ({
  id: 't1',
  number: 'T-0007',
  title: 'Check conditions: Air temperature high',
  detail: 'Air temperature in Fake zone is 28 °C (test).',
  kind: 'check_environment',
  assignee: 'person',
  status: 'open',
  priority: 'high',
  source: 'rule',
  origin: 'SIMULATED',
  created_at: '2026-11-11T10:00:00Z',
  updated_at: '2026-11-11T10:00:00Z',
  created_by: 'Lefi Brain',
  for_role: 'grower',
  assigned_to: null,
  assigned_to_name: null,
  zone_id: 'z1',
  zone: 'Fake zone',
  plant_id: null,
  alert_id: 'a1',
  alert_number: 'INC-0003',
  due_at: null,
  started_by: null,
  started_at: null,
  completed_by: null,
  completed_at: null,
  verified_by: null,
  verified_at: null,
  review_note: null,
  closed_by: null,
  closed_at: null,
  outcome: null,
  robot_note: null,
  ...over,
});

const ROBOT_REASON = 'No robot is connected to Lefi Brain yet (test).';

const list = (over: Partial<TaskList> = {}): TaskList => ({
  tasks: [
    task({}),
    task({
      id: 't2',
      number: 'T-0008',
      title: 'Robot inspection of Fake zone',
      kind: 'robot_inspection',
      assignee: 'robot',
      for_role: null,
      robot_note: ROBOT_REASON,
    }),
  ],
  people: [],
  counts: { open: 2, in_progress: 0, awaiting: 1, verified: 0, all: 3, urgent: 0, robot: 1 },
  robot: { available: false, reason: ROBOT_REASON },
  can_create: false,
  can_see_all: false,
  can_verify: false,
  ...over,
});

function brain(calls: ApiRequest[], data: TaskList): Platform {
  const p = fakePlatform();
  p.api = async <T,>(req: ApiRequest): Promise<T> => {
    calls.push(req);
    if (req.path === '/health') return { status: 'ok', time: '2026-11-11T10:05:00Z' } as T;
    if (req.path === '/tasks') return data as T;
    if (req.path.endsWith('/photos')) return [] as T;
    if (req.path === '/alert-insights') return { brain_time: '', insights: [] } as T;
    if (req.method === 'POST') return task({ status: 'awaiting' }) as T;
    throw new Error(`unexpected ${req.method} ${req.path}`);
  };
  return p;
}

describe('Tasks & Work Orders against the real Lefi Brain (ADR-093)', () => {
  it('shows tabs with counts, numbers and incidents, and sends work for verification', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<TasksLive />, {
      platform: brain(calls, list()),
      session: session(['nav.tasks']),
    });
    expect(await screen.findAllByText('Check conditions: Air temperature high')).not.toHaveLength(
      0,
    );
    expect(screen.getByRole('tab', { name: 'Awaiting verification · 1' })).toBeInTheDocument();
    expect(screen.getAllByText('T-0007')).not.toHaveLength(0);
    expect(screen.getAllByText('INC-0003')).not.toHaveLength(0);
    expect(screen.getByText('Robot inspections are waiting')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new task/i })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Note'), 'Opened the vents');
    await userEvent.click(screen.getByRole('button', { name: /submit for verification/i }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/tasks/t1/complete')?.body).toEqual({
        note: 'Opened the vents',
      }),
    );
  });

  it('lets a verifier verify, or return only with a reason', async () => {
    const calls: ApiRequest[] = [];
    const data = list({
      tasks: [task({ status: 'awaiting', outcome: 'Belt replaced', completed_by: 'Luis' })],
      can_verify: true,
    });
    renderWithProviders(<TasksLive />, {
      platform: brain(calls, data),
      session: session(['nav.tasks', 'task.verify']),
    });
    expect(await screen.findByText('Belt replaced')).toBeInTheDocument();
    const back = screen.getByRole('button', { name: /return to assignee/i });
    expect(back).toBeDisabled(); // a reason is required
    await userEvent.type(screen.getByLabelText('Note'), 'Add a photo of the belt');
    await userEvent.click(back);
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/tasks/t1/return')?.body).toEqual({
        note: 'Add a photo of the belt',
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: /verify work/i }));
    await waitFor(() => expect(calls.some((c) => c.path === '/tasks/t1/verify')).toBe(true));
  });

  it('filters by the search box', async () => {
    renderWithProviders(<TasksLive />, {
      platform: brain([], list()),
      session: session(['nav.tasks']),
    });
    await screen.findAllByText('Robot inspection of Fake zone');
    await userEvent.type(screen.getByLabelText('Search tasks'), 'T-0007');
    await waitFor(() =>
      expect(screen.queryByText('Robot inspection of Fake zone')).not.toBeInTheDocument(),
    );
  });
});
