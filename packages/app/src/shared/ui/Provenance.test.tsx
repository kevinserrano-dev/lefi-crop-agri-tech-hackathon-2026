import { render, screen } from '@testing-library/react';
import { ProvenanceBadge } from './Provenance';

describe('ProvenanceBadge (ADR-012)', () => {
  it('labels simulated data as SIMULATED', () => {
    render(<ProvenanceBadge origin="SIMULATED" />);
    expect(screen.getByText('SIMULATED')).toBeInTheDocument();
  });

  it('never shows stale simulated data as live', () => {
    render(<ProvenanceBadge origin="SIMULATED" freshness="STALE" />);
    expect(screen.getByText('SIM · STALE')).toBeInTheDocument();
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
  });
});
