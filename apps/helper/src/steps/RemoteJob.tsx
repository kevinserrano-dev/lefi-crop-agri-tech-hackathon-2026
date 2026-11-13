import { useEffect, useState } from 'react';
import { asSetupError } from '../api';
import type { SetupError } from '../api';
import { fleetApi, SATELLITE_COMPONENTS } from '../fleet';
import type { CommandRecord, FleetNode } from '../fleet';
import { applyMsg, emptyRun, firstFailure, stepPercent } from '../progress';
import type { RunView } from '../progress';
import { Badge, Banner, Bar, Disclosure, ErrorBox, Icon, LogView } from '../ui';
import type { Tone } from '../ui';
import { AdminFields, useAdminAuth } from './AdminFields';
import { RollbackPanel, StepRow } from './Install';

function FailureBanner({ run }: { run: RunView | null }) {
  const f = run ? firstFailure(run) : null;
  if (!f) return null;
  return (
    <Banner tone="crit" icon="error">
      <strong>{f.message}</strong>
      <p className="muted">
        {f.hint ||
          'The log below shows what happened. Fix it and install again: finished steps are not repeated.'}
      </p>
    </Banner>
  );
}

const STATE: Record<CommandRecord['state'], { label: string; tone: Tone }> = {
  queued: { label: 'Waiting for the PC', tone: 'info' },
  delivered: { label: 'Starting', tone: 'info' },
  running: { label: 'In progress', tone: 'info' },
  ok: { label: 'Finished', tone: 'ok' },
  failed: { label: 'Failed', tone: 'crit' },
  cancelled: { label: 'Cancelled', tone: 'warn' },
  expired: { label: 'Not started (expired)', tone: 'off' },
};

const ACTION: Record<string, string> = {
  start: 'Start',
  stop: 'Stop',
  restart: 'Restart',
  off: 'Kill switch: turn off',
  on: 'Kill switch: turn on',
};

function componentNames(roles: string[]): string {
  return roles.map((r) => SATELLITE_COMPONENTS.find((c) => c.id === r)?.label ?? r).join(', ');
}

function title(r: CommandRecord): string {
  const c = r.command;
  if (c.kind === 'rollback') return 'Undo the installation';
  if (c.kind === 'remove') return `Remove ${componentNames(c.roles)}`;
  if (c.kind === 'ai_bench') return 'AI speed test';
  if (c.kind === 'service') return `${ACTION[c.action ?? ''] ?? c.action} the AI`;
  if (c.kind === 'update_service') return 'Update the Lefi Crop Helper service';
  if (c.kind === 'desktop_pair') return 'Pair Lefi Desktop';
  if (c.kind === 'erase') return 'Erase Lefi Crop';
  return c.dry_run ? `Preview: ${componentNames(c.roles)}` : `Install ${componentNames(c.roles)}`;
}

type Ask = 'cancel' | 'rollback' | null;

/** What a PC is doing or did last: follow it live, read its log, cancel, undo (ADR-033, ADR-040). */
export function RemoteJob({
  node,
  remoteAvailable,
  onChanged,
}: {
  node: FleetNode;
  remoteAvailable: boolean;
  onChanged: () => void;
}) {
  const shown = node.active_command ?? node.last_command;
  const active = !!node.active_command;
  const [view, setView] = useState<RunView | null>(null);
  const [error, setError] = useState<SetupError | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);
  const admin = useAdminAuth();

  const cmdId = shown?.command.id;
  useEffect(() => {
    if (!cmdId) return;
    let alive = true;
    const load = () =>
      fleetApi.command(cmdId).then(
        (d) => alive && setView(d.messages.reduce(applyMsg, emptyRun)),
        () => undefined,
      );
    void load();
    const t = active ? setInterval(load, 2000) : undefined;
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [cmdId, active, shown?.state]);

  const online = node.connectivity === 'online';
  const lastInstall = node.last_install;
  const canUndo =
    !active &&
    online &&
    remoteAvailable &&
    !!lastInstall &&
    (lastInstall.state === 'ok' || lastInstall.state === 'failed') &&
    node.last_command?.command.kind !== 'rollback';

  const act = (p: Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setAsk(null);
    p.then(onChanged, (e) => setError(asSetupError(e))).finally(() => setBusy(false));
  };

  return (
    <div className="remote">
      {(active && node.active_command) || canUndo ? (
        <div className="remote-actions">
          {active && node.active_command ? (
            <button
              type="button"
              className="btn"
              disabled={busy || node.active_command.cancel_requested}
              onClick={() => setAsk('cancel')}
            >
              <Icon name="block" />{' '}
              {node.active_command.cancel_requested ? 'Cancelling…' : 'Cancel'}
            </button>
          ) : null}
          {canUndo ? (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setAsk('rollback')}
            >
              <Icon name="settings_backup_restore" /> Undo the last install
            </button>
          ) : null}
        </div>
      ) : null}

      {ask ? (
        <div className="confirm" role="alertdialog">
          <p>
            <strong>
              {ask === 'cancel'
                ? `Stop the work on ${node.name} and undo what it changed?`
                : `Undo the last installation on ${node.name}?`}
            </strong>{' '}
            Software that was on that PC before is kept.
          </p>
          {ask === 'rollback' ? <AdminFields a={admin} /> : null}
          <div className="row-end">
            <button type="button" className="btn" onClick={() => setAsk(null)}>
              Back
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={ask === 'rollback' && !admin.ready}
              onClick={() =>
                act(
                  ask === 'cancel'
                    ? fleetApi.cancel(node.active_command!.command.id)
                    : fleetApi.rollback(node.id, admin.auth),
                )
              }
            >
              {ask === 'cancel' ? 'Cancel and undo' : 'Undo'}
            </button>
          </div>
        </div>
      ) : null}
      {error ? <ErrorBox error={error} title="Not started" /> : null}

      {shown ? (
        <div className="remote-job">
          <div className="remote-job-head">
            <strong>{title(shown)}</strong>{' '}
            <Badge tone={STATE[shown.state].tone}>{STATE[shown.state].label}</Badge>
          </div>
          {shown.state === 'running' || shown.steps_total ? (
            <div className="overall">
              <Bar percent={view ? stepPercent(view) : null} label="Progress on that PC" />
              <span className="muted">
                {shown.steps_total
                  ? `${shown.steps_done} of ${shown.steps_total} steps`
                  : 'Waiting for the installer…'}
                {shown.current_step ? ` · ${shown.current_step}` : ''}
              </span>
            </div>
          ) : null}
          {shown.error ? (
            <Banner tone="crit" icon="error">
              {shown.error}
            </Banner>
          ) : null}
          {view?.rollback ? <RollbackPanel rb={view.rollback} running={active} /> : null}
          {view && view.steps.length ? (
            <Disclosure title="Steps on that PC" open={active}>
              <ol className="timeline">
                {view.steps.map((s) => (
                  <StepRow
                    key={s.id}
                    s={s}
                    onRetry={
                      shown.command.kind === 'install' &&
                      shown.state === 'failed' &&
                      !busy &&
                      online
                        ? () => act(fleetApi.install(node.id, false, shown.command.roles))
                        : undefined
                    }
                  />
                ))}
              </ol>
            </Disclosure>
          ) : null}
          {(view?.failure ?? view?.steps.find((x) => x.failure)?.failure) ? (
            <FailureBanner run={view} />
          ) : null}
          {view && view.output.length ? (
            <Disclosure
              title={`Log from that PC (${view.output.length} lines)`}
              open={shown.state === 'failed'}
            >
              <LogView lines={view.output} />
            </Disclosure>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
