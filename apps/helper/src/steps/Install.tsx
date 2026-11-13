import { useState } from 'react';
import type { SetupError } from '../api';
import { firstFailure, fmtBytes, rollbackAttention, stepPercent, wasCancelled } from '../progress';
import type { RollbackView, RunView, StepView } from '../progress';
import { Banner, Bar, Disclosure, ErrorBox, Icon, LogView, Spinner } from '../ui';

const STATE_ICON: Record<StepView['state'], string> = {
  pending: 'radio_button_unchecked',
  running: 'progress_activity',
  ok: 'check_circle',
  skipped: 'do_not_disturb_on',
  failed: 'cancel',
  cancelled: 'block',
};

const ITEM_ICON: Record<string, string> = {
  ok: 'check_circle',
  skipped: 'do_not_disturb_on',
  failed: 'cancel',
};

export function StepRow({ s, onRetry }: { s: StepView; onRetry?: () => void }) {
  const p = s.progress;
  const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : null;
  const lastLog = s.state === 'running' ? s.logs.at(-1)?.message : undefined;
  return (
    <li className={`tl tl-${s.state}`}>
      <span className="tl-slot">
        {s.state === 'running' ? (
          <span className="tl-spinner" aria-hidden="true" />
        ) : (
          <Icon name={STATE_ICON[s.state]} className="tl-icon" />
        )}
      </span>
      <div className="tl-body">
        <div className="tl-title-row">
          <div className="tl-title">
            {s.title}
            {s.state === 'skipped' ? (
              <span className="muted"> — skipped{s.reason ? `: ${s.reason}` : ''}</span>
            ) : null}
            {s.state === 'cancelled' ? <span className="muted"> — cancelled</span> : null}
          </div>
          {s.state === 'failed' && onRetry ? (
            <button type="button" className="btn btn-small" onClick={onRetry}>
              <Icon name="refresh" /> Retry
            </button>
          ) : null}
        </div>
        {s.state === 'failed' && s.failure ? (
          <div className="tl-fail">
            <div>{s.failure.message}</div>
            {s.failure.hint ? <div className="tl-fix">{s.failure.hint}</div> : null}
          </div>
        ) : null}
        {p && s.state === 'running' ? (
          <div className="tl-progress">
            <Bar percent={pct} label={`${s.title} progress`} />
            <span className="muted">
              {p.unit === 'bytes'
                ? `${fmtBytes(p.done)} of ${fmtBytes(p.total)}`
                : `${p.done} of ${p.total} ${p.unit}`}
            </span>
          </div>
        ) : null}
        {lastLog ? <div className="tl-log">{lastLog}</div> : null}
        {s.warnings.map((w, i) => (
          <div key={i} className="tl-warn">
            <Icon name="warning" /> {w}
          </div>
        ))}
      </div>
    </li>
  );
}

/** Progress and outcome of undoing this run's changes (ADR-032). */
export function RollbackPanel({ rb, running }: { rb: RollbackView; running: boolean }) {
  const done = rb.items.length;
  const pct = rb.total ? Math.round((done / rb.total) * 100) : null;
  const attention = rollbackAttention(rb);
  return (
    <div className="card" aria-live="polite">
      <h2 className="card-title">
        <Icon name="settings_backup_restore" /> Undoing the changes
      </h2>
      {rb.result === undefined ? (
        <div className="overall">
          <Bar percent={pct} label="Rollback progress" />
          <span className="muted">
            {rb.total ? `${done} of ${rb.total} changes undone` : 'Reading what this run changed…'}
          </span>
        </div>
      ) : null}
      {rb.result === 'ok' ? (
        <Banner tone="ok" icon="verified">
          Everything this installation changed on this PC was undone ({rb.ok ?? 0} changes).
          Software that was already here before was left as it was.
        </Banner>
      ) : null}
      {rb.result === 'nothing' ? (
        <Banner tone="info" icon="info">
          There was nothing to undo.
        </Banner>
      ) : null}
      {rb.result === 'partial' ? (
        <Banner tone="warn" icon="warning">
          {rb.failed ?? 0} change(s) could not be undone automatically. They are listed below with
          what to do.
        </Banner>
      ) : null}
      {attention.length ? (
        <ul className="rb-list rb-attention">
          {attention.map((i, k) => (
            <li key={k} className={`rb rb-${i.result}`}>
              <Icon name={i.result === 'failed' ? 'cancel' : 'front_hand'} />
              <span>
                <strong>{i.label}</strong>
                {i.message ? ` — ${i.message}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <Disclosure title={`Every change (${done})`} open={running && done < 12}>
        <ul className="rb-list">
          {rb.items.map((i, k) => (
            <li key={k} className={`rb rb-${i.result}`}>
              <Icon name={ITEM_ICON[i.result] ?? 'help'} />
              <span>
                {i.label}
                {i.message ? <span className="muted"> — {i.message}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </Disclosure>
      {rb.report && rb.result !== undefined ? (
        <p className="muted">
          Report: <code>{rb.report}</code>
        </p>
      ) : null}
    </div>
  );
}

export function InstallStep({
  run,
  state,
  error,
  exitCode,
  cancelRequested,
  onCancel,
  undo,
  undoState,
  undoError,
  onUndo,
  onRetry,
  onRetryNow,
  onNext,
  allowUndo = true,
}: {
  run: RunView;
  state: 'idle' | 'running' | 'done';
  error: SetupError | null;
  exitCode: number | null;
  cancelRequested: boolean;
  onCancel: () => void;
  /** The separate `--rollback` run started with "Undo the changes" after a failure. */
  undo: RunView | null;
  undoState: 'idle' | 'running' | 'done';
  undoError: SetupError | null;
  onUndo: () => void;
  onRetry: () => void;
  /** Runs the same installation again: done steps are checked and skipped, not redone. */
  onRetryNow: () => void;
  /** After setup, changes are undone from Apps or Settings, with the administrator's password. */
  allowUndo?: boolean;
  onNext: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const pct = stepPercent(run);
  const failure = firstFailure(run);
  const done = state === 'done';
  const cancelled = done && wasCancelled(run);
  const rolledBack = cancelled || undoState === 'done';
  // Undo chosen on reopening: there is no run on this screen, only the undo.
  const undoOnly = state === 'idle' && undoState !== 'idle';
  const finishedOk = done && !error && run.result === 'ok';
  // A run that reached verification but some checks failed is reported on the Verify screen.
  const verifiedWithFailures =
    done && !error && run.result === 'failed' && !failure && !!run.checks;
  const canUndo = allowUndo && done && !finishedOk && !cancelled && undoState === 'idle';
  const rollingBack = (state === 'running' && !!run.rollback) || undoState === 'running';

  return (
    <section className="step" aria-labelledby="install-title">
      <header className="step-head">
        <h1 id="install-title">
          {cancelled
            ? 'Installation cancelled'
            : rollingBack
              ? 'Undoing…'
              : undoOnly
                ? 'Changes undone'
                : 'Installing'}
        </h1>
        <p className="lead">
          {state === 'running' && !cancelRequested
            ? 'Keep this window open until the installer finishes.'
            : null}
          {state === 'running' && cancelRequested && !run.rollback
            ? 'Stopping at the next safe point (the current step finishes first, a download stops right away)…'
            : null}
          {finishedOk ? `Finished in ${run.durationS ?? '?'} s.` : null}
        </p>
      </header>

      {undoOnly ? null : (
        <div className="card">
          <div className="overall">
            <Bar percent={pct} label="Installation progress" />
            <span className="muted">
              {run.stepsTotal
                ? `${run.stepsDone} of ${run.stepsTotal} steps`
                : 'Waiting for the installer…'}
            </span>
          </div>
          {!run.started && state === 'running' ? <Spinner label="Starting the installer…" /> : null}
          <ol className="timeline">
            {run.steps.map((s) => (
              <StepRow key={s.id} s={s} onRetry={done && !error ? onRetryNow : undefined} />
            ))}
          </ol>
        </div>
      )}

      {run.rollback ? <RollbackPanel rb={run.rollback} running={state === 'running'} /> : null}
      {undo?.rollback ? (
        <RollbackPanel rb={undo.rollback} running={undoState === 'running'} />
      ) : null}
      {undoState === 'running' && !undo?.rollback ? (
        <Spinner label="Starting the rollback…" />
      ) : null}
      {undoError ? <ErrorBox error={undoError} title="The rollback could not run" /> : null}

      {error ? <ErrorBox error={error} title="The installer could not run" /> : null}
      {done && failure && !failure.step ? (
        <ErrorBox
          title={`Stopped${failure.step ? ` at “${failure.step}”` : ''}`}
          error={{
            code: failure.code || 'STEP_FAILED',
            message: failure.message,
            hint: failure.hint,
          }}
        />
      ) : null}
      {done && !error && !failure && !cancelled && !finishedOk && !verifiedWithFailures ? (
        <Banner tone="crit" icon="error">
          The installer ended with exit code {String(exitCode)} ({run.result ?? 'no result'}). The
          output below says why.
        </Banner>
      ) : null}
      {canUndo && !verifiedWithFailures ? (
        <Banner tone="info" icon="settings_backup_restore">
          The changes made before the problem are still on this PC. You can undo them, or fix the
          problem and install again.
        </Banner>
      ) : null}
      {verifiedWithFailures ? (
        <Banner tone="warn" icon="rule">
          The installation finished but some checks failed. The next screen lists them.
        </Banner>
      ) : null}
      {run.log && done && !rolledBack ? (
        <p className="muted">
          Full log: <code>{run.log}</code>
        </p>
      ) : null}

      {undoOnly ? null : (
        <Disclosure
          title={`Installer output (${run.output.length} lines)`}
          open={done && !finishedOk && !rolledBack}
        >
          <LogView lines={run.output} />
        </Disclosure>
      )}

      {confirming && state === 'running' && !cancelRequested ? (
        <div className="confirm" role="alertdialog" aria-labelledby="cancel-q">
          <p id="cancel-q">
            <strong>Stop the installation and undo everything it changed so far?</strong> Software
            that was on this PC before is kept.
          </p>
          <div className="row-end">
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              Keep installing
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                setConfirming(false);
                onCancel();
              }}
            >
              <Icon name="block" /> Cancel and undo
            </button>
          </div>
        </div>
      ) : null}

      <footer className="actions">
        {state === 'running' ? (
          <button
            type="button"
            className="btn"
            disabled={cancelRequested}
            onClick={() => setConfirming(true)}
          >
            <Icon name="block" /> {cancelRequested ? 'Cancelling…' : 'Cancel'}
          </button>
        ) : null}
        {canUndo ? (
          <button type="button" className="btn" onClick={onUndo}>
            <Icon name="settings_backup_restore" /> Undo the changes
          </button>
        ) : null}
        <span className="grow" />
        {(done && !finishedOk && !verifiedWithFailures && undoState !== 'running') ||
        undoState === 'done' ? (
          <button type="button" className="btn" onClick={onRetry}>
            <Icon name="undo" /> Back to the plan
          </button>
        ) : null}
        {!rolledBack ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!finishedOk && !verifiedWithFailures}
            onClick={onNext}
          >
            See the checks <Icon name="arrow_forward" />
          </button>
        ) : null}
      </footer>
    </section>
  );
}
