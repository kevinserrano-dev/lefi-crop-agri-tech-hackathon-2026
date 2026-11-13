import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Camera } from '@lefi/api';
import type { Platform } from '@lefi/platform';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { AnalysisBox } from './AnalysisBox';
import { ZoneViewsPanel } from './ZoneViewsPanel';

const camera = {
  id: 'cam-01',
  name: 'Bench camera',
  model_id: 'obsbot-tiny-2-lite',
  model_name: 'OBSBOT Tiny 2 Lite',
  vendor_id: '3564',
  product_id: 'fef9',
  serial: null,
  zone_ids: ['z1'],
  zone_id: 'z1',
  status: 'ACTIVE',
  origin: 'LIVE',
  connection: 'connected',
  connected_at: null,
  usb_location: '0x02100000',
  created_at: '2026-11-11T10:00:00Z',
  last_seen_at: '2026-11-11T10:00:00Z',
  retired_at: null,
  controls: true,
  ai_control: false,
  ai_vision: false,
} as Camera;

const zones = [
  { id: 'z1', name: 'Zone A' },
  { id: 'z2', name: 'Zone B' },
];

const view = {
  camera_id: 'cam-01',
  zone_id: 'z1',
  method: 'manual',
  pan: 40,
  tilt: -10,
  zoom: 25,
  every_minutes: 60,
  next_scan_at: '2026-11-11T11:00:00Z',
  last_scan_at: '2026-11-11T10:00:00Z',
  last_scan_outcome: 'done',
  last_scan_error: null,
  marker_seen: false,
};

const calibration = {
  camera_id: 'cam-01',
  state: 'done',
  step: 36,
  total: 36,
  started_by: 'ana',
  started_at: '2026-11-11T10:00:00Z',
  finished_at: '2026-11-11T10:02:00Z',
  error: null,
  found: [{ zone_id: 'z2', pan: -78, tilt: -18, zoom: 0, x: 0.4, y: 0.4, w: 0.2, h: 0.2 }],
  unknown: ['https://example.com/fake'],
};

function platform(routes: Record<string, unknown>) {
  const base = fakePlatform(routes);
  const sent: { method: string; path: string; body?: unknown }[] = [];
  const p = {
    ...base,
    api: async <T,>(req: { method: string; path: string; body?: unknown }): Promise<T> => {
      if (req.method !== 'GET') {
        sent.push(req);
        return (Array.isArray(req.body) ? req.body : {}) as T;
      }
      return base.api<T>(req as never);
    },
  } as Platform;
  return { p, sent };
}

describe('Zone views, calibration and Lefi AI on photos (ADR-088)', () => {
  it('lists the views, reviews a calibration and saves found and kept views', async () => {
    const { p, sent } = platform({
      '/cameras/cam-01/views': [view],
      '/cameras/cam-01/calibration': calibration,
      '/vision/status': {
        available: false,
        reason: 'fake-model does not accept images',
        model: 'fake-model',
        alert_min_confidence: 0.6,
      },
    });
    renderWithProviders(
      <ZoneViewsPanel camera={camera} canManage zones={zones} now="2026-11-11T10:05:00Z" />,
      { platform: p, session: session(['nav.devices', 'device.manage']) },
    );
    const table = await screen.findByRole('table', { name: 'Zone views' });
    expect(within(table).getByText('Zone A')).toBeInTheDocument();
    expect(within(table).getByText('pan 40° · tilt -10° · zoom 25')).toBeInTheDocument();
    expect(within(table).getByText('Marker not seen')).toBeInTheDocument();
    expect(await screen.findByText(/1 zone found/)).toBeInTheDocument();
    expect(screen.getByText(/1 other QR code seen/)).toBeInTheDocument();
    expect(await screen.findByText(/fake-model does not accept images/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Save these views/ }));
    await waitFor(() => expect(sent.find((r) => r.method === 'PUT')).toBeDefined());
    expect(sent.find((r) => r.method === 'PUT')).toMatchObject({
      path: '/cameras/cam-01/views',
      body: [
        { zone_id: 'z2', method: 'marker', pan: -78, tilt: -18, every_minutes: 60 },
        { zone_id: 'z1', method: 'manual', pan: 40, tilt: -10, every_minutes: 60 },
      ],
    });
  });

  it('shows calibration progress and can stop it', async () => {
    const { p, sent } = platform({
      '/cameras/cam-01/views': [],
      '/cameras/cam-01/calibration': { ...calibration, state: 'running', step: 9, found: [] },
      '/vision/status': { available: true, reason: 'ok', model: 'm', alert_min_confidence: 0.6 },
    });
    renderWithProviders(<ZoneViewsPanel camera={camera} canManage zones={zones} />, {
      platform: p,
      session: session(['nav.devices', 'device.manage']),
    });
    expect(await screen.findByText(/position 9 of 36/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Calibrate with zone markers/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }));
    await waitFor(() =>
      expect(sent).toContainEqual({ method: 'DELETE', path: '/cameras/cam-01/calibration' }),
    );
  });

  it('labels what Lefi AI saw as to be confirmed, and a person can say it was wrong', async () => {
    const analysis = {
      id: 'a1',
      photo_id: 'ph-1',
      camera_id: 'cam-01',
      zone_ids: ['z1'],
      status: 'done',
      requested_by: 'Lefi Brain (schedule)',
      requested_at: '2026-11-11T10:00:00Z',
      finished_at: '2026-11-11T10:00:20Z',
      origin: 'LIVE',
      model: 'fake-model',
      prompt_version: 'zone-photo-v1',
      report: {
        image_usable: true,
        plants_visible: true,
        summary: 'fake summary',
        findings: [
          {
            kind: 'leaf_spots',
            label: 'spots on leaves',
            severity: 'medium',
            confidence: 0.82,
            description: 'fake brown spots, left',
          },
        ],
      },
      error: null,
      alerts: ['leaf_spots'],
      verdict: null,
      verdict_by: null,
      verdict_at: null,
      by_ai: true,
    };
    const { p, sent } = platform({ '/photo-analyses': [analysis] });
    renderWithProviders(<AnalysisBox photoId="ph-1" />, {
      platform: p,
      session: session(['nav.devices']),
    });
    expect(await screen.findByText('Lefi AI · to confirm')).toBeInTheDocument();
    expect(screen.getByText('spots on leaves')).toBeInTheDocument();
    expect(screen.getByText(/82 % sure · alert raised to confirm/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Wrong/ }));
    await waitFor(() =>
      expect(sent).toContainEqual({
        method: 'POST',
        path: '/photo-analyses/a1/verdict',
        body: { verdict: 'wrong' },
      }),
    );
  });
});
