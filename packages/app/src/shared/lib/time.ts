/**
 * Relative time against the Brain clock (ADR-008): freshness is never computed from the
 * workstation clock.
 */
export function timeAgo(iso: string | null, brainNow: string | undefined): string {
  if (!iso) return 'never';
  const now = brainNow ? Date.parse(brainNow) : Date.now();
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.max(1, Math.round((m - 1) / 60));
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function greeting(iso: string | undefined): string {
  const h = iso ? new Date(iso).getHours() : new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** `YYYY-MM-DD HH:MM` in local time (design: incident table). */
export function stamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
