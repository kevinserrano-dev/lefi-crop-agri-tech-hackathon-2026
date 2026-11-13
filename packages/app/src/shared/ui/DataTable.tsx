import type { ReactNode } from 'react';
import styles from './DataTable.module.css';

export interface Column<T> {
  key: string;
  header: string;
  /** CSS grid track, e.g. `92px` or `minmax(240px, 2.2fr)`. */
  width: string;
  render: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Below this width the table scrolls horizontally (design: 1040 px). */
  minWidth?: number;
  label: string;
  /** Highlighted row (design: selected device). */
  selectedKey?: string;
  /** Scroll the body beyond this height; the header stays visible. */
  maxBodyHeight?: number;
  /** Rendered after the rows (e.g. an empty message). */
  children?: ReactNode;
}

/** Grid-based table (design: incidents, tasks, devices, audit). */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  minWidth = 900,
  label,
  selectedKey,
  maxBodyHeight,
  children,
}: DataTableProps<T>) {
  const template = columns.map((c) => c.width).join(' ');
  return (
    <div className={styles.wrap}>
      <div role="table" aria-label={label} style={{ minWidth }}>
        <div role="row" className={styles.head} style={{ gridTemplateColumns: template }}>
          {columns.map((c) => (
            <span role="columnheader" key={c.key}>
              {c.header}
            </span>
          ))}
        </div>
        <div
          className={styles.body}
          style={maxBodyHeight ? { maxHeight: maxBodyHeight } : undefined}
        >
          {rows.map((row) => {
            const key = rowKey(row);
            return (
              <div
                role="row"
                key={key}
                className={styles.row}
                aria-selected={selectedKey === undefined ? undefined : selectedKey === key}
                data-clickable={Boolean(onRowClick)}
                style={{ gridTemplateColumns: template }}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => (e.key === 'Enter' || e.key === ' ') && onRowClick(row)
                    : undefined
                }
              >
                {columns.map((c) => (
                  <div role="cell" key={c.key} className={styles.cell}>
                    {c.render(row)}
                  </div>
                ))}
              </div>
            );
          })}
          {children}
        </div>
      </div>
    </div>
  );
}
