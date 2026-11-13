import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './Dialog.module.css';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
  /** Max width in px (default 560). */
  width?: number;
}

/**
 * Modal dialog (design: emergency stop). Rendered in a portal so ancestors with
 * transforms or backdrop filters cannot clip it. Closes on Escape and backdrop click.
 */
export function Dialog({ open, onClose, labelledBy, children, width }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={styles.panel}
        style={width ? { width: `min(${width}px, 100%)` } : undefined}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
