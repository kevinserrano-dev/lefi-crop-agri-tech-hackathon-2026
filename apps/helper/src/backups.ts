/** Backups on an external disk, restore by parts (ADR-098). The engine is `lefi backup`. */
import { invoke } from '@tauri-apps/api/core';
import type { AdminAuth } from './console';

export type PartId = 'database' | 'files' | 'settings' | 'security' | 'helper' | 'desktop';

export const PARTS: { id: PartId; title: string; detail: string }[] = [
  {
    id: 'database',
    title: 'Lefi Brain database',
    detail:
      'Greenhouses, zones, plants, readings, alerts, tasks, shifts, users and the audit trail.',
  },
  {
    id: 'files',
    title: 'Photos and evidence',
    detail: 'Camera photos, task photo evidence and robot photos.',
  },
  {
    id: 'settings',
    title: 'Settings',
    detail: 'Lefi Brain configuration, AI address and model, installed components, AI kill switch.',
  },
  {
    id: 'security',
    title: 'Certificates and passwords',
    detail: 'Lefi Brain’s certificate authority, MQTT accounts of the boards, Lefi Gateway.',
  },
  {
    id: 'helper',
    title: 'Lefi Crop Helper',
    detail: 'Licence, root certificate, the list of PCs and their keys, update settings.',
  },
  {
    id: 'desktop',
    title: 'Lefi Desktop on this PC',
    detail: 'Its pairing with Lefi Brain.',
  },
];

export interface BackupDisk {
  uuid: string;
  name: string;
  mount: string;
  filesystem: string;
  bus: string;
  total_bytes: number | null;
  free_bytes: number | null;
  encrypted: boolean;
  usable: boolean;
  why_not: string | null;
}

export interface BackupLast {
  result: 'ok' | 'failed';
  code: string;
  message: string;
  attempt_at: string;
  last_ok_at: string | null;
  last_ok_id: string | null;
  last_ok_bytes: number | null;
}

export interface BackupStatus {
  configured: boolean;
  enabled: boolean;
  disk: { uuid: string | null; name: string | null; connected: boolean; mount: string | null };
  interval_hours: number;
  keep: number;
  next_due: string | null;
  running: boolean;
  last: BackupLast | null;
  last_restore: {
    result: 'ok' | 'undone';
    id: string;
    parts: PartId[];
    at: string;
    safety_copy: string;
    failed: string | null;
  } | null;
  cloud: { available: false; note: string };
}

export interface ManifestPart {
  id: PartId;
  title: string;
  status: 'saved' | 'not_here';
  bytes?: number;
  db_revision?: string;
}

export interface BackupEntry {
  id: string;
  manifest: {
    kind: 'scheduled' | 'manual' | 'pre-restore';
    created_at: string;
    hostname: string;
    release: string;
    brain_version: string;
    helper_version: string;
    parts: ManifestPart[];
  };
}

export interface BackupList {
  connected: boolean;
  path?: string;
  backups: BackupEntry[];
}

export const backupApi = {
  status: () => invoke<BackupStatus>('backup_status'),
  disks: () => invoke<BackupDisk[]>('backup_disks'),
  list: () => invoke<BackupList>('backup_list'),
  setDisk: (uuid: string, auth: AdminAuth | null) =>
    invoke<BackupStatus>('backup_set_disk', { uuid, auth }),
  schedule: (every: '6' | '12' | '24' | 'on' | 'off', auth: AdminAuth | null) =>
    invoke<BackupStatus>('backup_schedule', { every, auth }),
  runNow: () => invoke<{ ok: boolean; id: string; bytes: number; kept: number }>('backup_run_now'),
  restore: (id: string, parts: PartId[], auth: AdminAuth | null) =>
    invoke<{ ok: boolean }>('backup_restore', { id, parts, auth }),
};

export function bytes(n: number | null | undefined): string {
  if (n == null) return '?';
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)} TB`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

const WHY_NOT: Record<string, string> = {
  read_only: 'This Mac can only read it (NTFS, or locked). Format it as APFS or exFAT to use it.',
  no_uuid: 'This disk has no volume id, so it could not be found again.',
};
export function whyNot(d: BackupDisk): string | null {
  if (d.usable) return null;
  return WHY_NOT[d.why_not ?? ''] ?? 'This disk cannot hold backups.';
}

/** When a backup holds the chosen part at all (a PC without Lefi Desktop has none of its data). */
export function savedParts(b: BackupEntry): PartId[] {
  return b.manifest.parts.filter((p) => p.status === 'saved').map((p) => p.id);
}

export function totalBytes(b: BackupEntry): number {
  return b.manifest.parts.reduce((s, p) => s + (p.bytes ?? 0), 0);
}

/**
 * What people should know before restoring these parts. Parts depend on each other: a database
 * without its certificates refuses PCs paired after the backup, and so on.
 */
export function restoreNotes(parts: PartId[]): string[] {
  const has = (p: PartId) => parts.includes(p);
  const notes: string[] = [];
  if (has('database'))
    notes.push(
      'Everything recorded after this backup (readings, alerts, tasks, users, audit) is replaced by the backup’s state.',
    );
  if (has('database') && !has('security'))
    notes.push(
      'PCs and boards added after this backup may be refused: their certificates and MQTT accounts are not in the restored database. Restoring “Certificates and passwords” too avoids that.',
    );
  if (has('security') && !has('database'))
    notes.push('Devices paired after this backup stop working until they are paired again.');
  if (has('helper'))
    notes.push(
      'Lefi Crop Helper’s service stops for a moment; macOS may ask for this Mac’s password twice.',
    );
  if (has('desktop')) notes.push('Close Lefi Desktop on this Mac first.');
  if (has('database') || has('files') || has('settings') || has('security'))
    notes.push('Lefi Brain stops while its files are replaced and starts again by itself.');
  return notes;
}

/** A failed attempt older than the last success is history, not a problem now. */
export function backupHealth(
  s: BackupStatus,
  now: Date,
): 'none' | 'ok' | 'late' | 'failed' | 'off' {
  if (!s.configured) return 'none';
  if (!s.enabled) return 'off';
  if (s.last?.result === 'failed') return 'failed';
  const ok = s.last?.last_ok_at ? new Date(s.last.last_ok_at).getTime() : null;
  if (ok == null) return 'late';
  return now.getTime() - ok > s.interval_hours * 2 * 3600_000 ? 'late' : 'ok';
}

export function backupDate(id: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(id);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : id;
}
