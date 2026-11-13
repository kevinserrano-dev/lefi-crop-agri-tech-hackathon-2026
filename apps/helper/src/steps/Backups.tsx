import { useCallback, useEffect, useState } from 'react';
import { asSetupError } from '../api';
import type { SetupError } from '../api';
import {
  PARTS,
  backupApi,
  backupDate,
  backupHealth,
  bytes,
  restoreNotes,
  savedParts,
  totalBytes,
  whyNot,
} from '../backups';
import type { BackupDisk, BackupEntry, BackupList, BackupStatus, PartId } from '../backups';
import { Badge, Banner, ErrorBox, Icon, Spinner } from '../ui';
import type { Tone } from '../ui';
import { AdminFields, useAdminAuth } from './AdminFields';

const HEALTH: Record<ReturnType<typeof backupHealth>, { tone: Tone; label: string }> = {
  ok: { tone: 'ok', label: 'Up to date' },
  late: { tone: 'warn', label: 'Late' },
  failed: { tone: 'crit', label: 'Last backup failed' },
  off: { tone: 'off', label: 'Paused' },
  none: { tone: 'off', label: 'Not set up' },
};

const KIND: Record<string, string> = {
  scheduled: 'Scheduled',
  manual: 'Made by hand',
  'pre-restore': 'Before a restore',
};

function local(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Choose the external disk. Internal disks and disk images are never offered (the engine says so). */
function DiskChooser({ status, onSaved }: { status: BackupStatus; onSaved: () => void }) {
  const admin = useAdminAuth();
  const [disks, setDisks] = useState<BackupDisk[] | null>(null);
  const [pick, setPick] = useState<string | null>(status.disk.uuid);
  const [error, setError] = useState<SetupError | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    backupApi.disks().then(
      (d) => {
        setDisks(d);
        setError(null);
      },
      (e) => {
        setDisks([]);
        setError(asSetupError(e));
      },
    );
  }, []);
  useEffect(load, [load]);
  const scan = () => {
    setDisks(null);
    load();
  };
  const chosen = disks?.find((d) => d.uuid === pick);
  const save = () => {
    if (!pick) return;
    setBusy(true);
    setError(null);
    backupApi
      .setDisk(pick, admin.auth)
      .then(
        () => {
          admin.clear();
          onSaved();
        },
        (e) => setError(asSetupError(e)),
      )
      .finally(() => setBusy(false));
  };
  return (
    <div className="card">
      <h2 className="card-title">
        <Icon name="hard_drive" /> Backup disk
      </h2>
      <p className="muted">
        Connect the external disk (USB or Thunderbolt) to this Mac. Only external disks are listed;
        this Mac’s own disk never holds its backups.
      </p>
      {disks === null ? <Spinner label="Looking for external disks…" /> : null}
      {disks && disks.length === 0 && !error ? (
        <Banner tone="info" icon="usb">
          No external disk is connected. Plug it in and press <strong>Look again</strong>.
        </Banner>
      ) : null}
      {disks && disks.length ? (
        <div className="choice-grid">
          {disks.map((d) => (
            <button
              key={d.uuid}
              type="button"
              className={`choice ${pick === d.uuid ? 'choice-on' : ''}`}
              disabled={!d.usable}
              aria-pressed={pick === d.uuid}
              onClick={() => setPick(d.uuid)}
            >
              <Icon name="hard_drive" className="choice-icon" />
              {pick === d.uuid ? <Icon name="check_circle" className="choice-check" /> : null}
              <span className="choice-title">
                {d.name}
                {status.disk.uuid === d.uuid ? <Badge tone="ok">In use</Badge> : null}
              </span>
              <span className="choice-body">
                {bytes(d.free_bytes)} free of {bytes(d.total_bytes)} · {d.filesystem || '?'} ·{' '}
                {d.bus}
                <br />
                {whyNot(d) ??
                  (d.encrypted
                    ? 'Encrypted'
                    : 'Not encrypted: anyone with this disk can read the backups')}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {chosen && !chosen.encrypted ? (
        <Banner tone="warn" icon="lock_open">
          Backups hold Lefi Brain’s keys and passwords. Keep this disk somewhere safe, or erase it
          as <strong>APFS (Encrypted)</strong> in Disk Utility before choosing it.
        </Banner>
      ) : null}
      {error ? <ErrorBox error={error} title="Not saved" /> : null}
      {pick && pick !== status.disk.uuid ? <AdminFields a={admin} /> : null}
      <div className="row-end">
        <button type="button" className="btn" onClick={scan} disabled={busy}>
          <Icon name="refresh" /> Look again
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !chosen?.usable || pick === status.disk.uuid || !admin.ready}
          onClick={save}
        >
          Use this disk
        </button>
      </div>
    </div>
  );
}

function Schedule({ status, onSaved }: { status: BackupStatus; onSaved: () => void }) {
  const admin = useAdminAuth();
  const current = status.enabled ? String(status.interval_hours) : 'off';
  const [every, setEvery] = useState(current);
  const [error, setError] = useState<SetupError | null>(null);
  const [busy, setBusy] = useState(false);
  const save = () => {
    setBusy(true);
    setError(null);
    backupApi
      .schedule(every as '6' | '12' | '24' | 'off', admin.auth)
      .then(
        () => {
          admin.clear();
          onSaved();
        },
        (e) => setError(asSetupError(e)),
      )
      .finally(() => setBusy(false));
  };
  return (
    <div className="card">
      <h2 className="card-title">
        <Icon name="schedule" /> How often
      </h2>
      <p className="muted">
        Lefi Crop Helper’s service makes the backup by itself, also when this window is closed. If
        the disk is not connected at that moment, it tries again every 10 minutes until it is. The{' '}
        {status.keep} most recent backups are kept on the disk.
      </p>
      <label className="field">
        <span className="field-label">Back up</span>
        <select className="input" value={every} onChange={(e) => setEvery(e.target.value)}>
          <option value="6">Every 6 hours</option>
          <option value="12">Every 12 hours (recommended)</option>
          <option value="24">Every 24 hours</option>
          <option value="off">Paused</option>
        </select>
      </label>
      {every !== current ? <AdminFields a={admin} /> : null}
      {error ? <ErrorBox error={error} title="Not saved" /> : null}
      <div className="row-end">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || every === current || !admin.ready}
          onClick={save}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function Restore({ b, onDone }: { b: BackupEntry; onDone: () => void }) {
  const admin = useAdminAuth();
  const saved = savedParts(b);
  const [parts, setParts] = useState<PartId[]>(saved);
  const [error, setError] = useState<SetupError | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const all = parts.length === saved.length;
  const toggle = (p: PartId) =>
    setParts((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]));
  const go = () => {
    setBusy(true);
    setError(null);
    backupApi
      .restore(b.id, parts, admin.auth)
      .then(
        () => {
          admin.clear();
          setDone(true);
          onDone();
        },
        (e) => setError(asSetupError(e)),
      )
      .finally(() => setBusy(false));
  };
  if (done)
    return (
      <Banner tone="ok" icon="settings_backup_restore">
        Restored from the backup of {backupDate(b.id)}. What was here before is kept on this Mac
        (Lefi Crop’s <code>backups/pre-restore-…</code> folder).
      </Banner>
    );
  return (
    <div className="confirm">
      <p>
        <strong>Restore from {backupDate(b.id)}</strong> — choose what to put back. Restoring
        everything is the safe choice; parts are for when you know what went wrong.
      </p>
      <div className="row-end">
        <button type="button" className="btn btn-small" onClick={() => setParts(all ? [] : saved)}>
          {all ? 'Choose none' : 'Choose everything'}
        </button>
      </div>
      {PARTS.map((p) => {
        const here = saved.includes(p.id);
        return (
          <label key={p.id} className={`toggle ${here ? '' : 'muted'}`}>
            <input
              type="checkbox"
              disabled={!here || busy}
              checked={parts.includes(p.id)}
              onChange={() => toggle(p.id)}
            />
            <span className="toggle-label">{p.title}</span>
            <span className="toggle-help">{here ? p.detail : 'Not in this backup.'}</span>
          </label>
        );
      })}
      {parts.length ? (
        <ul className="checks">
          {restoreNotes(parts).map((n) => (
            <li key={n} className="check">
              <Icon name="info" /> {n}
            </li>
          ))}
          <li className="check">
            <Icon name="shield" /> A copy of what is replaced is kept on this Mac first. If Lefi
            Brain does not start with the restored files, everything is put back as it was.
          </li>
        </ul>
      ) : null}
      <AdminFields a={admin} />
      {error ? <ErrorBox error={error} title="Not restored" /> : null}
      <div className="row-end">
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy || !parts.length || !admin.ready}
          onClick={go}
        >
          {busy ? 'Restoring…' : all ? 'Restore everything' : `Restore ${parts.length} part(s)`}
        </button>
      </div>
    </div>
  );
}

function BackupsOnDisk({ list, onChanged }: { list: BackupList; onChanged: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="card">
      <h2 className="card-title">
        <Icon name="inventory_2" /> Backups on the disk
      </h2>
      {!list.connected ? (
        <p className="muted">Connect the backup disk to see its backups and restore from them.</p>
      ) : !list.backups.length ? (
        <p className="muted">No backup on this disk yet.</p>
      ) : (
        <ul className="status-list">
          {list.backups.map((b) => (
            <li key={b.id} className="status-row">
              <div className="grow">
                <strong>{backupDate(b.id)}</strong>{' '}
                <Badge tone="info">{KIND[b.manifest.kind] ?? b.manifest.kind}</Badge>
                <div className="muted">
                  {bytes(totalBytes(b))} · {savedParts(b).length} parts · Lefi Brain{' '}
                  {b.manifest.brain_version || '?'} · release {b.manifest.release || '?'} ·{' '}
                  {b.manifest.hostname}
                </div>
                {open === b.id ? <Restore b={b} onDone={onChanged} /> : null}
              </div>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => setOpen(open === b.id ? null : b.id)}
              >
                {open === b.id ? 'Close' : 'Restore…'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Settings → Backups. Everything shown comes from `lefi backup` (ADR-098). */
export function BackupsView() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [list, setList] = useState<BackupList | null>(null);
  const [error, setError] = useState<SetupError | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<SetupError | null>(null);
  const read = useCallback(() => {
    backupApi.status().then(
      (s) => {
        setStatus(s);
        setError(null);
      },
      (e) => setError(asSetupError(e)),
    );
    backupApi.list().then(setList, () => setList(null));
  }, []);
  useEffect(() => {
    read();
    const t = setInterval(read, 15000);
    return () => clearInterval(t);
  }, [read]);
  const runNow = () => {
    setRunning(true);
    setRunError(null);
    backupApi
      .runNow()
      .then(read, (e) => setRunError(asSetupError(e)))
      .finally(() => setRunning(false));
  };
  if (error) return <ErrorBox error={error} title="Backups cannot be read" />;
  if (!status) return <Spinner label="Reading backups…" />;
  const health = HEALTH[backupHealth(status, new Date())];
  const last = status.last;
  return (
    <>
      <div className="card">
        <h2 className="card-title">
          <Icon name="backup" /> Backups of this installation{' '}
          <Badge tone={health.tone}>{health.label}</Badge>
        </h2>
        <p className="muted">
          A full copy of Lefi Brain’s database, photos, settings, certificates and passwords, Lefi
          Crop Helper’s data and Lefi Desktop’s pairing, on an external disk. AI models and the
          programs themselves are not copied: Lefi Crop Helper installs them again.
        </p>
        {status.configured ? (
          <ul className="checks">
            <li className="check">
              <Badge tone={status.disk.connected ? 'ok' : 'warn'}>
                {status.disk.connected ? 'Connected' : 'Not connected'}
              </Badge>
              Disk {status.disk.name}
            </li>
            <li className="check">
              <Badge tone={last?.last_ok_at ? 'ok' : 'off'}>Last</Badge>
              {last?.last_ok_at
                ? `${local(last.last_ok_at)} · ${bytes(last.last_ok_bytes)}`
                : 'No backup yet'}
            </li>
            {last?.result === 'failed' ? (
              <li className="check">
                <Badge tone="crit">Failed</Badge>
                {local(last.attempt_at)}: {last.message}
              </li>
            ) : null}
            <li className="check">
              <Badge tone="info">Next</Badge>
              {!status.enabled
                ? 'Paused'
                : status.next_due === 'now'
                  ? 'Within 10 minutes'
                  : local(status.next_due)}
            </li>
          </ul>
        ) : (
          <Banner tone="warn" icon="warning">
            No backup disk chosen yet: if this Mac’s disk breaks, the greenhouse history is lost.
          </Banner>
        )}
        {status.last_restore ? (
          <p className="muted small">
            Last restore: {local(status.last_restore.at)} from {backupDate(status.last_restore.id)}{' '}
            ({status.last_restore.parts.join(', ')})
            {status.last_restore.result === 'undone' ? ' — undone, nothing changed' : ''}.
          </p>
        ) : null}
        {runError ? <ErrorBox error={runError} title="Backup not made" /> : null}
        <div className="row-end">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!status.configured || !status.disk.connected || running || status.running}
            onClick={runNow}
          >
            <Icon name="backup" /> {running || status.running ? 'Backing up…' : 'Back up now'}
          </button>
        </div>
      </div>
      <DiskChooser status={status} onSaved={read} />
      {status.configured ? <Schedule status={status} onSaved={read} /> : null}
      {list ? <BackupsOnDisk list={list} onChanged={read} /> : null}
      <div className="card">
        <h2 className="card-title">
          <Icon name="cloud" /> Cloud backup <Badge tone="off">Coming soon</Badge>
        </h2>
        <p className="muted">
          A copy outside the greenhouse, encrypted on this Mac before it leaves. Not available yet:
          today backups stay on your own disk, and Lefi Crop never needs the internet to run.
        </p>
      </div>
    </>
  );
}
