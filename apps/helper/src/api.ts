/**
 * The only module that talks to the Tauri host. Every call runs the real bash installer
 * (scripts/install.sh, bin/lefi) through the Rust commands in src-tauri/src/commands.rs.
 */
import type { InstallSession } from './resume';
import { Channel, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { HwReport } from './hw';

export type Role = 'ai' | 'core' | 'admin' | 'desktop';

export interface SupportedModel {
  tag: string;
  label: string;
  role: string;
  /** Measured footprint; null = not measured (`?` in supported-models.tsv). */
  mem_gb: number | null;
  ctx: number | null;
  measured_on: string | null;
}

/** What an AI node answered (it does not prove the model fits its GPU: the installer checks that). */
export interface AiNodeCheck {
  url: string;
  reachable: boolean;
  models: string[];
}

export interface SetupContext {
  os: 'macos' | 'linux' | 'windows' | 'other';
  arch: string;
  payload_root: string;
  debug_build: boolean;
  /** Packaged for the hackathon's judges: activation needs no code. */
  hackathon_build?: boolean;
  /** Why this OS cannot install at all; activation is reported separately. */
  install_blocked_reason: string | null;
  needs_elevation: boolean;
  supported_models: SupportedModel[];
}

/** The licence inside a verified activation code (tools/lefi-license/src/lib.rs). */
export interface Licence {
  v: number;
  licence_id: string;
  customer: string;
  installation_id: string;
  max_pcs: number;
  edition: string;
  issued_at: string;
  support_until: string;
  key_id: string;
}

export interface ActivationStatus {
  installation_id: string;
  licence: Licence | null;
  development_licence: boolean;
  production_key_embedded: boolean;
  stored_code_problem: string | null;
  dev_skipped: boolean;
  data_dir: string;
}

/** Install only after activation; development builds may skip it for the session. */
export function canInstall(ctx: SetupContext, a: ActivationStatus | null): boolean {
  if (ctx.install_blocked_reason || !a) return false;
  return a.licence !== null || (ctx.debug_build && a.dev_skipped);
}

/** Mirrors `SetupAnswers` in src-tauri/src/answers.rs (unknown fields are refused there). */
export interface SetupAnswers {
  roles: Role[];
  model: string;
  ai_url: string | null;
  ai_lan: boolean;
  admin_https: boolean;
  stop_conflicting_services: boolean;
  update_model: boolean;
  service_mode: 'systemd' | 'user' | null;
  dev_allow_no_ai: boolean;
}

/** One NDJSON line of `install.sh --events ndjson` (INSTALLER.md §3.2). */
export interface InstallerEvent {
  event: string;
  seq: number;
  ts: string;
  [field: string]: unknown;
}

export type InstallerMsg =
  { kind: 'event'; event: InstallerEvent } | { kind: 'output'; line: string };

export interface PlanPreview {
  events: InstallerEvent[];
  output: string[];
  exit_code: number | null;
  answers: string;
}

export interface RunResult {
  exit_code: number | null;
}

export interface SetupError {
  code: string;
  message: string;
  hint?: string;
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function asSetupError(e: unknown): SetupError {
  if (e && typeof e === 'object' && 'code' in e && 'message' in e) return e as SetupError;
  return { code: 'UNEXPECTED', message: e instanceof Error ? e.message : String(e) };
}

function channel(onMsg: (m: InstallerMsg) => void): Channel<InstallerMsg> {
  const ch = new Channel<InstallerMsg>();
  ch.onmessage = onMsg;
  return ch;
}

export const setupApi = {
  context: () => invoke<SetupContext>('setup_context'),
  activationStatus: () => invoke<ActivationStatus>('activation_status'),
  activate: (code: string) => invoke<ActivationStatus>('activate', { code }),
  skipActivation: () => invoke<ActivationStatus>('skip_activation'),
  scan: () => invoke<HwReport>('scan_hardware'),
  previewPlan: (answers: SetupAnswers) => invoke<PlanPreview>('preview_plan', { answers }),
  runInstall: (answers: SetupAnswers, onMsg: (m: InstallerMsg) => void) =>
    invoke<RunResult>('run_install', { answers, onEvent: channel(onMsg) }),
  /** Safe Brain update from this app's payload (ADR-036). */
  runBrainUpdate: (onMsg: (m: InstallerMsg) => void) =>
    invoke<RunResult>('run_brain_update', { onEvent: channel(onMsg) }),
  runCheck: (onMsg: (m: InstallerMsg) => void) =>
    invoke<RunResult>('run_check', { onEvent: channel(onMsg) }),
  installSession: () => invoke<InstallSession>('install_session'),
  checkAiNode: (url: string) => invoke<AiNodeCheck>('check_ai_node', { url }),
  /** Ask the running installer to stop at its next safe point and roll back (ADR-032). */
  cancelInstall: () => invoke<boolean>('cancel_install'),
  /** `install.sh --rollback`: undo every run of this installation (after a failure). */
  runRollback: (onMsg: (m: InstallerMsg) => void) =>
    invoke<RunResult>('run_rollback', { onEvent: channel(onMsg) }),
  onCloseBlocked: (cb: () => void) => listen('setup://close-blocked', cb),
};
