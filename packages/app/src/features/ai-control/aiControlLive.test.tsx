import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { AiControlView } from '@lefi/api';
import type { ApiRequest } from '@lefi/platform';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { AiControlLive } from './AiControlLive';

const NOW = '2026-11-11T10:00:00Z';
const HEALTH = { status: 'ok', service: 'lefi-brain', version: '0.7.1', time: NOW };

const view: AiControlView = {
  state: 'available',
  reason: 'fake AI node answers (test)',
  model: 'fake-model',
  kill_switch: false,
  stopped_note: null,
  busy: 0,
  parts: [
    { name: 'Lefi AI assistant (chat)', kind: 'ai', state: 'online', detail: 'ok' },
    { name: 'Vision diagnosis of plants', kind: 'ai', state: 'not_built', detail: 'Not built.' },
    { name: 'Rules engine and alerts', kind: 'no_ai', state: 'online', detail: 'watching' },
  ],
  actions: [
    {
      name: 'Aim, zoom or photograph a camera',
      area: 'Cameras',
      mode: 'allowed_per_camera',
      detail: 'Only cameras a person allowed',
      cameras: ['Fake bench camera'],
    },
    {
      name: 'Apply pesticide or fungicide',
      area: 'Crop protection',
      mode: 'not_available',
      detail: 'Not allowed (test)',
      cameras: [],
    },
  ],
  settings: [{ name: 'Sources', value: 'Only Lefi Brain’s own data (no internet)' }],
  tools: ['current_readings'],
  can_stop: true,
  can_resume: false,
};

describe('AiControlLive', () => {
  it('shows only what exists, and stops Lefi AI with a reason', async () => {
    const calls: ApiRequest[] = [];
    const stopped = { ...view, kill_switch: true, stopped_note: 'stopped by Fake (test)' };
    let current: AiControlView = view;
    const base = fakePlatform({ '/ai/control': view, '/health': HEALTH });
    const platform = {
      ...base,
      api: async <T,>(req: ApiRequest): Promise<T> => {
        calls.push(req);
        if (req.method === 'POST' && req.path === '/ai/stop') current = stopped;
        if (req.path === '/ai/stop' || req.path === '/ai/control') return current as T;
        return base.api<T>(req);
      },
    };
    renderWithProviders(<AiControlLive />, {
      platform,
      session: session(['nav.aiControl', 'ai.halt']),
    });
    expect((await screen.findAllByText('Online')).length).toBeGreaterThan(1);
    expect(screen.getByText('Not built yet')).toBeInTheDocument();
    expect(screen.getByText('Nothing runs automatically')).toBeInTheDocument();
    expect(screen.getByText('Not available')).toBeInTheDocument();
    expect(screen.getByText('Allowed per camera')).toBeInTheDocument();
    expect(screen.queryByText(/Autonomous/)).not.toBeInTheDocument();
    const stop = screen.getByRole('button', { name: /STOP LEFI AI/ });
    expect(stop).toBeDisabled(); // a reason first
    fireEvent.change(screen.getByPlaceholderText(/wrong bench/), {
      target: { value: 'testing the stop' },
    });
    fireEvent.click(stop);
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'POST',
          path: '/ai/stop',
          body: { reason: 'testing the stop' },
        }),
      ),
    );
    expect(await screen.findByText('stopped by Fake (test)')).toBeInTheDocument();
    // A grower may stop but not resume.
    expect(screen.getByRole('button', { name: /Resume Lefi AI/ })).toBeDisabled();
  });
});
