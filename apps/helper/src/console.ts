/** After setup (src-tauri/src/console.rs, ADR-043). */
import { Channel, invoke } from '@tauri-apps/api/core';
import type { InstallerMsg, RunResult } from './api';

export interface AdminAuth {
  username: string;
  password: string;
}

export interface ConsoleState {
  finished: boolean;
  /** This PC runs the Brain, so there is an administrator to ask for. */
  admin_required: boolean;
  admin_username: string;
  has_credentials: boolean;
}

export interface Login {
  username: string;
  password: string;
}

export interface Credentials {
  admin: Login | null;
  devices: Login[];
}

export interface StatusItem {
  id: string;
  title: string;
  state: 'running' | 'down';
  version?: string | null;
  detail?: string;
  model?: string | null;
  loaded?: Array<{ name: string; gpu_pct: number | null }>;
}

export interface SystemStatus {
  name: string;
  hostname: string;
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
  items: StatusItem[];
}

function channel(onMsg: (m: InstallerMsg) => void): Channel<InstallerMsg> {
  const c = new Channel<InstallerMsg>();
  c.onmessage = onMsg;
  return c;
}

export const consoleApi = {
  state: () => invoke<ConsoleState>('console_state'),
  credentials: () => invoke<Credentials>('read_credentials'),
  finish: () => invoke<{ ok: boolean }>('finish_setup'),
  changePassword: (auth: AdminAuth, newPassword: string) =>
    invoke<{ ok: boolean }>('change_admin_password', { auth, newPassword }),
  status: () => invoke<SystemStatus>('system_status'),
  removeComponent: (role: string, auth: AdminAuth | null, onMsg: (m: InstallerMsg) => void) =>
    invoke<RunResult>('remove_component', { role, auth, onEvent: channel(onMsg) }),
  uninstall: (auth: AdminAuth | null, onMsg: (m: InstallerMsg) => void) =>
    invoke<RunResult>('uninstall_everything', { auth, onEvent: channel(onMsg) }),
};

/** All credentials as text, to paste into a password manager. */
export function credentialsText(c: Credentials): string {
  const lines = ['Lefi Crop credentials'];
  if (c.admin) {
    lines.push('', 'Super administrator (Lefi Desktop and Lefi Crop Helper)');
    lines.push(`user: ${c.admin.username}`, `password: ${c.admin.password}`);
  }
  if (c.devices.length) {
    lines.push('', 'MQTT devices');
    for (const d of c.devices) lines.push(`${d.username}: ${d.password}`);
  }
  return lines.join('\n') + '\n';
}

/** Lefi Desktop pairing (src-tauri/src/devices.rs, ADR-048). */
export interface PairingCode {
  code: string;
  expires_at: string;
  url: string | null;
  gateway_ca_fingerprint: string | null;
}

export interface PairedDevice {
  id: string;
  name: string;
  platform: string;
  status: 'active' | 'revoked';
  issued_at: string;
  expires_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  /** Hash identifying the PC (ADR-055); null for pairings made before it existed. */
  machine_id?: string | null;
}

/** Lefi Desktop's last automatic pairing attempt on this PC (its `pairing-status.json`). */
export interface LocalPairingStatus {
  state: 'pairing' | 'paired' | 'retrying' | 'failed';
  message: string;
  url: string | null;
  at: number;
}

export interface PairedDevices {
  available: boolean;
  gateway_requires_device?: boolean;
  ca?: { ready?: boolean; two_level?: boolean; not_after?: string };
  devices: PairedDevice[];
  /** The device id in this PC's Lefi Desktop `pairing.json`, if any. */
  local_device_id?: string | null;
  /** Its pairing and its private key are both there. */
  local_paired?: boolean;
  local_installed?: boolean;
  local_machine_id?: string | null;
  local_status?: LocalPairingStatus | null;
  /** An offer waits in Lefi Desktop's folder (it is retried until used, refused or expired). */
  offer_waiting?: boolean;
}

export const devicesApi = {
  list: () => invoke<PairedDevices>('paired_devices'),
  newCode: () => invoke<PairingCode>('create_pairing_code'),
  pairLocal: () => invoke<{ offered: boolean }>('pair_local_desktop'),
  revoke: (deviceId: string, auth: AdminAuth | null) =>
    invoke<unknown>('revoke_device', { deviceId, auth }),
  resetLocal: (auth: AdminAuth | null) =>
    invoke<{ revoked: string | null; offered: boolean }>('reset_local_pairing', { auth }),
};
