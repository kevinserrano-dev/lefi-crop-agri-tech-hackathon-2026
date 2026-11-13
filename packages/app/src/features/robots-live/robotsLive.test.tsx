import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SimMission, SimRobot, SimScene } from '@lefi/api';
import type { ApiRequest, Platform } from '@lefi/platform';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { RobotsLive } from './RobotsLive';
import { AddRobotForm, RobotsDevices } from './RobotDevice';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#test">{children}</a>,
}));
import { SceneMap } from './SceneMap';

// Test data only: a made-up simulated scene, never a real greenhouse.
const scene: SimScene = {
  id: 'sim-test',
  name: 'Simulated greenhouse',
  origin: 'SIMULATED',
  bounds: { x_min: -1, x_max: 5, y_min: -2, y_max: 2 },
  start: { x: 0, y: 0, yaw_deg: 0 },
  benches: [{ id: 'b1', label: 'Bench A', x: 2, y: 1.2, length: 3, width: 0.8, height: 0.75 }],
  stations: [
    {
      id: 'sim-p1',
      label: 'Plant 1',
      kind: 'lettuce',
      bench: 'b1',
      x: 1.5,
      y: 1.1,
      approach: { x: 1.5, y: 0.5, yaw_deg: 90 },
    },
    {
      id: 'dock',
      label: 'Charging dock',
      kind: 'dock',
      bench: null,
      x: -0.7,
      y: 0,
      approach: { x: 0, y: 0, yaw_deg: 0 },
    },
  ],
  decor_plants: [{ x: 2.5, y: 1.3, kind: 'tomato' }],
};

const mission: SimMission = {
  id: 'm1',
  robot_id: 'mh3-sim',
  kind: 'inspect',
  station_id: 'sim-p1',
  station_label: 'Plant 1',
  state: 'NAVIGATING',
  active: true,
  created_by: 'u1',
  created_at: '2026-11-12T10:00:00Z',
  updated_at: '2026-11-12T10:00:02Z',
  finished_at: null,
  reason: null,
  has_photo: false,
  photo_at: null,
  origin: 'SIMULATED',
  events: [
    { at: '2026-11-12T10:00:00Z', state: 'QUEUED', note: null },
    { at: '2026-11-12T10:00:01Z', state: 'DISPATCHED', note: 'go to Plant 1' },
    { at: '2026-11-12T10:00:02Z', state: 'NAVIGATING', note: 'driving to Plant 1' },
  ],
};

function robot(over: Partial<SimRobot> = {}): SimRobot {
  return {
    id: 'mh3-sim',
    name: 'MH3 (simulated)',
    model: 'Mirsee Robotics MH3',
    origin: 'SIMULATED',
    connection: 'online',
    backend: 'lite',
    feeds: [],
    state: {
      pose: { x: 0.5, y: 0.2, yaw_deg: 30 },
      phase: 'driving',
      moving: true,
      linear_mps: 0.3,
      angular_radps: 0,
      head_pitch: 0,
      odometry_m: 1.2,
      sim_time: 4,
      active_command: null,
    },
    last_seen: '2026-11-12T10:00:02Z',
    active_mission: null,
    error: null,
    ...over,
  };
}

function platform(r: SimRobot, calls: ApiRequest[] = []): Platform {
  return {
    ...fakePlatform(),
    api: async <T,>(req: ApiRequest): Promise<T> => {
      calls.push(req);
      if (req.method === 'POST' && req.path === '/robot-missions')
        return { ...mission, state: 'DISPATCHED' } as T;
      if (req.method === 'POST' && req.path.endsWith('/cancel'))
        return { ...mission, state: 'CANCELLED', active: false } as T;
      if (req.method === 'POST' && req.path.endsWith('/stop')) return {} as T;
      const routes: Record<string, unknown> = {
        '/robots': [r],
        '/robots/mh3-sim/scene': scene,
        '/robots/mh3-sim/commands': [
          {
            id: 'c1',
            robot_id: 'mh3-sim',
            mission_id: 'm1',
            kind: 'go_to',
            args: { station_id: 'sim-p1' },
            state: 'running',
            actor: 'lefi-brain',
            sent_at: '2026-11-12T10:00:01Z',
            expires_at: '2026-11-12T10:00:31Z',
            updated_at: null,
            message: null,
          },
        ],
        '/robot-missions': [],
      };
      if (req.path in routes) return routes[req.path] as T;
      throw new Error(`unexpected ${req.path}`);
    },
  };
}

describe('Robot Mission Center (live, simulated)', () => {
  it('says so when there is no robot, and where to add it', async () => {
    renderWithProviders(<RobotsLive />, {
      platform: { ...fakePlatform({ '/robots': [] }) },
      session: session(['nav.robots', 'device.manage']),
    });
    expect(await screen.findByText('No simulated robot yet')).toBeInTheDocument();
    expect(screen.getByText(/Add it in Devices & Health/)).toBeInTheDocument();
  });

  it('labels everything simulated and shows the commands Lefi Brain sent', async () => {
    renderWithProviders(<RobotsLive />, {
      platform: platform(robot()),
      session: session(['nav.robots', 'robot.camera']),
    });
    expect(await screen.findByText('SIMULATION')).toBeInTheDocument();
    expect(await screen.findByText('go_to')).toBeInTheDocument();
    expect(screen.getByText('sim-p1')).toBeInTheDocument();
    expect(screen.getByText(/lite backend/)).toBeInTheDocument();
  });

  it('starts an inspection of the chosen plant with an idempotency key', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<RobotsLive />, {
      platform: platform(robot(), calls),
      session: session(['nav.robots', 'robot.command']),
    });
    await userEvent.click(await screen.findByRole('button', { name: /Plant 1\s*lettuce/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Inspect Plant 1' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        path: '/robot-missions',
        body: { robot_id: 'mh3-sim', station_id: 'sim-p1', kind: 'inspect' },
      }),
    );
    const body = calls.find((c) => c.method === 'POST')!.body as { idempotency_key: string };
    expect(body.idempotency_key.length).toBeGreaterThan(8);
  });

  it('lets a role that cannot command still cancel and stop', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<RobotsLive />, {
      platform: platform(robot({ active_mission: mission }), calls),
      session: session(['nav.robots']),
    });
    expect((await screen.findAllByText('Driving')).length).toBeGreaterThan(0);
    expect(screen.getByText(/needs the robot camera permission/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel mission' }));
    await userEvent.click(screen.getByRole('button', { name: 'Safe stop' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
        '/robot-missions/m1/cancel',
        '/robots/mh3-sim/stop',
      ]),
    );
  });

  it('cannot send the robot without robot.command', async () => {
    renderWithProviders(<RobotsLive />, {
      platform: platform(robot()),
      session: session(['nav.robots']),
    });
    expect(await screen.findByRole('button', { name: 'Return to dock' })).toBeDisabled();
    expect(screen.getByText(/can watch the robot but not send it/)).toBeInTheDocument();
  });
});

describe('SceneMap', () => {
  it('draws the robot where it is and lets a person pick a plant', async () => {
    const picked: string[] = [];
    renderWithProviders(
      <SceneMap
        scene={scene}
        pose={{ x: 1.25, y: -0.5, yaw_deg: 90 }}
        trail={[]}
        onPick={(id) => picked.push(id)}
      />,
    );
    expect(screen.getByLabelText('Robot at x 1.25 m, y -0.50 m')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Choose Plant 1' }));
    expect(picked).toEqual(['sim-p1']);
  });
});

// ---------------------------------------------------------------- the robot as a device (ADR-090)

const installed = {
  node_id: 'main',
  node_name: 'lefi-main',
  backend: 'genesis' as const,
  status: 'installed' as const,
  progress: { steps_done: 4, steps_total: 4, title: null, message: null, error_code: null },
  created_by: 'u1',
  created_at: '2026-11-12T10:00:00Z',
  updated_at: '2026-11-12T10:05:00Z',
};

function devicePlatform(r: SimRobot | null, calls: ApiRequest[] = []): Platform {
  return {
    ...fakePlatform(),
    api: async <T,>(req: ApiRequest): Promise<T> => {
      calls.push(req);
      if (req.path === '/robot-places')
        return [
          {
            node_id: 'main',
            name: 'lefi-main',
            is_main: true,
            online: true,
            eligible: true,
            reason: null,
          },
          {
            node_id: 'pc-ai',
            name: 'lefi-node-1',
            is_main: false,
            online: true,
            eligible: false,
            reason: 'ai_node',
          },
        ] as T;
      if (req.method === 'POST' && req.path === '/robots') return robot() as T;
      if (req.method === 'POST' || req.method === 'DELETE') return (r ?? robot()) as T;
      if (req.path === '/robots') return (r ? [r] : []) as T;
      if (req.path === '/robots/mh3-sim/scene') return scene as T;
      if (req.path === '/robots/mh3-sim/commands' || req.path === '/robot-missions') return [] as T;
      throw new Error(`unexpected ${req.path}`);
    },
  };
}

describe('Adding the simulated robot (ADR-090)', () => {
  it('offers only a PC without the AI node and installs it there in 3D by default', async () => {
    const calls: ApiRequest[] = [];
    const added: string[] = [];
    renderWithProviders(
      <AddRobotForm onClose={() => undefined} onAdded={() => added.push('y')} />,
      {
        platform: devicePlatform(null, calls),
        session: session(['device.manage']),
      },
    );
    const ai = await screen.findByRole('radio', { name: /lefi-node-1/ });
    expect(ai).toBeDisabled();
    expect(screen.getByText(/Runs the AI node/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /lefi-main/ })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Install simulated robot' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        path: '/robots',
        body: { node_id: 'main', backend: 'genesis', cpu: false },
      }),
    );
    expect(added).toEqual(['y']);
  });

  it('shows the install progress and, once installed, the power switch and Remove', async () => {
    const calls: ApiRequest[] = [];
    const installing = robot({
      connection: 'never_seen',
      state: null,
      device: {
        ...installed,
        status: 'installing',
        progress: {
          steps_done: 2,
          steps_total: 4,
          title: 'Simulated robot',
          message: 'Setting up the starter',
          error_code: null,
        },
      },
    });
    const { unmount } = renderWithProviders(<RobotsDevices onAdd={() => undefined} />, {
      platform: devicePlatform(installing),
      session: session(['device.manage']),
    });
    expect(await screen.findByRole('progressbar', { name: 'Installing' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
    expect(screen.getByText('Setting up the starter')).toBeInTheDocument();
    unmount();

    renderWithProviders(<RobotsDevices onAdd={() => undefined} />, {
      platform: devicePlatform(robot({ device: installed, power: 'off' }), calls),
      session: session(['device.manage']),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on robot' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(
        calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.path, c.body]),
      ).toEqual([
        ['POST', '/robots/mh3-sim/power', { on: true }],
        ['DELETE', '/robots/mh3-sim', undefined],
      ]),
    );
  });

  it('the Mission Center offers to turn an added robot on when it is off', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<RobotsLive />, {
      platform: devicePlatform(
        robot({ device: installed, power: 'off', connection: 'offline' }),
        calls,
      ),
      session: session(['nav.robots', 'robot.command']),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on robot' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        path: '/robots/mh3-sim/power',
        body: { on: true },
      }),
    );
  });

  it('a role without robot.command or device.manage cannot turn it on', async () => {
    renderWithProviders(<RobotsLive />, {
      platform: devicePlatform(robot({ device: installed, power: 'off', connection: 'offline' })),
      session: session(['nav.robots']),
    });
    expect(await screen.findByRole('button', { name: 'Turn on robot' })).toBeDisabled();
  });

  it('shows a spinner and the time taken while it starts, and what the simulator prints', async () => {
    renderWithProviders(<RobotsLive />, {
      platform: devicePlatform(
        robot({
          device: { ...installed, backend: 'genesis' },
          power: 'starting',
          connection: 'never_seen',
          state: null,
          power_detail: {
            problem: null,
            message: null,
            log_tail: 'Building the scene…',
            since: '2026-11-12T10:00:00Z',
          },
        }),
      ),
      session: session(['nav.robots', 'robot.command']),
    });
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Starting · 0:00');
    expect(status).toHaveTextContent('building the 3D scene');
    expect(screen.getByRole('button', { name: 'Cancel start' })).toBeEnabled();
    expect(
      screen.getAllByText('Starting the simulator… the views appear when it answers.').length,
    ).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Show what the simulator printed' }));
    expect(screen.getByText('Building the scene…')).toBeInTheDocument();
  });

  it('a robot whose starter is missing cannot be turned on and offers Reinstall', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<RobotsDevices onAdd={() => undefined} />, {
      platform: devicePlatform(
        robot({
          device: { ...installed, backend: 'genesis' },
          power: 'off',
          connection: 'never_seen',
          error: null,
          power_detail: { problem: 'starter_missing', message: null, log_tail: null, since: null },
        }),
        calls,
      ),
      session: session(['device.manage']),
    });
    expect(await screen.findByRole('status')).toHaveTextContent('The MH3 starter is missing');
    expect(screen.queryByRole('button', { name: 'Turn on robot' })).not.toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Reinstall' });
    await userEvent.click(buttons[0]!);
    await userEvent.click(screen.getAllByRole('button', { name: 'Reinstall' })[0]!);
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        path: '/robots/mh3-sim/reinstall',
        body: { cpu: false },
      }),
    );
  });

  it('a robot that stopped by itself shows why, with its last log lines', async () => {
    renderWithProviders(<RobotsLive />, {
      platform: devicePlatform(
        robot({
          device: installed,
          power: 'off',
          connection: 'offline',
          error: null,
          power_detail: {
            problem: 'stopped',
            message: null,
            log_tail: "ModuleNotFoundError: No module named 'genesis'",
            since: null,
          },
        }),
      ),
      session: session(['nav.robots', 'robot.command']),
    });
    expect(await screen.findByRole('status')).toHaveTextContent('It stopped by itself');
    expect(screen.getByText("ModuleNotFoundError: No module named 'genesis'")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on robot' })).toBeEnabled();
  });
});
