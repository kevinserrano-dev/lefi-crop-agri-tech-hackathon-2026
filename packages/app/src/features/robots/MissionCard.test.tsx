import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RobotLive } from '@lefi/api';
import type { ApiRequest, Platform } from '@lefi/platform';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { MissionCard, WorkflowCard } from './LiveCards';

const ok = { allowed: true, reason: null };
const DENY = { allowed: false, reason: 'Requires permission: Send movement commands to robots' };

const live = (over: Partial<RobotLive> = {}): RobotLive =>
  ({
    sim: { speed: 1, driver: 'sim', simulated: true },
    fleet: [],
    robot: {
      id: 'R',
      model: 'm',
      mode: 'Navigating',
      battery_pct: 80,
      link: 'l',
      position: { x: 0, y: 0 },
      position_m: { x: 0, y: 0 },
      location: 'Main aisle',
      speed_mps: 0.6,
      remaining_m: 10,
    },
    map: {
      title: '',
      subtitle: '',
      width: 10,
      height: 10,
      aisle_y: 5,
      dock: { x: 0, y: 0 },
      zones: [],
      targets: [{ id: 'B-03', x: 1, y: 1, allowed: true, reason: null }],
      route: [],
      crew: [],
    },
    workflow_step: 6,
    workflow_skipped: [1, 2, 3],
    mission: {
      id: 'M-1',
      title: 'Spot inspection',
      origin: 'Manual · T',
      target: 'B-03',
      state: 'Navigating',
      elapsed_s: 30,
      photos: 0,
      log: [],
    },
    camera: { live: false, label: '', time: '' },
    photos: [],
    summary: { state: 'available', text: null, simulated: true },
    commands: [],
    queue: [],
    controls: {
      pause: ok,
      resume: ok,
      cancel: ok,
      return: ok,
      photo: ok,
      video: ok,
      status: ok,
      goto: ok,
    },
    queue_actions: ok,
    auth_note: '',
    ...over,
  }) as RobotLive;

function platformWith(calls: ApiRequest[]): Platform {
  return {
    ...fakePlatform(),
    api: async <T,>(req: ApiRequest) => {
      calls.push(req);
      return { item: live(), message: 'ok' } as T;
    },
  };
}

describe('MissionCard', () => {
  it('always shows Cancel during a mission and sends a safe-stop cancel', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<MissionCard live={live()} />, {
      platform: platformWith(calls),
      session: session(['nav.robots']),
    });
    await userEvent.click(screen.getByRole('button', { name: /Cancel mission · safe stop/ }));
    await waitFor(() =>
      expect(calls[0]).toMatchObject({
        path: '/robots/LEFI-R1/commands',
        body: { intent: 'mission.cancel' },
      }),
    );
  });

  it('shows movement controls locked with the Brain’s reason for roles without permission', () => {
    const l = live({
      mission: null,
      controls: {
        pause: DENY,
        resume: DENY,
        cancel: DENY,
        return: DENY,
        photo: DENY,
        video: DENY,
        status: ok,
        goto: DENY,
      },
    });
    renderWithProviders(<MissionCard live={l} />, {
      platform: platformWith([]),
      session: session(['nav.robots']),
    });
    expect(screen.getByRole('button', { name: 'Dispatch inspection' })).toHaveAttribute(
      'title',
      DENY.reason,
    );
  });
});

describe('WorkflowCard', () => {
  it('marks AI steps as not applicable for a manual mission', () => {
    renderWithProviders(<WorkflowCard step={6} skipped={[1, 2, 3]} />);
    expect(screen.getByText('AI creates plant health alert').closest('li')).toHaveAttribute(
      'data-skipped',
      'true',
    );
    expect(screen.getByText('Autonomous navigation').closest('li')).toHaveAttribute(
      'data-current',
      'true',
    );
  });
});
