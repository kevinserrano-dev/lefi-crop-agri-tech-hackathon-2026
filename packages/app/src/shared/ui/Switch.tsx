import styles from './Switch.module.css';

/** On/off switch (design: guardrails, AI settings). */
export function Switch({
  on,
  onChange,
  label,
  disabled,
  title,
}: {
  on: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={title}
      className={styles.switch}
      data-locked={disabled}
      onClick={onChange}
    >
      <span />
    </button>
  );
}
