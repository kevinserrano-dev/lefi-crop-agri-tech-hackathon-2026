import styles from './ToggleGroup.module.css';

export interface ToggleGroupProps<T extends string> {
  options: Array<{ value: T; label: string; dot?: string }>;
  value: T;
  onChange: (v: T) => void;
  label: string;
}

/** Row of filter buttons with a dark selected state (design: severity filters). */
export function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
  label,
}: ToggleGroupProps<T>) {
  return (
    <div role="group" aria-label={label} className={styles.group}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          className={styles.btn}
          onClick={() => onChange(o.value)}
        >
          {o.dot && <span className={styles.dot} style={{ background: o.dot }} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}
