import type { Device } from '@lefi/api';
import { toneVars } from '@lefi/ui';
import { DataTable, type Column } from '../../shared/ui';
import { CATEGORY_ICON, dueColor, dueLabel, healthColor, MODES, statusTone } from './presentation';
import styles from './devices.module.css';

const COLUMNS: Column<Device>[] = [
  {
    key: 'id',
    header: 'Device · status',
    width: 'minmax(190px, 1.4fr)',
    render: (d) => {
      const t = toneVars(statusTone(d.status));
      return (
        <div className={styles.idCell}>
          <span className={styles.catIcon}>{CATEGORY_ICON[d.category]}</span>
          <div className={styles.stack}>
            <span className={styles.devId}>{d.id}</span>
            <span className={styles.status} style={{ color: t.fg }}>
              <span className={styles.dot} style={{ background: t.dot }} />
              {d.status}
            </span>
          </div>
        </div>
      );
    },
  },
  {
    key: 'brand',
    header: 'Brand · model',
    width: 'minmax(150px, 1.1fr)',
    render: (d) => (
      <div className={styles.stack}>
        <span className={styles.ellipsisStrong}>{d.brand}</span>
        <span className={styles.ellipsisMuted}>{d.model}</span>
      </div>
    ),
  },
  {
    key: 'loc',
    header: 'Location',
    width: 'minmax(150px, 1.1fr)',
    render: (d) => (
      <div className={styles.stack}>
        <span className={styles.mono}>{d.zone_label}</span>
        <span className={styles.ellipsisMuted}>{d.position}</span>
      </div>
    ),
  },
  {
    key: 'health',
    header: 'Health',
    width: '110px',
    render: (d) => <HealthBar value={d.health} />,
  },
  {
    key: 'due',
    header: 'Next service',
    width: '110px',
    render: (d) => (
      <span className={styles.due} style={{ color: dueColor(d) }}>
        {dueLabel(d)}
      </span>
    ),
  },
  {
    key: 'mode',
    header: 'AI / power',
    width: '130px',
    render: (d) => {
      const m = MODES[d.mode];
      const t = toneVars(m.tone);
      return (
        <span className={styles.modePill} style={{ background: t.bg, color: t.fg }}>
          <span className={styles.modeIcon}>{m.icon}</span>
          {m.label}
        </span>
      );
    },
  },
];

export function HealthBar({ value, large }: { value: number | null; large?: boolean }) {
  return (
    <div className={large ? styles.healthLarge : styles.health}>
      <div className={styles.healthTrack}>
        <div style={{ width: `${value ?? 0}%`, background: healthColor(value) }} />
      </div>
      <span>{value ?? '—'}</span>
    </div>
  );
}

export function DeviceTable({
  rows,
  selected,
  onSelect,
}: {
  rows: Device[];
  selected: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <DataTable
      label="Devices"
      columns={COLUMNS}
      rows={rows}
      rowKey={(d) => d.id}
      selectedKey={selected ?? ''}
      onRowClick={(d) => onSelect(d.id)}
      minWidth={800}
      maxBodyHeight={660}
    >
      {rows.length === 0 && <div className={styles.none}>No devices match these filters.</div>}
    </DataTable>
  );
}
