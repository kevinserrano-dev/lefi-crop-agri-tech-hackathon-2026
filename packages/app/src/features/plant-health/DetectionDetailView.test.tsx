import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DetectionDetail } from '@lefi/api';
import type { ApiRequest, Platform } from '@lefi/platform';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { useToast } from '../../shared/ui';
import { DetectionDetailView } from './DetectionDetailView';

const ok = { allowed: true, reason: null };
const det: DetectionDetail = {
  id: 'AI-TEST-1',
  zone_id: 'Z1',
  plant_id: 'P-1',
  finding: 'Fake finding',
  severity: 'warning',
  confidence: 72,
  status: 'unconfirmed',
  captured_at: '2026-11-05T08:00:00Z',
  origin: 'SIMULATED',
  simulated: true,
  category: 'Test',
  variety: 'Test variety',
  batch: 'B-1',
  camera: 'CAM-T',
  reviewer: null,
  frame: { image_url: null, label: 'SIMULATED FRAME', resolution: '—' },
  comparison: { interval: '7 d', before: 'a', after: 'b', changes: [] },
  boxes: [{ label: 'Box 72%', x: 10, y: 10, w: 20, h: 20, tone: 'warn' }],
  leaf_colour: [{ key: 'healthy', label: 'Healthy green', pct: 100 }],
  growth: [],
  symptoms: [],
  evidence: ['Fake evidence'],
  review_threshold: 60,
  recommendation: { text: 'Fake recommendation', simulated: true },
  actions: {
    confirm: { allowed: false, reason: 'Requires permission: Confirm / reject AI diagnosis' },
    reject: ok,
    request_inspection: ok,
  },
};

/** Fake Brain that keeps the reviewed state, like the real one would. */
function platformWith(calls: ApiRequest[]): Platform {
  let current: DetectionDetail = det;
  return {
    ...fakePlatform(),
    api: async <T,>(req: ApiRequest) => {
      calls.push(req);
      if (req.method === 'POST') {
        current = { ...det, status: 'rejected', reviewer: 'Tester' };
        return { item: current, message: 'Rejected.' } as T;
      }
      return current as T;
    },
  };
}

describe('DetectionDetailView', () => {
  it('says it is a prediction, flags simulated data and the missing image', async () => {
    renderWithProviders(<DetectionDetailView id="AI-TEST-1" />, {
      platform: platformWith([]),
      session: session(['nav.plantHealth']),
    });
    expect(
      await screen.findByText(/This is an AI prediction, not a diagnosis/),
    ).toBeInTheDocument();
    expect(screen.getByText('Simulated detection')).toBeInTheDocument();
    expect(screen.getByText(/No real image/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm diagnosis' })).toHaveAttribute(
      'title',
      'Requires permission: Confirm / reject AI diagnosis',
    );
  });

  it('records a rejection through the Brain', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<DetectionDetailView id="AI-TEST-1" />, {
      platform: platformWith(calls),
      session: session(['nav.plantHealth']),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(useToast.getState().toast?.msg).toBe('Rejected.'));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      path: '/detections/AI-TEST-1/review',
      body: { decision: 'reject' },
    });
    await waitFor(() => expect(document.body.textContent).toContain('false positive sent back'));
  });
});
