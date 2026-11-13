import styles from './Segmented.module.css';

export interface SegmentedProps<T extends string> {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  label: string;
}

/** Segmented control (design: zone tabs on "Current conditions"). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: SegmentedProps<T>) {
  return (
    <div role="tablist" aria-label={label} className={styles.group}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={o.value === value}
          className={styles.item}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
