import { render, screen } from '@testing-library/react';
import type { Reading } from '@lefi/api';
import { IrrigationTile, SensorCard } from './SensorCard';

const reading: Reading = {
  sensor_id: 'TEMP-GH1-Z2-01',
  variable: 'temp',
  label: 'Air temperature',
  unit: '°C',
  value: 21.8,
  decimals: 1,
  origin: 'SIMULATED',
  source: 'sensor',
  freshness: 'LIVE',
  received_at: '2026-11-05T09:42:00Z',
  status: 'HEALTHY',
  range: { min: 18, max: 24, is_placeholder: true },
  history: [21, 21.5, 21.8],
};

describe('SensorCard', () => {
  it('shows value, range, health and provenance', () => {
    render(<SensorCard reading={reading} stale={false} />);
    expect(screen.getByText('21.8')).toBeInTheDocument();
    expect(screen.getByText('18–24 °C')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('SIMULATED')).toBeInTheDocument();
  });

  it('reports "No data" health when the Brain is unreachable (ADR-012)', () => {
    render(<SensorCard reading={reading} stale />);
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    expect(screen.getByText('SIM · STALE')).toBeInTheDocument();
  });
});

describe('IrrigationTile', () => {
  it('is locked: disabled by design, no control', () => {
    render(<IrrigationTile reason="disabled by design" />);
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
