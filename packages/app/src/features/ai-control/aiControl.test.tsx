import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AiControl } from '@lefi/api';
import type { ApiRequest, Platform } from '@lefi/platform';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { useToast } from '../../shared/ui';
import { AutonomyCard } from './AutonomyCard';
import { EmergencyCard } from './StatusCards';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => () => undefined }));

const ok = { allowed: true, reason: null };
const NOT = { allowed: false, reason: 'Not in the action allowlist.' };
const control: AiControl = {
  status: { state: 'halted', label: 'Stopped by emergency stop', detail: 'Stopped by Tester' },
  services: [],
  actions: { halt: { allowed: false, reason: 'Already stopped.' }, resume: ok },
  manual_mode: { keeps: [], paused: [] },
  automations: [],
  automations_note: null,
  autonomy: {
    can_edit: ok,
    rows: [
      {
        key: 'robot',
        label: 'Dispatch a robot',
        area: 'Robots',
        risk: 'Low',
        mode: 'ask',
        approver: 'supervisor',
        note: '',
        modes: { off: ok, ask: ok, auto: ok },
      },
      {
        key: 'dosing',
        label: 'Change nutrient dosing',
        area: 'Irrigation',
        risk: 'High',
        mode: 'off',
        approver: 'grower',
        note: '',
        modes: { off: ok, ask: NOT, auto: NOT },
      },
    ],
    guardrails: [],
    max_per_hour: 4,
    approvers: [{ id: 'supervisor', label: 'Supervisor' }],
  },
  settings: {
    can_edit: ok,
    depth: 'Standard',
    sources: [],
    min_confidence: 60,
    corroborating: 2,
    rescan: '24 h',
    toggles: [],
  },
};

function platformWith(calls: ApiRequest[]): Platform {
  return {
    ...fakePlatform({ '/ai/control': control }),
    api: async <T,>(req: ApiRequest) => {
      calls.push(req);
      if (req.method !== 'GET') return { item: control, message: 'Done.' } as T;
      return control as T;
    },
  };
}

describe('AI Control', () => {
  it('never sends a mode the Brain marked as not allowlisted', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<AutonomyCard c={control} />, {
      platform: platformWith(calls),
      session: session(['nav.aiControl']),
    });
    const dosing = screen.getByRole('group', { name: 'Mode for Change nutrient dosing' });
    await userEvent.click(dosing.querySelector('[data-mode="ask"]')!);
    await waitFor(() =>
      expect(useToast.getState().toast?.msg).toBe('Not in the action allowlist.'),
    );
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);

    const robot = screen.getByRole('group', { name: 'Mode for Dispatch a robot' });
    await userEvent.click(robot.querySelector('[data-mode="auto"]')!);
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
        path: '/ai/autonomy',
        body: { row: { key: 'robot', mode: 'auto' } },
      }),
    );
  });

  it('offers Resume when AI is stopped and asks the Brain to resume', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<EmergencyCard c={control} />, {
      platform: platformWith(calls),
      session: session(['nav.aiControl']),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Resume Lefi AI' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({ path: '/ai/resume' }),
    );
  });
});
