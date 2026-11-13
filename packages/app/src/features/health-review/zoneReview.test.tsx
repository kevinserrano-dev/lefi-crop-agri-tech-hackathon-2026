import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import type { HealthReview } from '@lefi/api';
import { renderWithProviders } from '../../test/render';
import { ZoneReview } from './ZoneReview';

const review = (over: Partial<HealthReview> = {}): HealthReview => ({
  id: 'r1',
  zone_id: 'z1',
  zone: 'Fake zone',
  status: 'attention',
  created_at: '2026-11-11T10:00:00Z',
  trigger: 'schedule',
  requested_by: 'Lefi Brain (schedule)',
  origins: ['SIMULATED'],
  points: [{ level: 'attention', text: 'Air temperature 28 °C: above the warning limit (test).' }],
  recommendations: ['Air temperature 28 °C is out of range for Fake lettuce: check ventilation.'],
  crops: [{ crop: 'Fake lettuce', stage: null, plants: 3, profile: 'Fake profile v1' }],
  measurements: [
    {
      measurement: 'air_temperature',
      label: 'Air temperature',
      unit: '°C',
      crop: 'Fake lettuce',
      profile: 'Fake profile v1',
      verification: 'illustrative',
      band: 'warning',
      value: 28,
      side: 'high',
      sensors: 1,
      optimal: [16, 22],
      warning: [14, 26],
      critical: [null, null],
    },
  ],
  camera: {
    cameras: 1,
    scheduled: true,
    ai_on: true,
    last_scan_at: '2026-11-11T09:55:00Z',
    last_scan_outcome: 'done',
    next_scan_at: '2026-11-11T10:25:00Z',
    last_photo_id: 'p1',
    last_analysis_at: '2026-11-11T09:56:00Z',
    analysis_status: 'done',
    analysis_error: null,
    image_usable: true,
    plants_visible: true,
    summary: 'Test',
    model: 'fake-model',
    findings: [
      {
        kind: 'leaf_yellowing',
        label: 'yellowing leaves',
        severity: 'medium',
        confidence: 0.7,
        description: 'Left side (test)',
      },
    ],
  },
  alerts: [],
  people: { plants: 3, healthy: 0, watch: 0, problem: 0, not_checked: 3 },
  ai: {
    status: 'unavailable',
    summary: null,
    recommendations: [],
    model: null,
    error: 'AI off (test)',
    at: null,
  },
  ...over,
});

describe('Zone health review', () => {
  it('shows sensors against the crop, the camera monitoring and labels Lefi AI’s part', () => {
    renderWithProviders(<ZoneReview review={review()} now="2026-11-11T10:00:00Z" />);
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('Out of range')).toBeInTheDocument();
    expect(screen.getByText('16–22 °C')).toBeInTheDocument();
    expect(
      screen.getByText(/Photographed 5 min ago · Lefi AI looked 4 min ago/),
    ).toBeInTheDocument();
    expect(screen.getByText(/to confirm/)).toBeInTheDocument();
    expect(
      screen.getByText(/Lefi AI’s summary is not available: AI off \(test\)/),
    ).toBeInTheDocument();
  });

  it('shows Lefi AI’s summary with its model only when it fits', () => {
    renderWithProviders(
      <ZoneReview
        review={review({
          ai: {
            status: 'done',
            summary: 'Warm zone (test).',
            recommendations: ['Ventilate (test).'],
            model: 'fake-model',
            error: null,
            at: '2026-11-11T10:01:00Z',
          },
        })}
      />,
    );
    expect(screen.getByText('Warm zone (test).')).toBeInTheDocument();
    expect(screen.getByText(/Lefi AI · fake-model/)).toBeInTheDocument();
  });
});
