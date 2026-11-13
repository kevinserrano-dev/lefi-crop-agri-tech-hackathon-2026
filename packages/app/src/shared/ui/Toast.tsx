import { useEffect } from 'react';
import { create } from 'zustand';
import { mascots } from '@lefi/ui';
import styles from './Toast.module.css';

type Kind = 'ok' | 'bad' | 'info';
interface ToastState {
  toast: { id: number; msg: string; kind: Kind } | null;
  show: (msg: string, kind?: Kind) => void;
  clear: () => void;
}

/** One toast at a time (design: dark pill with the mascot, bottom right). */
export const useToast = create<ToastState>((set) => ({
  toast: null,
  show: (msg, kind = 'ok') => set({ toast: { id: Date.now(), msg, kind } }),
  clear: () => set({ toast: null }),
}));

const IMG: Record<Kind, string> = {
  ok: mascots.thumbsup,
  bad: mascots.sad,
  info: mascots.thinking,
};

export function ToastViewport() {
  const toast = useToast((s) => s.toast);
  const clear = useToast((s) => s.clear);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(clear, 3600);
    return () => clearTimeout(t);
  }, [toast, clear]);
  if (!toast) return null;
  return (
    <div role="status" aria-live="polite" className={styles.toast}>
      <img src={IMG[toast.kind]} alt="" />
      <span>{toast.msg}</span>
    </div>
  );
}
