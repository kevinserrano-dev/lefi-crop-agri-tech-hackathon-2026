import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { queries, type DeviceFilters } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import {
  ActionButton,
  KpiRow,
  KpiTile,
  SearchInput,
  Select,
  Skeleton,
  ToggleGroup,
  useToast,
} from '../../shared/ui';
import { useCan } from '../session';
import { DeviceDetailPanel } from './DeviceDetailPanel';
import { DeviceTable } from './DeviceTable';
import { RegisterDeviceDialog } from './RegisterDeviceDialog';
import styles from './devices.module.css';

type Cat = NonNullable<DeviceFilters['category']> | 'all';
type St = NonNullable<DeviceFilters['status']> | 'all';

/** Devices & Health (design): registry table + selected device panel. */
export function DevicesPage() {
  const platform = usePlatform();
  const canManage = useCan('device.manage');
  const [cat, setCat] = useState<Cat>('all');
  const [status, setStatus] = useState<St>('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string>();
  const [registering, setRegistering] = useState(false);
  const toast = useToast((t) => t.show);
  // `?device=<id>` (e.g. from Zones & Inventory) preselects a device.
  const search = useSearch({ strict: false }) as { device?: string };
  const [seen, setSeen] = useState(search.device);
  if (search.device !== seen) {
    setSeen(search.device);
    if (search.device) {
      setCat('all');
      setStatus('all');
      setQ('');
      setSelected(search.device);
    }
  }

  const filters: DeviceFilters = {
    ...(cat !== 'all' && { category: cat }),
    ...(status !== 'all' && { status }),
    ...(q.trim() && { q: q.trim() }),
  };
  const summary = useQuery(queries.deviceSummary(platform));
  const list = useQuery(queries.devices(platform, filters));
  const s = summary.data;
  // Default selection: the first offline device (needs attention), else the first row.
  const current =
    selected ??
    search.device ??
    (list.data?.find((d) => d.status === 'Offline') ?? list.data?.[0])?.id;
  const count = (k: keyof NonNullable<typeof s>['categories']) =>
    s ? ` · ${s.categories[k]}` : '';

  return (
    <>
      <KpiRow min={170}>
        <KpiTile label="Devices registered" value={s?.registered} />
        <KpiTile label="Online" value={s?.online} color="var(--lefi-ok-fg)" />
        <KpiTile label="Offline · no data" value={s?.offline} color="var(--lefi-crit-fg)" />
        <KpiTile
          label="Service due ≤ 14 d"
          value={s?.service_due_14d}
          color="var(--lefi-warn-fg)"
        />
        <KpiTile
          label="Isolated, paused or off"
          value={s?.isolated_paused_off}
          color="var(--lefi-info-fg)"
        />
      </KpiRow>

      <div className={styles.toolbar}>
        <ToggleGroup
          label="Category"
          value={cat}
          onChange={setCat}
          options={[
            { value: 'all', label: `All${count('all')}` },
            { value: 'sensor', label: `Sensors${count('sensor')}` },
            { value: 'camera', label: `Cameras${count('camera')}` },
            { value: 'actuator', label: `Actuators${count('actuator')}` },
            { value: 'robot', label: `Robots & drones${count('robot')}` },
          ]}
        />
        <div className={styles.row}>
          <Select
            aria-label="Status filter"
            className={styles.statusSelect}
            value={status}
            onChange={(e) => setStatus(e.target.value as St)}
          >
            <option value="all">All</option>
            <option value="attention">Needs attention</option>
            <option value="offline">Offline</option>
            <option value="due14">Maintenance due ≤ 14 d</option>
            <option value="isolated">Isolated, paused or off</option>
            <option value="pending">Pending approval{s ? ` · ${s.pending_approval}` : ''}</option>
          </Select>
          <SearchInput
            placeholder="ID, brand, serial or zone"
            aria-label="Search devices"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <ActionButton
            label="Register device"
            icon="add"
            variant="solid"
            availability={{
              allowed: canManage,
              reason: canManage ? null : 'Requires permission: Register & edit devices',
            }}
            onClick={() =>
              canManage
                ? setRegistering(true)
                : toast('Requires permission: Register & edit devices', 'bad')
            }
          />
        </div>
      </div>

      <div className={styles.layout}>
        {list.isPending ? (
          <Skeleton height={520} />
        ) : list.isError ? (
          <span className={styles.muted}>{describeError(list.error)}</span>
        ) : (
          <DeviceTable rows={list.data} selected={current} onSelect={setSelected} />
        )}
        {current && (
          <DeviceDetailPanel key={current} id={current} onRejected={() => setSelected(undefined)} />
        )}
      </div>

      <RegisterDeviceDialog
        open={registering}
        onClose={() => setRegistering(false)}
        onRegistered={(id) => {
          setStatus('all');
          setCat('all');
          setQ('');
          setSelected(id);
        }}
      />
    </>
  );
}
