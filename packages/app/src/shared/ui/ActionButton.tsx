import type { ActionAvailability } from '@lefi/api';
import { Icon } from './Icon';
import styles from './ActionButton.module.css';

export interface ActionButtonProps {
  label: string;
  icon: string;
  /** Brain-decided availability. Not allowed ⇒ lock icon + reason as tooltip. */
  availability: ActionAvailability | undefined;
  onClick: () => void;
  busy?: boolean;
  variant?: 'outline' | 'solid';
}

/**
 * Action whose permission and state rules belong to the Brain (design: buttons with a lock).
 * Still clickable when locked so the user gets the Brain's reason; the API refuses anyway.
 */
export function ActionButton({
  label,
  icon,
  availability,
  onClick,
  busy,
  variant = 'outline',
}: ActionButtonProps) {
  const locked = !availability?.allowed;
  return (
    <button
      type="button"
      className={`${styles.btn} ${styles[variant]}`}
      data-locked={locked}
      title={locked ? (availability?.reason ?? undefined) : label}
      disabled={busy}
      onClick={onClick}
    >
      <Icon name={locked ? 'lock' : icon} size={variant === 'solid' ? 18 : 17} />
      {label}
    </button>
  );
}
