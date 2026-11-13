import { render, screen } from '@testing-library/react';
import { LefiSummaryCard } from './LefiSummaryCard';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => () => undefined }));

const ai = {
  state: 'available' as const,
  kill_switch: false,
  halt_scope: null,
  model: null,
  reason: null,
};
const summary = {
  state: 'available' as const,
  text: 'Health is **stable**.',
  generated_at: '2026-11-05T09:40:00Z',
  basis: null,
};

describe('LefiSummaryCard', () => {
  it('tags fixture text as SIMULATED, never AI-generated', () => {
    render(<LefiSummaryCard summary={{ ...summary, simulated: true }} ai={ai} />);
    expect(screen.getByText(/Simulated ·/)).toBeInTheDocument();
    expect(screen.queryByText(/AI-generated/)).not.toBeInTheDocument();
    expect(screen.getByText('stable').tagName).toBe('B');
  });

  it('degrades visibly when AI is unavailable instead of inventing a summary', () => {
    render(
      <LefiSummaryCard
        summary={{
          state: 'unavailable',
          text: null,
          generated_at: null,
          basis: null,
          simulated: false,
        }}
        ai={{ ...ai, state: 'unavailable', reason: 'Ollama not reachable.' }}
      />,
    );
    expect(
      screen.getByText(/AI reasoning unavailable — Ollama not reachable\./),
    ).toBeInTheDocument();
  });

  it('hides AI text when STOP AI / kill switch is on', () => {
    render(
      <LefiSummaryCard
        summary={{ ...summary, simulated: false }}
        ai={{ ...ai, kill_switch: true, halt_scope: 'ai' }}
      />,
    );
    expect(screen.queryByText(/stable/)).not.toBeInTheDocument();
    expect(screen.getByText(/Lefi AI is stopped/)).toBeInTheDocument();
  });
});
