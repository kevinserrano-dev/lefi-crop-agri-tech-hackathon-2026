import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { Camera, ZoneItem } from '@lefi/api';
import type { Platform } from '@lefi/platform';
import { fakePlatform, renderWithProviders, session } from '../../../test/render';
import { ZoneCameras } from './ZoneCameras';

const zone = { id: 'z1', greenhouse_id: 'g1', name: 'Zone A' } as ZoneItem;

const cam = (id: string, name: string, extra: Partial<Camera> = {}): Camera =>
  ({
    id,
    name,
    model_id: 'usb-video',
    model_name: 'USB camera (video only)',
    vendor_id: '1111',
    product_id: '2222',
    serial: null,
    zone_ids: ['z1', 'z2'],
    zone_id: 'z1',
    status: 'ACTIVE',
    origin: 'LIVE',
    connection: 'connected',
    connected_at: null,
    usb_location: '0x03000000',
    created_at: '2026-11-11T10:00:00Z',
    last_seen_at: '2026-11-11T10:00:00Z',
    retired_at: null,
    controls: false,
    ai_control: false,
    ...extra,
  }) as Camera;

const photo = {
  id: 'ph-1',
  camera_id: 'cam-01',
  taken_at: '2026-11-11T09:30:00Z',
  taken_by: 'ana',
  by_ai: false,
  width: 1920,
  height: 1080,
  size: 10,
  origin: 'LIVE',
  pan: null,
  tilt: null,
  zoom: null,
  note: null,
  zone_ids: ['z1'],
};

function platform(): Platform & { calls: string[] } {
  const base = fakePlatform({
    '/cameras': [
      cam('cam-01', 'Bench camera'),
      cam('cam-02', 'Other zone camera', { zone_ids: ['z2'], zone_id: 'z2' }),
      cam('cam-03', 'Retired camera', { status: 'RETIRED' }),
    ],
    '/camera-photos': [photo],
    '/camera-views': [
      {
        camera_id: 'cam-01',
        zone_id: 'z1',
        method: 'fixed',
        pan: null,
        tilt: null,
        zoom: null,
        every_minutes: 120,
        next_scan_at: '2026-11-11T12:00:00Z',
        last_scan_at: '2026-11-11T10:00:00Z',
        last_scan_outcome: 'done',
        last_scan_error: null,
        marker_seen: true,
      },
    ],
    '/photo-analyses': [
      {
        id: 'a1',
        photo_id: 'ph-1',
        status: 'done',
        report: { image_usable: true, plants_visible: true, summary: 'x', findings: [{}, {}] },
        alerts: ['leaf_spots'],
      },
    ],
    '/camera-photos/ph-1': { ...photo, jpeg_base64: 'AAAA' },
    '/cameras/cam-01/frame': {
      camera_id: 'cam-01',
      jpeg_base64: 'AAAA',
      width: 640,
      height: 360,
      captured_at: '2026-11-11T10:00:00Z',
      origin: 'LIVE',
    },
  });
  const calls: string[] = [];
  return {
    ...base,
    calls,
    api: async <T,>(req: { method: string; path: string; query?: unknown }): Promise<T> => {
      calls.push(`${req.method} ${req.path} ${JSON.stringify(req.query ?? {})}`);
      return base.api<T>(req as never);
    },
  };
}

describe('Visual monitoring of a zone (ADR-087)', () => {
  it('lists only the active cameras looking at the zone and the photos taken for it', async () => {
    const p = platform();
    renderWithProviders(<ZoneCameras zone={zone} now="2026-11-11T10:00:10Z" />, {
      platform: p,
      session: session(['nav.devices']),
    });
    expect(await screen.findByText('Bench camera')).toBeInTheDocument();
    expect(screen.queryByText('Other zone camera')).not.toBeInTheDocument();
    expect(screen.queryByText('Retired camera')).not.toBeInTheDocument();
    expect(screen.getByText(/looks at 2 zones/)).toBeInTheDocument();
    expect(await screen.findByText(/Bench camera ·/)).toBeInTheDocument(); // photo caption
    expect(p.calls).toContain('GET /camera-photos {"zone_id":"z1","limit":24}');
    expect(await screen.findByText(/Every 2 h · next/)).toBeInTheDocument(); // its schedule
    expect(await screen.findByText('Lefi AI: 2 possible problems')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Print zone marker/ })).toBeInTheDocument();
  });

  it('opens live video below the list and scrolls the page to it', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderWithProviders(<ZoneCameras zone={zone} now="2026-11-11T10:00:10Z" />, {
      platform: platform(),
      session: session(['nav.devices']),
    });
    fireEvent.click(await screen.findByRole('button', { name: /Watch live/ }));
    expect(await screen.findByRole('button', { name: 'Close camera' })).toBeInTheDocument();
    await waitFor(() =>
      expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' }),
    );
    // inside a zone: no AI switch and no command history
    expect(screen.queryByText('Lefi AI may use this camera')).not.toBeInTheDocument();
    expect(screen.queryByText('Commands sent')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Close live/ }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Close camera' })).not.toBeInTheDocument(),
    );
  });

  it('shows nothing to people without Devices & Health', () => {
    const p = platform();
    const { container } = renderWithProviders(<ZoneCameras zone={zone} now={undefined} />, {
      platform: p,
      session: session(['nav.greenhouses']),
    });
    expect(container).toBeEmptyDOMElement();
    expect(p.calls).toEqual([]);
  });
});
