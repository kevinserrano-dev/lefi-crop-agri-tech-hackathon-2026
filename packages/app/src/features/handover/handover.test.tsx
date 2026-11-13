import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Handover } from '@lefi/api';
import type { ApiRequest, Platform } from '@lefi/platform';
import { fakePlatform, renderWithProviders } from '../../test/render';
import { useToast } from '../../shared/ui';
import { HandoverHeader } from './HandoverHeader';
import { ShiftSummaryCard } from './ShiftSummaryCard';

const ok = { allowed: true, reason: null };
const base: Handover = {
  title: 'Day shift → Evening shift',
  outgoing: { name: 'Fake Outgoing', role_id: 'supervisor', shift: 'Outgoing · Day' },
  incoming: { name: 'Fake Incoming', role_id: 'supervisor', shift: 'Incoming · Evening' },
  signed: null,
  acknowledged: null,
  summary: {
    state: 'available',
    happened: 'Fixture text.',
    why: 'Fixture cause.',
    done: ['Fixture done'],
    next: ['Fixture next'],
    simulated: true,
  },
  environment: [],
  plants: [],
  missions: [],
  origin: 'SIMULATED',
  actions: {
    sign: ok,
    acknowledge: { allowed: false, reason: 'The outgoing supervisor must sign first.' },
  },
};

/** Fake Brain that records calls and applies the sign → acknowledge order. */
function platformWith(calls: ApiRequest[]): Platform {
  const p = fakePlatform();
  let h = base;
  p.api = async <T,>(req: ApiRequest): Promise<T> => {
    calls.push(req);
    if (req.path === '/handover/current/sign') {
      h = {
        ...h,
        signed: { by: 'Test User', at: '14:20' },
        actions: { sign: { allowed: false, reason: 'Already signed.' }, acknowledge: ok },
      };
      return { item: h, message: 'Handover signed.' } as T;
    }
    throw new Error(`unexpected ${req.path}`);
  };
  return p;
}

describe('Shift handover', () => {
  it('signs through the Brain and shows the recorded signature', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<HandoverHeader h={base} />, { platform: platformWith(calls) });
    await userEvent.click(screen.getByRole('button', { name: /sign & hand over/i }));
    await waitFor(() => expect(calls.map((c) => c.path)).toEqual(['/handover/current/sign']));
    await waitFor(() => expect(useToast.getState().toast?.msg).toBe('Handover signed.'));
  });

  it('shows the Brain reason when acknowledging before the signature', () => {
    renderWithProviders(<HandoverHeader h={base} />, { platform: platformWith([]) });
    expect(screen.getByRole('button', { name: /incoming: acknowledge/i })).toHaveAttribute(
      'title',
      'The outgoing supervisor must sign first.',
    );
  });

  it('labels a fixture summary as simulated and withholds it when AI is stopped', () => {
    const { unmount } = renderWithProviders(<ShiftSummaryCard s={base.summary} />);
    expect(screen.getByText(/simulated · review before signing/i)).toBeInTheDocument();
    expect(screen.queryByText(/ai-generated/i)).not.toBeInTheDocument();
    unmount();
    renderWithProviders(
      <ShiftSummaryCard
        s={{ ...base.summary, state: 'disabled', happened: null, why: null, done: [], next: [] }}
      />,
    );
    expect(screen.getByText(/lefi ai is stopped/i)).toBeInTheDocument();
    expect(screen.queryByText('Fixture text.')).not.toBeInTheDocument();
  });
});
