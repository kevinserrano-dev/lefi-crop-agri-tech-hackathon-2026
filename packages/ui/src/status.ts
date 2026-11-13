/**
 * Status vocabulary shared by every LEFI CROP client (ADR-012).
 * Connectivity/provenance, freshness and health are separate axes:
 * no current data ⇒ health UNKNOWN, never HEALTHY.
 */
export type Tone = 'ok' | 'warn' | 'crit' | 'off' | 'info' | 'sim';

export type Health = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';
export type Origin = 'LIVE' | 'SIMULATED';
export type Freshness = 'LIVE' | 'STALE' | 'OFFLINE' | 'ERROR';
export type Severity = 'info' | 'warning' | 'critical';

export const healthTone: Record<Health, Tone> = {
  HEALTHY: 'ok',
  WARNING: 'warn',
  CRITICAL: 'crit',
  UNKNOWN: 'off',
};

export const healthLabel: Record<Health, string> = {
  HEALTHY: 'Healthy',
  WARNING: 'Warning',
  CRITICAL: 'Critical',
  UNKNOWN: 'Unknown',
};

export const freshnessTone: Record<Freshness, Tone> = {
  LIVE: 'ok',
  STALE: 'warn',
  OFFLINE: 'off',
  ERROR: 'crit',
};

export const severityTone: Record<Severity, Tone> = {
  info: 'info',
  warning: 'warn',
  critical: 'crit',
};

/** CSS custom properties for a tone; use as inline style values. */
export function toneVars(tone: Tone): { fg: string; bg: string; dot: string } {
  return {
    fg: `var(--lefi-${tone}-fg)`,
    bg: `var(--lefi-${tone}-bg)`,
    dot: `var(--lefi-${tone}-dot)`,
  };
}
