/** The part of `lefi hw --json` (schema lefi.hw.v1, scripts/lib/hwscan.sh) this app shows. */

export type Fit = 'ok' | 'gpu' | 'no' | 'unknown';
export type Verdict = 'ok' | 'unknown' | 'not_viable';

export interface HwModelFit {
  tag: string;
  role: string;
  fit: Fit;
  why: string;
}

export interface HwReport {
  schema: 'lefi.hw.v1';
  scanned_at: string;
  host: { name: string | null; model: string | null };
  os: {
    kernel: string;
    id: string | null;
    version: string | null;
    name: string | null;
    arch: string;
  };
  cpu: { model: string | null; cores: number | null };
  memory: { total_gb: number | null };
  gpus: Array<{ vendor?: string; name?: string | null; memory_gb?: number | null }>;
  accelerator: {
    kind: string;
    name: string | null;
    memory_gb: number | null;
    basis: string | null;
  };
  disk: { path: string; free_gb: number | null; total_gb: number | null };
  power: { source: string | null; battery_present: boolean | null; battery_percent: number | null };
  ports: Array<{ port: number; in_use: boolean; process: string | null }>;
  platform: {
    systemd: boolean;
    package_manager: string | null;
    ollama_installed: boolean;
    ollama_version: string | null;
  };
  recommendation: {
    verdict: Verdict;
    model: string | null;
    reason: string;
    headroom_gb: number;
    min_gpu_share_pct: number;
    models: HwModelFit[];
  };
  unknown: Array<{ field: string; reason: string }>;
}

/** Ports each role needs (same list the installer checks in scan_step). */
export const ROLE_PORTS: Record<'ai' | 'core' | 'admin' | 'desktop', number[]> = {
  desktop: [],
  ai: [11434],
  core: [1883, 8000],
  admin: [8080, 8443],
};

export function fmtGb(v: number | null | undefined): string {
  return v == null ? 'unknown' : `${v.toFixed(v >= 100 ? 0 : 1)} GB`;
}
