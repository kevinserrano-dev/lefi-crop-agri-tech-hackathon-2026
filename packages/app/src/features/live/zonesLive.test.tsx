import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ApiRequest, Platform } from '@lefi/platform';
import { screens } from '../../app/screens';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { NotServedYet } from '../shell/NotServedYet';
import { suggestLocationCode, suggestZoneCode, zoneSummaryText } from './places';
import { ZonesLive } from './ZonesLive';

const zone = {
  id: 'z1',
  greenhouse_id: 'g1',
  name: 'Green1',
  code: null,
  purpose: null,
  purpose_other: null,
  growing_systems: [],
  notes: null,
  area_m2: null,
  physical_ref: null,
  climate_control: 'not_configured',
  status: 'active',
  created_at: 'x',
  summary: { locations_by_kind: { bench: 1, tray: 1, bucket: 1 }, plants: 18, active_crops: 1 },
};

const location = (over: Record<string, unknown>) => ({
  zone_id: 'z1',
  name: null,
  parent_id: null,
  row: null,
  position: null,
  level: null,
  spot: null,
  capacity: null,
  capacity_unit: null,
  status: 'active',
  notes: null,
  subtype: null,
  custom_kind: null,
  volume_l: null,
  length_m: null,
  width_m: null,
  created_at: 'x',
  summary: {
    plants: 0,
    plants_total: 0,
    crop_type_ids: [],
    children: 0,
    occupied_positions: null,
    filled: null,
    occupancy: 'empty',
  },
  ...over,
});

const routes: Record<string, unknown> = {
  '/health': { status: 'ok', service: 'lefi-brain', version: '0.5.0', time: 'x' },
  '/greenhouses': [{ id: 'g1', name: 'Test greenhouse', created_at: 'x' }],
  '/zones': [zone],
  '/containers': [
    // A bucket from before ADR-066: no name, so its code is shown.
    location({ id: 'c1', code: 'B-300', kind: 'bucket', row: 'A', position: 300, spot: 'A-300' }),
    location({
      id: 'c2',
      code: 'BEN-01',
      name: 'Bench 01',
      kind: 'bench',
      summary: {
        plants: 0,
        plants_total: 18,
        crop_type_ids: [],
        children: 1,
        occupied_positions: null,
        filled: null,
        occupancy: null,
      },
    }),
    location({
      id: 'c3',
      code: 'TR-01',
      name: 'Tray 01',
      kind: 'tray',
      subtype: 'plug',
      parent_id: 'c2',
      capacity: 24,
      capacity_unit: 'planting_positions',
      summary: {
        plants: 18,
        plants_total: 18,
        crop_type_ids: ['t1'],
        children: 0,
        occupied_positions: null,
        filled: null,
        occupancy: null,
      },
    }),
  ],
  '/crop-types': [{ id: 't1', name: 'Fake lettuce', variety: null, is_placeholder: true }],
  '/crop-assignments': [
    {
      id: 'a1',
      location_id: 'c3',
      zone_id: 'z1',
      crop_type_id: 't1',
      variety: null,
      batch_code: 'B-1',
      plant_quantity: 18,
      occupied_positions: null,
      started_on: '2026-11-01',
      start_event: 'sowing',
      growth_stage: null,
      expected_harvest_on: null,
      notes: null,
      status: 'active',
      ended_on: null,
      end_reason: null,
      created_at: 'x',
    },
  ],
  '/plants': [],
  '/inventory-items': [
    {
      id: 'i1',
      zone_id: 'z1',
      name: 'Fake substrate',
      category: 'supply',
      quantity: 2,
      unit: 'bags',
      min_quantity: 5,
      low: true,
      notes: null,
      created_at: 'x',
      updated_at: 'x',
    },
  ],
  '/field-devices': [
    {
      id: 'sim-esp32-01',
      name: 'Test node',
      zone_id: null,
      zone_ids: [],
      status: 'ACTIVE',
      origin: 'SIMULATED',
      connection: 'online',
    },
  ],
};

function platform(calls: ApiRequest[]): Platform {
  const base = fakePlatform(routes);
  return {
    ...base,
    api: async <T,>(req: ApiRequest): Promise<T> => {
      calls.push(req);
      if (req.method === 'PATCH' && req.path === '/field-devices/sim-esp32-01')
        return { ...(routes['/field-devices'] as object[])[0], zone_ids: ['z1'] } as T;
      if (req.method === 'POST' && req.path === '/zones')
        return { ...zone, ...(req.body as object), id: 'z2' } as T;
      if (req.method === 'POST' && req.path === '/containers')
        return location({ id: 'c9', ...(req.body as object) }) as T;
      return base.api<T>(req);
    },
  };
}

const all = ['nav.zones', 'zone.manage', 'nav.devices', 'device.manage', 'batch.edit'];

describe('Zones & Inventory against the real Lefi Brain', () => {
  it('replaces "not available yet" with the live screen', async () => {
    const zones = screens.find((s) => s.id === 'zones')!;
    renderWithProviders(
      <NotServedYet screen={zones}>
        <p>sample data</p>
      </NotServedYet>,
      { platform: platform([]), session: session(['nav.zones']) },
    );
    expect(await screen.findByText('Growing locations')).toBeInTheDocument();
    expect(screen.queryByText(/not available yet/)).not.toBeInTheDocument();
  });

  it('shows an old zone as not configured, the location tree and counts without guessing', async () => {
    renderWithProviders(<ZonesLive />, { platform: platform([]), session: session(all) });
    const table = await screen.findByRole('table', { name: 'Growing locations in Green1' });
    // The old bucket opens with its code as its name and keeps its row and position.
    expect(within(table).getAllByText('B-300').length).toBeGreaterThan(0);
    expect(within(table).getByText('row A · pos. 300')).toBeInTheDocument();
    // 18 plants in a 24-position tray, positions not recorded: no "18/24 occupied".
    expect(within(table).getByText('18 plants · 24 positions')).toBeInTheDocument();
    expect(within(table).queryByText(/18\/24/)).not.toBeInTheDocument();
    expect(within(table).getByText('18 plants incl. sub-locations')).toBeInTheDocument();
    expect(await within(table).findByText('Fake lettuce')).toBeInTheDocument();
    // Collapsing the bench hides its tray.
    fireEvent.click(within(table).getByRole('button', { name: 'Collapse Bench 01' }));
    expect(within(table).queryByText('Tray 01')).not.toBeInTheDocument();
    expect(screen.getAllByText('1 bench · 1 bucket · 1 tray · 18 plants').length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText('Not configured').length).toBeGreaterThan(0);
    expect(screen.getByText('Fake substrate')).toBeInTheDocument();
    expect(screen.getByText('1 low')).toBeInTheDocument();
  });

  it('adds a zone through its form, with a suggested editable code', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<ZonesLive />, { platform: platform(calls), session: session(all) });
    fireEvent.click(await screen.findByRole('button', { name: 'Add zone' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add zone' });
    const create = within(dialog).getByRole('button', { name: 'Create zone' });
    fireEvent.change(within(dialog).getByLabelText('Zone name'), {
      target: { value: 'Propagation North' },
    });
    expect(within(dialog).getByLabelText('Zone code (unique in the greenhouse)')).toHaveValue('PN');
    expect(create).toBeDisabled(); // purpose is required
    fireEvent.change(within(dialog).getByLabelText('Purpose (main use)'), {
      target: { value: 'propagation' },
    });
    fireEvent.click(within(dialog).getByLabelText('NFT'));
    fireEvent.click(within(dialog).getByLabelText('Not configured yet'));
    expect(within(dialog).getByLabelText('NFT')).not.toBeChecked(); // exclusive
    fireEvent.click(within(dialog).getByLabelText('DWC / Floating rafts'));
    expect(within(dialog).getByLabelText('Not configured yet')).not.toBeChecked();
    fireEvent.change(within(dialog).getByLabelText('Area (m²)'), { target: { value: '0' } });
    expect(create).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Area (m²)'), { target: { value: '42.5' } });
    fireEvent.click(create);
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'POST',
          path: '/zones',
          body: expect.objectContaining({
            greenhouse_id: 'g1',
            name: 'Propagation North',
            code: 'PN',
            purpose: 'propagation',
            growing_systems: ['dwc'],
            area_m2: 42.5,
            climate_control: 'not_configured',
            status: 'active',
          }),
        }),
      ),
    );
  });

  it('adds a sub-location inside a bench, with its cells as its only capacity', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<ZonesLive />, { platform: platform(calls), session: session(all) });
    const table = await screen.findByRole('table', { name: 'Growing locations in Green1' });
    const benchRow = within(table).getByText('Bench 01').closest('[role="row"]')!;
    fireEvent.click(within(benchRow as HTMLElement).getByRole('button', { name: 'Details' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add sub-location' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add growing location to Green1' });
    expect(within(dialog).getByLabelText('Zone')).toHaveAttribute('readonly');
    fireEvent.change(within(dialog).getByLabelText('Type'), { target: { value: 'tray' } });
    fireEvent.change(within(dialog).getByLabelText('Tray type (optional)'), {
      target: { value: 'plug' },
    });
    // A plug tray's cells are its capacity: no second, contradictory capacity field.
    expect(within(dialog).queryByLabelText('Capacity (optional)')).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Cells (optional)'), {
      target: { value: '128' },
    });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Tray 02' } });
    fireEvent.change(within(dialog).getByLabelText('Position (optional)'), {
      target: { value: '2' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add growing location' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'POST',
          path: '/containers',
          body: expect.objectContaining({
            zone_id: 'z1',
            name: 'Tray 02',
            code: 'TRA-02',
            kind: 'tray',
            subtype: 'plug',
            parent_id: 'c2',
            position: 2,
            capacity: 128,
            capacity_unit: 'planting_positions',
            volume_l: null,
          }),
        }),
      ),
    );
  });

  it('adds a device to the zone it serves (ADR-083)', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<ZonesLive />, { platform: platform(calls), session: session(all) });
    const devices = (await screen.findByText('Devices in this zone')).closest('section')!;
    await within(devices).findByRole('option', { name: /Test node/ });
    fireEvent.click(within(devices).getByRole('button', { name: 'Add to this zone' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'PATCH',
          path: '/field-devices/sim-esp32-01',
          body: { zone_ids: ['z1'] },
        }),
      ),
    );
  });

  it('a reader without zone.manage or device rights sees no controls', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<ZonesLive />, {
      platform: platform(calls),
      session: session(['nav.zones']),
    });
    expect(await screen.findByText('Bench 01')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add growing location/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add zone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Assign crop/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add item/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Devices in this zone')).not.toBeInTheDocument();
    expect(calls.map((c) => c.path)).not.toContain('/field-devices');
  });
});

describe('zone and location words', () => {
  it('suggests codes and summarises each location and crop once', () => {
    expect(suggestZoneCode('Zona A')).toBe('ZA');
    expect(suggestZoneCode('Propagation North')).toBe('PN');
    expect(suggestLocationCode('Bench 01')).toBe('BEN-01');
    expect(
      zoneSummaryText({
        locations_by_kind: { bench: 2, tray: 12 },
        plants: 240,
        batch_plants: 240,
        active_crops: 3,
      }),
    ).toBe('2 benches · 12 trays · 240 plants');
  });
});
