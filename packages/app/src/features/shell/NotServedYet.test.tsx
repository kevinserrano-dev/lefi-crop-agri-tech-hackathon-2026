import { screen } from '@testing-library/react';
import { screens } from '../../app/screens';
import { fakePlatform, renderWithProviders } from '../../test/render';
import { NotServedYet } from './NotServedYet';

const real = { status: 'ok', service: 'lefi-brain', version: '0.2.0', time: 'x' };
// Every designed screen is served by the real Lefi Brain now (robots, tasks, handover, escalation
// included): a screen whose endpoint Lefi Brain does not answer stands in for a future one.
const handover = screens.find((s) => s.id === 'handover')!;
const future = {
  ...handover,
  title: 'Future Screen',
  brain: { endpoint: '/not-served-yet', module: 'a planned module' },
  live: undefined,
};

describe('screens the real Lefi Brain does not serve yet', () => {
  it('say so plainly against the real Lefi Brain, and show nothing else', async () => {
    renderWithProviders(
      <NotServedYet screen={future}>
        <p>sample data</p>
      </NotServedYet>,
      { platform: fakePlatform({ '/health': real }) },
    );
    expect(await screen.findByText('Future Screen is not available yet')).toBeInTheDocument();
    expect(screen.getByText(/a planned module/)).toBeInTheDocument();
    expect(screen.queryByText('sample data')).not.toBeInTheDocument();
  });

  it('render as before against the development mock (labelled sample data)', async () => {
    renderWithProviders(
      <NotServedYet screen={future}>
        <p>sample data</p>
      </NotServedYet>,
      { platform: fakePlatform({ '/health': { ...real, mock: true } }) },
    );
    expect(await screen.findByText('sample data')).toBeInTheDocument();
  });

  it('every screen names its endpoint and module', () => {
    expect(screens).toHaveLength(15); // the 14 designed screens + AI Knowledge Center (ADR-086)
    for (const s of screens) {
      expect(s.brain.endpoint.startsWith('/')).toBe(true);
      expect(s.brain.module.length).toBeGreaterThan(3);
    }
  });
});
