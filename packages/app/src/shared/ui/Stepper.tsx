import styles from './Stepper.module.css';

/** Lifecycle stepper (design: incident New → Closed). `current` is the index reached. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className={styles.steps} style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}>
      {steps.map((label, i) => (
        <li
          key={label}
          data-done={i <= current}
          data-current={i === current}
          aria-current={i === current ? 'step' : undefined}
        >
          <div className={styles.track}>
            <span className={styles.dot} />
            <span className={styles.bar} data-filled={i < current} />
          </div>
          <span className={styles.label}>{label}</span>
        </li>
      ))}
    </ol>
  );
}
