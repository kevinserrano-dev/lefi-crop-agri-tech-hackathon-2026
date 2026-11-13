/** "Erase Lefi Crop from every PC" (src-tauri/src/erase.rs, ADR-054). */
import { Channel, invoke } from '@tauri-apps/api/core';
import type { InstallerMsg, RunResult } from './api';
import type { AdminAuth } from './console';
import type { CommandRecord } from './fleet';

export type EraseReason = '' | 'offline' | 'outdated' | 'busy' | 'removed' | 'refused';

export interface EraseNode {
  id: string;
  name: string;
  hostname: string;
  ip: string;
  erasable: boolean;
  reason: EraseReason;
  message?: string;
  command_id?: string | null;
}

export interface ErasePlan {
  service_running: boolean;
  /** Only when the service is stopped: PCs that joined, read from its registry. */
  registered_nodes?: number;
  update_command?: string;
  nodes: EraseNode[];
  /** What an administrator runs on a PC whose boot service file stays. */
  manual_command: string;
  /** Pasted in Terminal on a PC that could not be reached from here. */
  manual_script: string;
}

export const eraseApi = {
  plan: () => invoke<ErasePlan>('erase_plan'),
  nodes: (auth: AdminAuth | null) => invoke<{ nodes: EraseNode[] }>('erase_nodes', { auth }),
  thisPc: (auth: AdminAuth | null, onMsg: (m: InstallerMsg) => void) => {
    const c = new Channel<InstallerMsg>();
    c.onmessage = onMsg;
    return invoke<RunResult>('erase_this_pc', { auth, onEvent: c });
  },
  quit: () => invoke<unknown>('quit_and_remove_helper'),
};

/** Why a PC cannot be erased from here, in words. */
export function reasonText(n: EraseNode): string {
  switch (n.reason) {
    case 'offline':
      return 'Not answering: it is off or not on this network.';
    case 'outdated':
      return 'Its Lefi Crop Helper service is too old to erase itself. Update it first (Nodes shows the command), or erase it by hand.';
    case 'busy':
      return 'It is running another task. Wait for it to finish.';
    case 'refused':
      return n.message ?? 'The main PC could not send the request.';
    default:
      return '';
  }
}

export type NodeOutcome = 'waiting' | 'running' | 'erased' | 'failed' | 'skipped';

/** One PC's state from its command record (or none, for a PC that was not asked). */
export function nodeOutcome(n: EraseNode, rec: CommandRecord | null | undefined): NodeOutcome {
  if (!n.erasable || !n.command_id) return 'skipped';
  if (!rec) return 'waiting';
  if (rec.state === 'ok') return 'erased';
  if (rec.state === 'failed' || rec.state === 'cancelled' || rec.state === 'expired')
    return 'failed';
  return rec.state === 'running' ? 'running' : 'waiting';
}

export const finished = (o: NodeOutcome) => o === 'erased' || o === 'failed' || o === 'skipped';
