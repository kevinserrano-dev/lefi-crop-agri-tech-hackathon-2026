import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Platform } from '@lefi/platform';
import { screens } from '../../app/screens';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { NotServedYet } from '../shell/NotServedYet';
import { FieldDevicesLive } from './FieldDevicesLive';
import { PlantsLive } from './PlantsLive';

const health = {
  status: 'ok',
  service: 'lefi-brain',
  version: '0.3.0',
  time: '2026-11-08T10:00:30Z',
};
const channel = (key: string, label: string, confirmed = true) => ({
  sensor_key: key,
  label,
  model: confirmed ? 'TEST MODEL' : null,
  model_confirmed: confirmed,
  interface: 'i2c',
  pins_verified: false,
  variables: [{ variable: 'air_temperature', label: 'Air temperature', unit: '°C', decimals: 1 }],
  scopes: ['device', 'zone'],
  default_scope: 'device',
});
const sensor = (key: string, label: string, extra: Record<string, unknown> = {}) => ({
  id: `sim-esp32-01:${key}`,
  device_id: 'sim-esp32-01',
  sensor_key: key,
  channel: channel(key, label, key !== 'soil-moisture-1'),
  enabled: false,
  scope: 'device',
  target_id: null,
  target_label: null,
  data_state: 'disabled',
  detected: true,
  last_value_at: null,
  last_error: null,
  last_error_at: null,
  latest: [
    {
      variable: 'air_temperature',
      label: 'Air temperature',
      unit: '°C',
      decimals: 1,
      value: null,
      received_at: null,
    },
  ],
  enabled_at: null,
  ...extra,
});
const device = {
  id: 'sim-esp32-01',
  profile_id: 'lefi-node-esp32.v1',
  name: 'Test node',
  zone_id: null,
  zone_ids: ['z1'],
  status: 'PENDING',
  origin: 'SIMULATED',
  firmware: 'sim-0.1.0',
  created_at: '2026-11-08T09:00:00Z',
  last_seen_at: '2026-11-08T10:00:00Z',
  connection: 'online',
  rssi_dbm: -60,
  network: 'wifi',
  mac: '02:00:00:00:00:01',
  health: { reset_reason: 'watchdog', wifi_reconnects: 4, free_heap: 150000 },
  mqtt_account: false,
  supports_logs: true,
  sensors_enabled: 1,
  sensors_total: 2,
};
const places = {
  '/greenhouses': [{ id: 'g1', name: 'Test greenhouse', created_at: 'x' }],
  '/zones': [{ id: 'z1', greenhouse_id: 'g1', name: 'Zone A', created_at: 'x' }],
  '/containers': [],
  '/crop-types': [{ id: 'c1', name: 'Test lettuce', variety: null, is_placeholder: true }],
};

const detailOf = () => ({
  ...device,
  sensors: [
    sensor('air-1', 'Air temperature and humidity', {
      enabled: true,
      data_state: 'receiving',
      latest: [
        {
          variable: 'air_temperature',
          label: 'Air temperature',
          unit: '°C',
          decimals: 1,
          value: 21.5,
          received_at: '2026-11-08T10:00:20Z',
        },
      ],
    }),
    sensor('soil-moisture-1', 'Soil moisture'),
  ],
  available_sensors: [{ channel: channel('tds-1', 'Water TDS'), detected: null }],
});

function platform(extra: Record<string, unknown> = {}): Platform & { calls: string[] } {
  const routes: Record<string, unknown> = {
    '/health': health,
    '/field-devices': [device],
    '/field-devices/sim-esp32-01': detailOf(),
    '/field-device-enrolments': [],
    '/field-devices/sim-esp32-01/events': [],
    '/node-profiles': [
      {
        id: 'lefi-node-esp32.v1',
        name: 'Test node type',
        network: ['wifi'],
        channels: [channel('air-1', 'Air temperature and humidity')],
      },
    ],
    '/plants': [],
    '/crop-assignments': [],
    '/cameras': [],
    '/cameras/usb': { available: true, reason: null, items: [] },
    '/robots': [],
    ...places,
    ...extra,
  };
  const base = fakePlatform(routes);
  const calls: string[] = [];
  return {
    ...base,
    calls,
    api: async <T,>(req: { method: string; path: string }): Promise<T> => {
      calls.push(`${req.method} ${req.path}`);
      return base.api<T>(req as never);
    },
  };
}

describe('Devices & Health against the real Lefi Brain', () => {
  it('replaces the sample design with the live screen', async () => {
    const devices = screens.find((s) => s.id === 'devices')!;
    renderWithProviders(
      <NotServedYet screen={devices}>
        <p>sample data</p>
      </NotServedYet>,
      { platform: platform(), session: session(['nav.devices']) },
    );
    expect(await screen.findByText('Sensor nodes')).toBeInTheDocument();
    expect(screen.queryByText('sample data')).not.toBeInTheDocument();
  });

  it('shows the node, its provenance, values and what cannot be enabled', async () => {
    renderWithProviders(<FieldDevicesLive />, {
      platform: platform(),
      session: session(['nav.devices', 'device.manage']),
    });
    expect(await screen.findByText('Pending approval', { selector: 'span' })).toBeInTheDocument();
    expect((await screen.findAllByText('SIMULATED')).length).toBeGreaterThan(0);
    expect(await screen.findByText('21.5')).toBeInTheDocument();
    expect(screen.getByText('10 s ago')).toBeInTheDocument(); // Lefi Brain's clock, not this PC's
    const moisture = screen.getByRole('switch', { name: /Soil moisture/ });
    expect(moisture).toHaveAttribute('data-locked', 'true');
    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument();
  });

  it('shows the connection password once, from Lefi Brain', async () => {
    const p = platform({
      '/field-devices/sim-esp32-01/credentials': {
        device_id: 'sim-esp32-01',
        username: 'sim-esp32-01',
        password: 'fake-password-for-test',
        host: 'lefi-main.local',
        port: 1883,
      },
    });
    renderWithProviders(<FieldDevicesLive />, {
      platform: p,
      session: session(['nav.devices', 'device.manage']),
    });
    fireEvent.click(await screen.findByRole('button', { name: /Create password/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('fake-password-for-test')).toBeInTheDocument();
    expect(within(dialog).getByText('lefi-main.local:1883')).toBeInTheDocument();
    expect(p.calls).toContain('POST /field-devices/sim-esp32-01/credentials');
  });

  it('a role without device.manage sees no controls', async () => {
    const p = platform();
    renderWithProviders(<FieldDevicesLive />, {
      platform: p,
      session: session(['nav.devices']),
    });
    await screen.findByText('21.5');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add device/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add sensor/ })).not.toBeInTheDocument();
    expect(p.calls).not.toContain('GET /field-device-enrolments');
  });

  it('adds a sensor from the device, only among those its type supports', async () => {
    const p = platform({
      '/field-devices/sim-esp32-01/sensors': sensor('tds-1', 'Water TDS'),
    });
    renderWithProviders(<FieldDevicesLive />, {
      platform: p,
      session: session(['nav.devices', 'device.manage']),
    });
    fireEvent.click(await screen.findByRole('button', { name: /Add sensor/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Water TDS')).toBeInTheDocument();
    expect(within(dialog).queryByText('Air temperature and humidity')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /^Add$/ }));
    await waitFor(() => expect(p.calls).toContain('POST /field-devices/sim-esp32-01/sensors'));
    // A disabled sensor can be removed; an enabled one cannot.
    expect(screen.getAllByRole('button', { name: /Remove sensor/ })).toHaveLength(1);
  });

  it('shows the board health and what it reported', async () => {
    const p = platform({
      '/field-devices/sim-esp32-01/events': [
        {
          id: 2,
          type: 'sensor_lost',
          severity: 'warn',
          sensor_id: 'sim-esp32-01:water-temp-1',
          facts: {},
          detail: 'no 1-Wire device on GPIO4',
          origin: 'SIMULATED',
          boot_id: 'deadbeef',
          seq: 2,
          uptime_ms: 12000,
          received_at: '2026-11-08T10:00:10Z',
        },
        {
          id: 1,
          type: 'wifi_restored',
          severity: 'warn',
          sensor_id: null,
          facts: { down_ms: 120400 },
          detail: null,
          origin: 'SIMULATED',
          boot_id: 'deadbeef',
          seq: 1,
          uptime_ms: 9000,
          received_at: '2026-11-08T10:00:00Z',
        },
      ],
    });
    renderWithProviders(<FieldDevicesLive />, {
      platform: p,
      session: session(['nav.devices']),
    });
    // What the board reported is under Activity; its health under Overview.
    fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }));
    expect(await screen.findByText('Sensor lost')).toBeInTheDocument();
    expect(screen.getByText('no 1-Wire device on GPIO4')).toBeInTheDocument();
    expect(screen.getByText('Wi-Fi back')).toBeInTheDocument();
    expect(screen.getByText(/after 120 s/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(await screen.findByText('Watchdog (it hung)')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('shows what the board printed, on demand', async () => {
    const p = platform({
      '/field-devices/sim-esp32-01/logs': [
        {
          id: 7,
          boot_id: 'deadbeef',
          uptime_ms: 3_725_000,
          level: 'warn',
          tag: 'sensors',
          msg: 'DS18B20 water (GPIO4): 0 probe(s)',
          received_at: '2026-11-08T10:00:00Z',
          dropped_before: 2,
        },
      ],
    });
    renderWithProviders(<FieldDevicesLive />, {
      platform: p,
      session: session(['nav.devices', 'device.manage']),
    });
    fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }));
    fireEvent.click(await screen.findByRole('button', { name: /Show board log/ }));
    expect(await screen.findByText(/DS18B20 water \(GPIO4\): 0 probe/)).toBeInTheDocument();
    expect(screen.getByText(/2 line\(s\) lost/)).toBeInTheDocument();
    expect(screen.getByLabelText('Board log').textContent).toContain('[1:02:05] WARN  sensors:');
    expect(p.calls).toContain('GET /field-devices/sim-esp32-01/logs');
  });

  it('hides the board log when the device type does not send it', async () => {
    renderWithProviders(<FieldDevicesLive />, {
      platform: platform({
        '/field-devices/sim-esp32-01': { ...detailOf(), supports_logs: false },
      }),
      session: session(['nav.devices', 'device.manage']),
    });
    await screen.findByText('21.5');
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(screen.queryByRole('button', { name: /Show board log/ })).not.toBeInTheDocument();
  });

  it('offers only the networks the device type has', async () => {
    renderWithProviders(<FieldDevicesLive />, {
      platform: platform(),
      session: session(['nav.devices', 'device.manage']),
    });
    fireEvent.click(await screen.findByRole('button', { name: /Add device/ }));
    const dialog = await screen.findByRole('dialog');
    const eth = await within(dialog).findByRole('option', { name: /Ethernet/ });
    expect(eth).toBeDisabled();
    expect(within(dialog).getByRole('option', { name: 'Wi-Fi' })).not.toBeDisabled();
  });

  it('accepts a device that asked to join only with its claim code', async () => {
    const enrolment = {
      id: 'e1',
      hardware_id: '02:00:00:00:00:A1',
      profile_id: 'lefi-node-esp32.v1',
      profile_name: 'Test node type',
      firmware: '0.2.0-test',
      network: 'wifi',
      mac: '02:00:00:00:00:A1',
      status: 'PENDING',
      first_seen_at: '2026-11-08T10:00:00Z',
      last_seen_at: '2026-11-08T10:00:00Z',
      requests: 2,
      wrong_codes: 0,
      device_id: null,
      same_hardware: 1,
    };
    const p = platform({
      '/field-device-enrolments': [enrolment, { ...enrolment, id: 'e2', requests: 1 }],
      '/field-device-enrolments/e1/accept': { ...device, id: 'esp32-01', name: 'Bench 2' },
    });
    renderWithProviders(<FieldDevicesLive />, {
      platform: p,
      session: session(['nav.devices', 'device.manage']),
    });
    fireEvent.click(await screen.findByRole('button', { name: /2 asking to join/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText(/only one matches the board/)).toHaveLength(2);
    fireEvent.click(within(dialog).getAllByRole('button', { pressed: false })[0]!);
    fireEvent.change(within(dialog).getByPlaceholderText('ABCD-EFGH-JKLM'), {
      target: { value: 'abcd-efgh-jklm' },
    });
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Bench 2 node'), {
      target: { value: 'Bench 2' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Accept/ }));
    await waitFor(() => expect(p.calls).toContain('POST /field-device-enrolments/e1/accept'));
  });
});

describe('Greenhouses & Crops against the real Lefi Brain', () => {
  const zone = {
    id: 'z1',
    greenhouse_id: 'g1',
    name: 'Zone A',
    code: 'ZA',
    created_at: 'x',
    area_m2: null,
    climate_control: 'not_configured',
    growing_systems: ['containers'],
    notes: null,
    physical_ref: null,
    purpose: 'production',
    purpose_other: null,
    status: 'active',
    summary: { active_crops: 1, locations_by_kind: { bench: 1 }, plants: 40 },
  };
  const bench = {
    id: 'l1',
    zone_id: 'z1',
    code: 'BEN-01',
    name: 'Bench 01',
    kind: 'bench',
    parent_id: null,
    status: 'active',
    capacity: null,
    capacity_unit: null,
    custom_kind: null,
    length_m: null,
    width_m: null,
    volume_l: null,
    level: null,
    position: null,
    row: null,
    spot: null,
    subtype: null,
    notes: null,
    created_at: 'x',
  };
  const batch = {
    id: 'a1',
    batch_code: 'B-001',
    crop_type_id: 'c1',
    variety: null,
    location_id: 'l1',
    zone_id: 'z1',
    plant_quantity: 40,
    occupied_positions: null,
    started_on: '2026-11-01',
    start_event: 'sowing',
    growth_stage: 'seedling',
    expected_harvest_on: null,
    status: 'active',
    end_reason: null,
    ended_on: null,
    notes: null,
    created_at: 'x',
  };
  const plant = {
    id: 'p1',
    code: 'P-001',
    name: null,
    crop_type_id: 'c1',
    zone_id: 'z1',
    container_id: 'l1',
    nfc_uid: '04A22B9C',
    planted_on: '2026-11-01',
    notes: null,
    status: 'active',
    created_at: 'x',
    retired_at: null,
    assignment_id: 'a1',
  };
  const latest = {
    id: 'o1',
    plant_id: 'p1',
    health: 'watch',
    issues: ['water'],
    note: 'Leaves a bit dry',
    observed_by: 'Test Scout',
    observed_at: '2026-11-08T09:00:00Z',
    source: 'person',
  };
  const routes = {
    '/zones': [zone],
    '/containers': [bench],
    '/crop-assignments': [batch],
    '/plants': [plant],
    '/plants/p1/sensors': {
      plant_id: 'p1',
      sensors: [
        {
          relation: 'ambient',
          device_id: 'sim-esp32-01',
          device_name: 'Test node',
          sensor: sensor('air-1', 'Air temperature and humidity', {
            enabled: true,
            data_state: 'receiving',
            latest: [
              {
                variable: 'air_temperature',
                label: 'Air temperature',
                unit: '°C',
                decimals: 1,
                value: 19.25,
                received_at: '2026-11-08T10:00:00Z',
              },
            ],
          }),
        },
      ],
    },
    '/plant-health': {
      vision: { available: false, reason: 'No vision model is installed.' },
      counts: { plants: 1, healthy: 0, watch: 1, problem: 0, not_checked: 0, open_requests: 0 },
      plants: [
        {
          plant_id: 'p1',
          code: 'P-001',
          name: null,
          crop: 'Test lettuce',
          zone_id: 'z1',
          zone: 'Zone A',
          container_id: 'l1',
          planted_on: '2026-11-01',
          latest,
          open_request: null,
        },
      ],
      issues: ['water', 'other'],
      can_observe: true,
      can_request: false,
    },
    '/plants/p1/observations': [latest],
  };

  it('drills down greenhouse → zone → batch → plant with only what Lefi Brain has', async () => {
    renderWithProviders(<PlantsLive />, {
      platform: platform(routes),
      session: session(['nav.greenhouses', 'batch.edit', 'nav.plantHealth']),
    });
    // All greenhouses: real counts, no invented score, crop types still managed here.
    const card = await screen.findByRole('button', { name: /Test greenhouse/ });
    expect(within(card).getByText('40')).toBeInTheDocument();
    expect(within(card).getByText('ZA')).toBeInTheDocument();
    expect(screen.getByText('Placeholder')).toBeInTheDocument();
    expect(screen.getByText(/need AI vision, which Lefi Brain does not have/)).toBeInTheDocument();

    fireEvent.click(card);
    fireEvent.click(await screen.findByRole('button', { name: /ZA · Zone A/ }));

    // Zone: its batches, with the health people recorded on its tracked plants.
    const table = await screen.findByRole('table', { name: 'Crop batch inventory' });
    expect(within(table).getByText('B-001')).toBeInTheDocument();
    expect(within(table).getByText('Seedling')).toBeInTheDocument();
    expect(within(table).getByText('day 7', { exact: false })).toBeInTheDocument();
    expect(within(table).getByText('Watch')).toBeInTheDocument();

    fireEvent.click(within(table).getByText('B-001'));
    expect(await screen.findByText('Crop batch')).toBeInTheDocument();
    expect(screen.getByText('Day 7')).toBeInTheDocument();
    expect(screen.getByText(/Heights are estimated from images by AI vision/)).toBeInTheDocument();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('button', { name: 'ZA · Zone A' })).toBeInTheDocument();
    expect(within(crumbs).getByRole('button', { name: 'B-001 · Test lettuce' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Plant P-001' }));
    expect(await screen.findByText(/Air around it · Test node/)).toBeInTheDocument();
    expect(screen.getByText('19.3')).toBeInTheDocument();
    expect(screen.getByText('No vision model is installed.')).toBeInTheDocument();
    expect(await screen.findByText('Leaves a bit dry')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Log observation/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All greenhouses' }));
    expect(await screen.findByRole('button', { name: /Test greenhouse/ })).toBeInTheDocument();
  });

  it('shows no health at all without access to AI Plant Health', async () => {
    const p = platform(routes);
    renderWithProviders(<PlantsLive />, {
      platform: p,
      session: session(['nav.greenhouses']),
    });
    fireEvent.click(await screen.findByRole('button', { name: /Test greenhouse/ }));
    fireEvent.click(await screen.findByRole('button', { name: /ZA · Zone A/ }));
    const table = await screen.findByRole('table', { name: 'Crop batch inventory' });
    expect(within(table).queryByText('Watch')).not.toBeInTheDocument();
    expect(p.calls).not.toContain('GET /plant-health');
    expect(screen.queryByRole('button', { name: /New crop batch/ })).not.toBeInTheDocument();
  });

  it('guides an empty installation to create a greenhouse first', async () => {
    renderWithProviders(<PlantsLive />, {
      platform: platform({ '/greenhouses': [], '/zones': [], '/crop-types': [] }),
      session: session(['nav.greenhouses', 'batch.edit', 'zone.manage']),
    });
    expect(await screen.findByText('No greenhouses yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New greenhouse/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /New crop batch/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /New plant/ })).toBeDisabled();
  });

  it('offers New plant from the first level', async () => {
    renderWithProviders(<PlantsLive />, {
      platform: platform(routes),
      session: session(['nav.greenhouses', 'batch.edit']),
    });
    fireEvent.click(await screen.findByRole('button', { name: /New plant/ }));
    expect(await screen.findByRole('heading', { name: 'New plant' })).toBeInTheDocument();
  });
});

describe("USB cameras on Lefi Brain's PC (ADR-073)", () => {
  const usbItem = (extra: Record<string, unknown> = {}) => ({
    key: 'usb-3564-fef9-at-0x02100000',
    vendor_id: '3564',
    product_id: 'fef9',
    serial: null,
    location: '0x02100000',
    product_name: 'OBSBOT Tiny 2 Lite',
    vendor_name: 'Remo Tech Co., Ltd.',
    release: '05.10',
    model_id: 'obsbot-tiny-2-lite',
    model_name: 'OBSBOT Tiny 2 Lite',
    controls: true,
    camera_id: null,
    ...extra,
  });
  const added = {
    id: 'cam-01',
    name: 'Bench camera',
    model_id: 'obsbot-tiny-2-lite',
    model_name: 'OBSBOT Tiny 2 Lite',
    vendor_id: '3564',
    product_id: 'fef9',
    serial: null,
    zone_ids: [],
    zone_id: null,
    status: 'ACTIVE',
    origin: 'LIVE',
    connection: 'connected',
    connected_at: { location: '0x02100000', product_name: 'x', vendor_name: 'x', release: '05.10' },
    usb_location: '0x02100000',
    created_at: '2026-11-08T10:00:00Z',
    last_seen_at: '2026-11-08T10:00:20Z',
    retired_at: null,
    controls: true,
    ai_control: false,
  };

  it('adds a detected camera of a supported model', async () => {
    const other = usbItem({
      key: 'usb-1111-2222-at-0x03',
      vendor_id: '1111',
      product_id: '2222',
      product_name: 'Fake Other Webcam',
      model_id: null,
      model_name: null,
      controls: false,
    });
    const p = platform({
      '/cameras/usb': { available: true, reason: null, items: [usbItem(), other] },
    });
    const byMethod = async <T,>(req: { method: string; path: string }): Promise<T> =>
      req.method === 'POST' && req.path === '/cameras'
        ? (p.calls.push('POST /cameras'), added as T)
        : p.api<T>(req as never);
    renderWithProviders(<FieldDevicesLive />, {
      platform: { ...p, api: byMethod } as Platform,
      session: session(['nav.devices', 'device.manage']),
    });
    fireEvent.click(await screen.findByRole('tab', { name: 'Cameras' }));
    expect(await screen.findByText('Fake Other Webcam')).toBeInTheDocument();
    expect(screen.getAllByText('Video only').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Add' })).toHaveLength(2); // any USB camera
    expect(screen.getAllByText(/no USB serial number/)).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('OBSBOT Tiny 2 Lite'), {
      target: { value: 'Bench camera' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Add/ }));
    await waitFor(() => expect(p.calls).toContain('POST /cameras'));
  });

  it('counts every device added: sensor nodes, cameras and robots', async () => {
    renderWithProviders(<FieldDevicesLive />, {
      platform: platform({
        '/cameras': [added],
        '/robots': [
          { id: 'mh3-sim', device: { status: 'installed' } },
          { id: 'dev-robot', device: null }, // a developer's simulator, not an added device
        ],
      }),
      session: session(['nav.devices', 'device.manage']),
    });
    const all = (await screen.findByText('All devices')).parentElement!;
    await waitFor(() => expect(all).toHaveTextContent('3'));
    expect(await screen.findByRole('tab', { name: 'Cameras (1)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Robots (1)' })).toBeInTheDocument();
  });

  it('sets the zones a camera looks at: one or several (ADR-087)', async () => {
    const p = platform({
      '/cameras': [added],
      '/zones': [
        { id: 'z1', greenhouse_id: 'g1', name: 'Zone A', created_at: 'x' },
        { id: 'z2', greenhouse_id: 'g1', name: 'Zone B', created_at: 'x' },
      ],
    });
    const sent: unknown[] = [];
    const api = async <T,>(req: { method: string; path: string; body?: unknown }): Promise<T> => {
      if (req.method === 'PATCH') {
        sent.push(req.body);
        return { ...added, zone_ids: ['z2'], zone_id: 'z2' } as T;
      }
      return p.api<T>(req as never);
    };
    renderWithProviders(<FieldDevicesLive />, {
      platform: { ...p, api } as Platform,
      session: session(['nav.devices', 'device.manage']),
    });
    fireEvent.click(await screen.findByRole('tab', { name: 'Cameras' }));
    const zones = await screen.findByRole('group', { name: 'Zones Bench camera looks at' });
    fireEvent.click(await within(zones).findByRole('checkbox', { name: 'Zone B' }));
    await waitFor(() => expect(sent).toEqual([{ zone_ids: ['z2'] }]));
  });

  it('shows an added camera that is not plugged in, without controls for readers', async () => {
    const p = platform({
      '/cameras': [{ ...added, connection: 'not_connected', connected_at: null }],
      '/cameras/usb': { available: true, reason: null, items: [] },
      '/cameras/cam-01/commands': [],
    });
    renderWithProviders(<FieldDevicesLive />, {
      platform: p,
      session: session(['nav.devices']),
    });
    fireEvent.click(await screen.findByRole('tab', { name: 'Cameras' }));
    expect(await screen.findByText('Bench camera')).toBeInTheDocument();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getByText(/No USB camera is plugged/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retire/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Watch live/ }));
    expect(await screen.findByText(/No video: the camera is not plugged/)).toBeInTheDocument();
    expect(p.calls).not.toContain('GET /cameras/cam-01/frame');
    expect(screen.queryByRole('group', { name: 'Aim the camera' })).not.toBeInTheDocument();
  });

  const state = {
    pan: 20,
    tilt: 0,
    zoom: 30,
    pan_range: { min: -130, max: 130 },
    tilt_range: { min: -90, max: 90 },
    zoom_range: { min: 0, max: 100 },
    read_at: '2026-11-08T10:00:29Z',
  };
  const sent = {
    id: '00000000-0000-4000-8000-000000000001',
    camera_id: 'cam-01',
    kind: 'pan_tilt',
    params: { pan: 20, tilt: 0 },
    requested_by: 'ana',
    requested_at: '2026-11-08T10:00:10Z',
    finished_at: '2026-11-08T10:00:12Z',
    outcome: 'succeeded',
    error: null,
    result: { pan: 20, tilt: 0, zoom: 30 },
  };

  it('opens a camera: live preview, position, commands and their history', async () => {
    const p = platform({
      '/cameras': [added],
      '/cameras/cam-01/frame': {
        camera_id: 'cam-01',
        jpeg_base64: 'ZmFrZQ==',
        width: 960,
        height: 540,
        captured_at: '2026-11-08T10:00:29Z',
        origin: 'LIVE',
      },
      '/cameras/cam-01/state': state,
      '/cameras/cam-01/commands': [sent],
    });
    const bodies: unknown[] = [];
    const api = async <T,>(req: { method: string; path: string; body?: unknown }): Promise<T> => {
      if (req.method === 'POST' && req.path === '/cameras/cam-01/commands') {
        p.calls.push('POST /cameras/cam-01/commands');
        bodies.push(req.body);
        return { ...sent, kind: 'pan_tilt', params: req.body } as T;
      }
      return p.api<T>(req as never);
    };
    renderWithProviders(<FieldDevicesLive />, {
      platform: { ...p, api } as Platform,
      session: session(['nav.devices', 'device.manage']),
    });
    fireEvent.click(await screen.findByRole('tab', { name: 'Cameras' }));
    fireEvent.click(await screen.findByRole('button', { name: /Watch live/ }));
    const img = await screen.findByAltText('Live image from Bench camera');
    expect(img).toHaveAttribute('src', 'data:image/jpeg;base64,ZmFrZQ==');
    expect(await screen.findByText('20° · 0°')).toBeInTheDocument();
    expect(screen.getByText('30 / 100')).toBeInTheDocument();
    expect(screen.getByText('Aim 20°, 0°')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tilt up' }));
    await waitFor(() => expect(p.calls).toContain('POST /cameras/cam-01/commands'));
    const body = bodies[0] as Record<string, unknown>;
    expect(body).toMatchObject({ kind: 'pan_tilt', pan: 20, tilt: 10 });
    expect(typeof body.id).toBe('string');
  });

  it('plays the live stream where the platform has one, and stops it on close', async () => {
    const stops: string[] = [];
    const p = platform({
      '/cameras': [{ ...added, controls: true, ai_control: true }],
      '/cameras/cam-01/state': state,
      '/cameras/cam-01/commands': [],
      '/cameras/cam-01/photos': [],
    });
    const cameraStream = (id: string, onFrame: (f: Uint8Array) => void) => {
      onFrame(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
      return { done: new Promise<{ frames: number }>(() => undefined), stop: () => stops.push(id) };
    };
    renderWithProviders(<FieldDevicesLive />, {
      platform: { ...p, cameraStream } as Platform,
      session: session(['nav.devices', 'device.manage']),
    });
    fireEvent.click(await screen.findByRole('tab', { name: 'Cameras' }));
    expect(await screen.findByText('Lefi AI')).toBeInTheDocument(); // badge on the row
    fireEvent.click(screen.getByRole('button', { name: /Watch live/ }));
    expect(await screen.findByLabelText('Live video from Bench camera')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[class*="stageLive"]')).not.toBeNull());
    expect(p.calls).not.toContain('GET /cameras/cam-01/frame'); // no snapshots when streaming
    expect(screen.getByRole('switch', { name: 'Lefi AI may use this camera' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close camera' }));
    await waitFor(() => expect(stops).toEqual(['cam-01']));
  });

  it('says what to do when macOS has not allowed the camera', async () => {
    const { ApiError } = await import('@lefi/platform');
    const p = platform({
      '/cameras': [added],
      '/cameras/cam-01/state': state,
      '/cameras/cam-01/commands': [],
    });
    const api = async <T,>(req: { method: string; path: string }): Promise<T> => {
      if (req.path === '/cameras/cam-01/frame')
        throw new ApiError(409, {
          error: {
            code: 'FRAME_UNAVAILABLE',
            message: 'x',
            details: { reason: 'permission_denied' },
          },
        });
      return p.api<T>(req as never);
    };
    renderWithProviders(<FieldDevicesLive />, {
      platform: { ...p, api } as Platform,
      session: session(['nav.devices']),
    });
    fireEvent.click(await screen.findByRole('tab', { name: 'Cameras' }));
    fireEvent.click(await screen.findByRole('button', { name: /Watch live/ }));
    expect(await screen.findByText(/Privacy & Security → Camera/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Aim the camera' })).not.toBeInTheDocument();
  });

  it('says when Lefi Brain cannot list USB devices', async () => {
    renderWithProviders(<FieldDevicesLive />, {
      platform: platform({
        '/cameras/usb': { available: false, reason: 'built for macOS only so far', items: [] },
      }),
      session: session(['nav.devices']),
    });
    fireEvent.click(await screen.findByRole('tab', { name: 'Cameras' }));
    expect(await screen.findByText(/Not available here: built for macOS only/)).toBeInTheDocument();
  });

  it('a role without device.manage cannot add a detected camera', async () => {
    renderWithProviders(<FieldDevicesLive />, {
      platform: platform({
        '/cameras/usb': { available: true, reason: null, items: [usbItem()] },
      }),
      session: session(['nav.devices']),
    });
    fireEvent.click(await screen.findByRole('tab', { name: 'Cameras' }));
    expect(await screen.findByText('OBSBOT Tiny 2 Lite')).toBeInTheDocument();
    expect(screen.getByText('Not added')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
  });
});
