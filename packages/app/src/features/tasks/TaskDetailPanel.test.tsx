import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TaskDetail } from '@lefi/api';
import type { ApiRequest, Platform } from '@lefi/platform';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { useToast } from '../../shared/ui';
import { TaskDetailPanel } from './TaskDetailPanel';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => () => undefined }));

const ok = { allowed: true, reason: null };
const base: TaskDetail = {
  id: 'T-TEST',
  title: 'Fake task',
  zone_id: 'Z1',
  assignee: 'Tester',
  due_label: 'Today',
  priority: 'high',
  status: 'In progress',
  created_by: 'ai',
  incident_id: null,
  type: 'Task',
  origin: 'SIMULATED',
  source: 'Test',
  notes: null,
  evidence: [],
  verified_by: null,
  actions: {
    start: { allowed: false, reason: 'x' },
    submit: ok,
    verify: { allowed: false, reason: 'Requires permission: Verify completed work' },
    return: { allowed: false, reason: 'Requires permission: Verify completed work' },
    attach_photo: { allowed: false, reason: 'Photo upload is not available yet.' },
  },
};

function platformWith(t: TaskDetail, calls: ApiRequest[]): Platform {
  let current = t;
  return {
    ...fakePlatform(),
    api: async <T,>(req: ApiRequest) => {
      calls.push(req);
      if (req.method === 'POST') {
        current = { ...current, status: 'Awaiting verification', notes: 'done and checked' };
        return { item: current, message: 'Sent for verification.' } as T;
      }
      return current as T;
    },
  };
}

describe('TaskDetailPanel', () => {
  it('submits completion notes to the Brain', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<TaskDetailPanel id="T-TEST" />, {
      platform: platformWith(base, calls),
      session: session(['nav.tasks']),
    });
    await userEvent.type(await screen.findByLabelText('Completion notes'), 'done and checked');
    await userEvent.click(
      screen.getByRole('button', { name: 'Submit for supervisor verification' }),
    );
    await waitFor(() => expect(useToast.getState().toast?.msg).toBe('Sent for verification.'));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      path: '/tasks/T-TEST/transition',
      body: { action: 'submit', notes: 'done and checked' },
    });
    expect(await screen.findByRole('button', { name: 'Verify work' })).toHaveAttribute(
      'title',
      'Requires permission: Verify completed work',
    );
  });

  it('keeps photo upload locked with the Brain’s reason', async () => {
    renderWithProviders(<TaskDetailPanel id="T-TEST" />, {
      platform: platformWith(base, []),
      session: session(['nav.tasks']),
    });
    expect(await screen.findByRole('button', { name: 'Attach photo' })).toHaveAttribute(
      'title',
      'Photo upload is not available yet.',
    );
    expect(screen.getByText('AI-generated')).toBeInTheDocument();
  });
});
