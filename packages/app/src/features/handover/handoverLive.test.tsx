import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiRequest, Platform } from '@lefi/platform';
import type { HandoverView } from '@lefi/api';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { HandoverLive } from './HandoverLive';

const slot = (name: string, who: string, role: string, start: string, end: string) => ({
  shift_type_id: name,
  name,
  day: '2026-11-12',
  start,
  end,
  people: [{ id: who, name: who, role, lead: true }],
});

const view = (over: Partial<HandoverView> = {}): HandoverView => ({
  brain_time: '2026-11-12T13:00:00Z',
  state: 'ready',
  reason: null,
  outgoing: slot(
    'Day',
    'Marcus Okafor',
    'supervisor',
    '2026-11-12T06:00:00Z',
    '2026-11-12T14:30:00Z',
  ),
  incoming: slot(
    'Evening',
    'Owen MacLeod',
    'manager',
    '2026-11-12T14:00:00Z',
    '2026-11-12T22:30:00Z',
  ),
  handover: {
    id: 'h1',
    shift: 'Day',
    day: '2026-11-12',
    start: '2026-11-12T06:00:00Z',
    end: '2026-11-12T14:30:00Z',
    status: 'open',
    refreshed_at: '2026-11-12T13:00:00Z',
    environment: [
      {
        zone: 'Zona B',
        measurement: 'Air temperature',
        unit: '°C',
        first: 21,
        last: 23.6,
        avg: 22.4,
        min: 20.1,
        max: 23.6,
        readings: 100,
        state: 'in range',
        range: [18, 26],
        crop: 'Spinach',
        origin: 'LIVE',
      },
    ],
    plant_health: { records: 0, by_state: {}, issues: {} },
    incidents_opened: [],
    incidents_resolved: [],
    incidents_active: [
      {
        number: 'INC-0003',
        title: 'ESP32-01 is not in contact',
        severity: 'critical',
        status: 'open',
        source: 'rule',
      },
    ],
    tasks_done: [],
    tasks_outstanding: { count: 0, items: [] },
    robot_missions: 'No robot is connected to Lefi Brain yet (test).',
    summary: {
      status: 'done',
      happened: 'A steady day shift.',
      why: 'The ESP32 lost power.',
      done: ['Probe replacement scheduled'],
      attention: ['Check ESP32-01'],
      model: 'test-model',
      error: null,
      at: '2026-11-12T13:00:00Z',
    },
    signed_by: null,
    signed_at: null,
    sign_note: null,
    acknowledged_by: null,
    acknowledged_at: null,
    ack_note: null,
    origins: ['LIVE'],
  },
  can_sign: true,
  can_acknowledge: true,
  ...over,
});

function brain(calls: ApiRequest[], v: HandoverView): Platform {
  const p = fakePlatform();
  p.api = async <T,>(req: ApiRequest): Promise<T> => {
    calls.push(req);
    if (req.path === '/handover/current') return v as T;
    if (req.method === 'POST') return v.handover as T;
    throw new Error(`unexpected ${req.method} ${req.path}`);
  };
  return p;
}

describe('Shift Handover against the real Lefi Brain (ADR-095)', () => {
  it('shows outgoing → incoming, Lefi’s summary to review, the facts, and signs', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<HandoverLive />, {
      platform: brain(calls, view()),
      session: session(['nav.handover', 'handover.sign', 'handover.ack']),
    });
    expect(await screen.findByText('Marcus Okafor')).toBeInTheDocument();
    expect(screen.getByText('Owen MacLeod')).toBeInTheDocument();
    expect(screen.getByText(/AI-generated · review before signing/)).toBeInTheDocument();
    expect(screen.getByText('A steady day shift.')).toBeInTheDocument();
    expect(screen.getByText(/21 → 23.6 °C · in range/)).toBeInTheDocument();
    expect(screen.getByText('INC-0003')).toBeInTheDocument();
    expect(screen.getByText(/No robot is connected/)).toBeInTheDocument();
    // Acknowledging waits for the signature.
    expect(screen.getByRole('button', { name: /incoming: acknowledge/i })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /sign & hand over/i }));
    await userEvent.type(screen.getByLabelText('Note'), 'All quiet');
    await userEvent.click(screen.getAllByRole('button', { name: /sign & hand over/i }).at(-1)!);
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/handovers/h1/sign')?.body).toEqual({
        note: 'All quiet',
      }),
    );
  });

  it('says what to do when no shift was worked', async () => {
    renderWithProviders(<HandoverLive />, {
      platform: brain(
        [],
        view({
          state: 'no_shifts',
          reason: 'Define shifts in Workforce → Shifts.',
          outgoing: null,
          incoming: null,
          handover: null,
        }),
      ),
      session: session(['nav.handover']),
    });
    expect(await screen.findByText('No shift to hand over yet')).toBeInTheDocument();
    expect(screen.getByText(/Workforce → Shifts/)).toBeInTheDocument();
  });
});
