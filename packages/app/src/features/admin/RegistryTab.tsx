import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queries, type Device, type DeviceFilters } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import {
  ActionButton,
  DataTable,
  ProvenanceBadge,
  SearchInput,
  Skeleton,
  ToggleGroup,
  useToast,
  type Column,
} from '../../shared/ui';
import { RegisterDeviceDialog } from '../devices/RegisterDeviceDialog';
import { useCan } from '../session';
import styles from './admin.module.css';

type St = NonNullable<DeviceFilters['status']> | 'all';
const FILTERS: Array<{ value: St; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'offline', label: 'Offline' },
  { value: 'pending', label: 'Pending approval' },
];

const COLUMNS: Column<Device>[] = [
  {
    key: 'id',
    header: 'Device ID',
    width: 'minmax(170px, 1.4fr)',
    render: (d) => <span className={styles.monoStrong}>{d.id}</span>,
  },
  {
    key: 'type',
    header: 'Type · model',
    width: '1.4fr',
    render: (d) => (
      <div className={styles.permText}>
        <b>{d.type}</b>
        <span className={styles.faint}>{d.model}</span>
      </div>
    ),
  },
  {
    key: 'zone',
    header: 'Zone',
    width: '90px',
    render: (d) => <span className={styles.mono}>{d.zone_id ?? d.zone_label}</span>,
  },
  { key: 'proto', header: 'Protocol', width: '110px', render: (d) => d.protocol },
  {
    key: 'fw',
    header: 'Firmware',
    width: '90px',
    render: (d) => <span className={styles.mono}>{d.firmware}</span>,
  },
  {
    key: 'sig',
    header: 'Signal',
    width: '80px',
    render: (d) => <span className={styles.mono}>{d.signal}</span>,
  },
  { key: 'bat', header: 'Battery', width: '80px', render: (d) => d.battery },
  {
    key: 'seen',
    header: 'Last seen',
    width: '90px',
    render: (d) => <span className={styles.mono}>{d.last_seen_label}</span>,
  },
  {
    key: 'st',
    header: 'Status',
    width: '150px',
    render: (d) => (
      <span className={styles.statusCell}>
        {d.status} <ProvenanceBadge origin={d.origin} />
      </span>
    ),
  },
];

/** Technical device & sensor registry (same Brain data as Devices & Health). */
export function RegistryTab() {
  const platform = usePlatform();
  const canManage = useCan('device.manage');
  const toast = useToast((s) => s.show);
  const [status, setStatus] = useState<St>('all');
  const [q, setQ] = useState('');
  const [registering, setRegistering] = useState(false);
  const list = useQuery(
    queries.devices(platform, {
      ...(status !== 'all' && { status }),
      ...(q.trim() && { q: q.trim() }),
    }),
  );
  const reason = 'Requires permission: Register & edit devices';
  return (
    <>
      <div className={styles.toolbar}>
        <ToggleGroup label="Device status" options={FILTERS} value={status} onChange={setStatus} />
        <div className={styles.toolbarRight}>
          <SearchInput
            placeholder="Device ID, zone or model"
            aria-label="Search devices"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <ActionButton
            label="Register device"
            icon="add"
            variant="solid"
            availability={{ allowed: canManage, reason: canManage ? null : reason }}
            onClick={() => (canManage ? setRegistering(true) : toast(reason, 'bad'))}
          />
        </div>
      </div>
      <section className={styles.tableCard}>
        {list.isPending ? (
          <Skeleton height={400} />
        ) : list.isError ? (
          <span className={styles.faint}>{describeError(list.error)}</span>
        ) : (
          <DataTable
            label="Device and sensor registry"
            columns={COLUMNS}
            rows={list.data}
            rowKey={(d) => d.id}
            minWidth={1040}
            maxBodyHeight={560}
          >
            {list.data.length === 0 && (
              <div className={styles.none}>No devices match these filters.</div>
            )}
          </DataTable>
        )}
      </section>
      <RegisterDeviceDialog open={registering} onClose={() => setRegistering(false)} />
    </>
  );
}
