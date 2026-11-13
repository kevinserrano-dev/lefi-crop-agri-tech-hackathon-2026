/** "Nodes" console API (src-tauri/src/fleet.rs → lefi-helperd main on loopback, ADR-033). */
import { invoke } from '@tauri-apps/api/core';
import type { InstallerMsg } from './api';
import type { AdminAuth } from './console';

export type Connectivity = 'online' | 'stale' | 'offline' | 'never' | 'revoked';

export interface FleetNode {
  id: string;
  /** The name Lefi gives this PC (lefi-node-N); `hostname` is the computer's own. */
  name: string;
  hostname: string;
  ip: string;
  os: string;
  arch: string;
  enrolled_at: number;
  last_seen: number | null;
  seconds_since_seen: number | null;
  connectivity: Connectivity;
  assigned: string[];
  revoked: boolean;
  active_command: CommandRecord | null;
  ai_link: AiLink | null;
  last_command: CommandRecord | null;
  /** The last real install, for "Undo": other commands may have run after it. */
  last_install: CommandRecord | null;
  ai_endpoint: string;
  /** From the Brain's own configuration, not from the last attempt to connect it. */
  used_by_brain: boolean;
  ai_bench: AiBench | null;
  /** That PC's service is older than this main PC: it must be updated first. */
  service_outdated: boolean;
  /** What the main PC can update there, from versions both sides measured (ADR-062). */
  updates?: NodeUpdates;
  last_heartbeat: {
    uptime_s: number | null;
    disk_free_gb: number | null;
    helperd_version: string;
    services: Array<{ name: string; state: string }>;
    report: NodeReport | null;
  } | null;
}

export interface NodeUpdates {
  /** `remote`: that service can replace itself; otherwise it is updated once on that PC. */
  service: { installed: string; available: string; remote: boolean } | null;
  desktop: { installed: string; available: string } | null;
}

/** What that PC measures about itself (helperd/src/report.rs). Null: not measurable there. */
export interface NodeReport {
  pc: {
    model: string | null;
    chip: string | null;
    cores: number | null;
    memory_gb: number | null;
    os_version: string | null;
  };
  metrics: {
    load_1m: number | null;
    memory_used_gb: number | null;
    gpu_utilization_pct: number | null;
    gpu_memory_in_use_gb: number | null;
  };
  components: ComponentState[];
  ai: AiReport | null;
}

export type ComponentStateName =
  'running' | 'stopped' | 'disabled' | 'installed' | 'external' | 'not_installed';

export interface ComponentState {
  id: string;
  installed: boolean;
  state: ComponentStateName;
  version: string | null;
  detail: string | null;
  path: string | null;
}

export interface AiReport {
  version: string | null;
  models: Array<{ name: string; size_gb: number }>;
  loaded: Array<{
    name: string;
    size_gb: number;
    gpu_pct: number | null;
    context_length: number | null;
  }>;
  lan: boolean | null;
  kill_switch: boolean;
}

/** A real, short generation on that PC, run on request. */
export interface AiBench {
  model: string;
  tokens_per_s: number;
  eval_count: number;
  load_ms: number | null;
  prompt_ms: number | null;
  total_ms: number | null;
  gpu_pct: number | null;
  size_gb: number | null;
  context_length: number | null;
  at: number;
}

/** boot = starts when the Mac starts (LaunchDaemon); login = when you log in (LaunchAgent). */
export type ServiceScope = 'boot' | 'login' | 'none';

export type FleetStatus =
  | { service: 'stopped'; service_registered: ServiceScope; message?: string }
  | {
      service: 'running';
      service_registered: ServiceScope;
      installation_id: string;
      main_name: string;
      ca_fingerprint: string;
      join_url: string;
      lan_ips: string[];
      max_pcs: number;
      satellite_platform: string;
      satellite_available: boolean;
      remote_install_available: boolean;
      update_command: string;
      /** The version of the service program this main PC shares with the other PCs. */
      satellite_version?: string | null;
      /** The service still runs the version from before this app was updated. */
      service_outdated?: boolean;
      nodes: FleetNode[];
    };

/** Whether the main PC's Brain uses this PC's AI (`lefi ai use` result). */
export interface AiLink {
  url: string;
  state: 'linking' | 'ok' | 'failed';
  code: string | null;
  model: string | null;
  gpu_pct: number | null;
  message: string;
  at: number;
}

/** A command from the main PC to a satellite (helperd/src/jobs.rs). */
export interface CommandRecord {
  command: {
    id: string;
    node_id: string;
    kind:
      | 'install'
      | 'rollback'
      | 'remove'
      | 'service'
      | 'ai_bench'
      | 'erase'
      | 'desktop_pair'
      | 'update_service';
    action?: string | null;
    roles: string[];
    dry_run: boolean;
    issued_at: number;
    expires_at: number;
  };
  state: 'queued' | 'delivered' | 'running' | 'ok' | 'failed' | 'cancelled' | 'expired';
  cancel_requested: boolean;
  steps_done: number;
  steps_total: number;
  current_step: string | null;
  exit_code: number | null;
  error: string | null;
  rollback_result: string | null;
  /** `erase`: what an administrator of that PC must still run (ADR-054). */
  leftover?: string | null;
}

export interface CommandDetail {
  record: CommandRecord;
  messages: InstallerMsg[];
}

export interface JoinCode {
  code: string;
  expires_at: number;
  expected_ip: string | null;
  join_url: string;
  join_command: string;
  ca_fingerprint: string;
}

/** Components a satellite may run (the Brain stays on the main PC, ADR-031). */
export const SATELLITE_COMPONENTS: Array<{ id: string; label: string }> = [
  { id: 'ai', label: 'AI node' },
  { id: 'desktop', label: 'Lefi Desktop' },
  { id: 'robot', label: 'Robot simulator' },
  { id: 'firmware', label: 'Firmware tools' },
];

export const fleetApi = {
  status: () => invoke<FleetStatus>('fleet_status'),
  startService: (atBoot: boolean) => invoke<{ scope: string }>('fleet_start_service', { atBoot }),
  stopService: () => invoke<{ ok: boolean }>('fleet_stop_service'),
  createCode: (expectedIp: string | null) => invoke<JoinCode>('fleet_create_code', { expectedIp }),
  revoke: (id: string, auth: AdminAuth | null) =>
    invoke<{ ok: boolean }>('fleet_revoke', { id, auth }),
  install: (id: string, dryRun: boolean, roles: string[] | null = null) =>
    invoke<{ command: CommandRecord }>('fleet_install', { id, dryRun, roles }),
  remove: (id: string, role: string, auth: AdminAuth | null) =>
    invoke<{ command: CommandRecord }>('fleet_run', {
      id,
      kind: 'remove',
      role,
      action: null,
      auth,
    }),
  service: (id: string, action: 'start' | 'stop' | 'restart' | 'off' | 'on') =>
    invoke<{ command: CommandRecord }>('fleet_run', {
      id,
      kind: 'service',
      role: null,
      action,
      auth: null,
    }),
  measureAi: (id: string) =>
    invoke<{ command: CommandRecord }>('fleet_run', {
      id,
      kind: 'ai_bench',
      role: null,
      action: null,
      auth: null,
    }),
  rollback: (id: string, auth: AdminAuth | null) =>
    invoke<{ command: CommandRecord }>('fleet_rollback', { id, auth }),
  cancel: (cmd: string) => invoke<{ ok: boolean }>('fleet_cancel', { cmd }),
  linkAi: (id: string) => invoke<{ ok: boolean }>('fleet_link_ai', { id }),
  updateService: (id: string) =>
    invoke<{ command: CommandRecord }>('fleet_update_service', { id }),
  command: (cmd: string) => invoke<CommandDetail>('fleet_command', { cmd }),
  assign: (id: string, roles: string[]) => invoke<unknown>('fleet_assign', { id, roles }),
};

/** An AI another PC of this installation offers to the Brain. */
export interface FoundAiNode {
  id: string;
  name: string;
  url: string;
  models: string[];
  online: boolean;
  loaded: AiReport['loaded'];
  bench: AiBench | null;
  listensOnLan: boolean;
}

/** The PCs whose AI answers and serves a supported model; the ones online come first. */
export function findAiNodes(status: FleetStatus | null, supported: string[]): FoundAiNode[] {
  if (status?.service !== 'running') return [];
  const found: FoundAiNode[] = [];
  for (const n of status.nodes) {
    const ai = n.last_heartbeat?.report?.ai;
    if (n.revoked || !ai) continue;
    const models = ai.models.map((m) => m.name).filter((m) => supported.includes(m));
    if (!models.length) continue;
    found.push({
      id: n.id,
      name: n.name,
      url: n.ai_endpoint,
      models,
      online: n.connectivity === 'online',
      loaded: ai.loaded,
      bench: n.ai_bench,
      listensOnLan: ai.lan !== false,
    });
  }
  return found.sort((a, b) => Number(b.online) - Number(a.online));
}

export function ago(s: number | null): string {
  if (s === null) return 'never';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

export function uptime(s: number | null): string {
  if (s === null) return 'unknown';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d ? `${d} d ${h} h` : `${h} h ${Math.floor((s % 3600) / 60)} min`;
}
