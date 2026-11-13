import { describe, expect, it } from 'vitest';
import { backupDate, backupHealth, bytes, restoreNotes, savedParts, whyNot } from './backups';
import type { BackupEntry, BackupStatus } from './backups';

const status = (over: Partial<BackupStatus>): BackupStatus => ({
  configured: true,
  enabled: true,
  disk: { uuid: 'u', name: 'FAKE disk', connected: true, mount: '/Volumes/FAKE' },
  interval_hours: 12,
  keep: 14,
  next_due: null,
  running: false,
  last: null,
  last_restore: null,
  cloud: { available: false, note: 'coming soon' },
  ...over,
});
const last = (ok: string | null, result: 'ok' | 'failed' = 'ok') => ({
  result,
  code: result === 'ok' ? 'OK' : 'DISK_NOT_CONNECTED',
  message: '',
  attempt_at: '2026-11-12T12:00:00Z',
  last_ok_at: ok,
  last_ok_id: null,
  last_ok_bytes: null,
});

describe('backups (ADR-098)', () => {
  const now = new Date('2026-11-12T12:00:00Z');

  it('health: none, paused, ok, late after two intervals, failed', () => {
    expect(backupHealth(status({ configured: false }), now)).toBe('none');
    expect(backupHealth(status({ enabled: false }), now)).toBe('off');
    expect(backupHealth(status({ last: last('2026-11-12T01:00:00Z') }), now)).toBe('ok');
    expect(backupHealth(status({ last: last('2026-11-11T11:00:00Z') }), now)).toBe('late');
    expect(backupHealth(status({ last: null }), now)).toBe('late');
    expect(backupHealth(status({ last: last('2026-11-12T01:00:00Z', 'failed') }), now)).toBe(
      'failed',
    );
  });

  it('restoring a database alone warns about devices added since; together it does not', () => {
    const alone = restoreNotes(['database']).join(' ');
    expect(alone).toContain('may be refused');
    expect(alone).toContain('Lefi Brain stops');
    expect(restoreNotes(['database', 'security']).join(' ')).not.toContain('may be refused');
    expect(restoreNotes(['helper']).join(' ')).not.toContain('Lefi Brain stops');
    expect(restoreNotes(['desktop']).join(' ')).toContain('Close Lefi Desktop');
  });

  it('only parts saved in a backup can be restored', () => {
    const b: BackupEntry = {
      id: '20261112-120000',
      manifest: {
        kind: 'scheduled',
        created_at: '',
        hostname: 'fake',
        release: '0.16.0',
        brain_version: '0.12.0',
        helper_version: '0.5.18',
        parts: [
          { id: 'database', title: '', status: 'saved', bytes: 10 },
          { id: 'desktop', title: '', status: 'not_here' },
        ],
      },
    };
    expect(savedParts(b)).toEqual(['database']);
    expect(backupDate(b.id)).toBe('2026-11-12 12:00');
  });

  it('formats sizes and explains a disk that cannot be used', () => {
    expect(bytes(1_500_000_000_000)).toBe('1.5 TB');
    expect(bytes(2_400_000)).toBe('2 MB');
    expect(bytes(null)).toBe('?');
    const d = {
      uuid: 'u',
      name: 'n',
      mount: '/Volumes/n',
      filesystem: 'NTFS',
      bus: 'USB',
      total_bytes: 1,
      free_bytes: 1,
      encrypted: false,
      usable: false,
      why_not: 'read_only',
    };
    expect(whyNot(d)).toContain('can only read it');
    expect(whyNot({ ...d, usable: true, why_not: null })).toBeNull();
  });
});
