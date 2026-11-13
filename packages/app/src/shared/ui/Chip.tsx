import { toneVars, type Tone } from '@lefi/ui';
import styles from './Chip.module.css';

/** Rounded shortcut chip with a status dot (design: dashboard focus chips). */
export function Chip({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone: Tone;
  onClick?: () => void;
}) {
  return (
    <button type="button" className={styles.chip} onClick={onClick}>
      <span className={styles.dot} style={{ background: toneVars(tone).dot }} />
      {label}
    </button>
  );
}
