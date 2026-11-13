import { useState } from 'react';
import { asSetupError } from '../api';
import type { ActivationStatus, SetupContext, SetupError } from '../api';
import { consoleApi } from '../console';
import { applyMsg, emptyRun, firstFailure, stepPercent } from '../progress';
import type { RunView } from '../progress';
import { Banner, Bar, ErrorBox, Icon } from '../ui';
import { AdminFields, useAdminAuth } from './AdminFields';
import { EraseEverything } from './Erase';
import { StepRow } from './Install';
import { UpdatesView } from './Updates';

const MIN_PASSWORD = 10;

function ChangePassword() {
  const admin = useAdminAuth();
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<SetupError | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const problem =
    next && next.length < MIN_PASSWORD
      ? `At least ${MIN_PASSWORD} characters.`
      : again && next !== again
        ? 'The two new passwords differ.'
        : null;
  const submit = () => {
    if (!admin.auth) return;
    setBusy(true);
    setError(null);
    setDone(false);
    consoleApi
      .changePassword(admin.auth, next)
      .then(
        () => {
          setDone(true);
          setNext('');
          setAgain('');
          admin.clear();
        },
        (e) => setError(asSetupError(e)),
      )
      .finally(() => setBusy(false));
  };
  if (!admin.required) return null;
  return (
    <div className="card">
      <h2 className="card-title">
        <Icon name="key" /> Administrator password
      </h2>
      <p className="muted">
        The same one for Lefi Desktop and for removing things here. Other sessions of this account
        are signed out.
      </p>
      <AdminFields a={admin} />
      <div className="admin-fields">
        <label className="field">
          <span className="field-label">New password</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">New password again</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
        </label>
      </div>
      {error ? <ErrorBox error={error} title="Not changed" /> : null}
      {done ? (
        <Banner tone="ok" icon="verified">
          Password changed.
        </Banner>
      ) : null}
      <div className="row-end">
        {problem ? <span className="problem">{problem}</span> : null}
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !admin.ready || !next || !!problem || next !== again}
          onClick={submit}
        >
          Change the password
        </button>
      </div>
    </div>
  );
}

function Uninstall({ onUninstalled }: { onUninstalled: () => void }) {
  const admin = useAdminAuth();
  const [open, setOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [run, setRun] = useState<RunView | null>(null);
  const [error, setError] = useState<SetupError | null>(null);
  const [state, setState] = useState<'idle' | 'running' | 'done'>('idle');
  const failure = run ? firstFailure(run) : undefined;

  const start = () => {
    setError(null);
    setRun(emptyRun);
    setState('running');
    consoleApi
      .uninstall(admin.auth, (m) => setRun((v) => applyMsg(v ?? emptyRun, m)))
      .then(
        (r) => {
          admin.clear();
          setState(r.exit_code === 0 ? 'done' : 'idle');
        },
        (e) => {
          setRun(null);
          setError(asSetupError(e));
          setState('idle');
        },
      );
  };

  return (
    <div className="card card-danger">
      <h2 className="card-title">
        <Icon name="delete_forever" /> Uninstall Lefi Crop from this PC
      </h2>
      <p className="muted">
        Removes Lefi Brain, the broker, Lefi Gateway, Lefi Desktop and what the installations added.
        Homebrew and anything that was here before stay. Your licence stays too: installing again
        needs no new activation code.
      </p>
      {state === 'done' ? (
        <>
          <Banner tone="ok" icon="verified">
            <strong>Lefi Crop was removed from this PC.</strong>
          </Banner>
          <div className="row-end">
            <button type="button" className="btn btn-primary" onClick={onUninstalled}>
              Start again
            </button>
          </div>
        </>
      ) : !open ? (
        <div className="row-end">
          <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>
            Uninstall…
          </button>
        </div>
      ) : (
        <div className="confirm" role="alertdialog">
          <p>
            <strong>This deletes the database, with every reading, alert and user.</strong> It
            cannot be undone. The other nodes keep what they have installed and must join again:
            remove their components first in Nodes if you do not want them.
          </p>
          <AdminFields a={admin} />
          <label className="toggle">
            <input
              type="checkbox"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
            />
            <span>
              <span className="toggle-label">I understand that all the data is deleted</span>
            </span>
          </label>
          {error ? <ErrorBox error={error} title="Not uninstalled" /> : null}
          {failure ? (
            <Banner tone="crit" icon="error">
              <strong>{failure.message}</strong>
              {failure.hint ? <p>{failure.hint}</p> : null}
            </Banner>
          ) : null}
          {run?.started ? (
            <>
              <Bar percent={stepPercent(run)} label="Uninstall progress" />
              <ol className="timeline">
                {run.steps.map((s) => (
                  <StepRow key={s.id} s={s} />
                ))}
              </ol>
            </>
          ) : null}
          <div className="row-end">
            <button
              type="button"
              className="btn"
              disabled={state === 'running'}
              onClick={() => setOpen(false)}
            >
              Back
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={state === 'running' || !understood || !admin.ready}
              onClick={start}
            >
              {state === 'running' ? 'Uninstalling…' : 'Uninstall everything'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function SettingsView({
  ctx,
  activation,
  pendingUpdates,
  onRunSetup,
  onUninstalled,
}: {
  ctx: SetupContext;
  activation: ActivationStatus;
  pendingUpdates: number;
  onRunSetup: () => void;
  onUninstalled: () => void;
}) {
  const lic = activation.licence;
  const [tab, setTab] = useState<'general' | 'updates'>('general');
  return (
    <section className="step" aria-labelledby="settings-title">
      <header className="step-head">
        <h1 id="settings-title">Settings</h1>
      </header>
      <div className="tabs" role="tablist" aria-label="Settings sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'general'}
          className={`tab ${tab === 'general' ? 'tab-on' : ''}`}
          onClick={() => setTab('general')}
        >
          General
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'updates'}
          className={`tab ${tab === 'updates' ? 'tab-on' : ''}`}
          onClick={() => setTab('updates')}
        >
          Updates
          {pendingUpdates ? <span className="tab-badge">{pendingUpdates}</span> : null}
        </button>
      </div>
      {tab === 'updates' ? (
        <UpdatesView ctx={ctx} />
      ) : (
        <>
          <ChangePassword />
          <div className="card">
            <h2 className="card-title">
              <Icon name="badge" /> This installation
            </h2>
            <p className="muted">
              Installation {activation.installation_id}
              {lic
                ? ` · ${lic.customer} · up to ${lic.max_pcs} nodes · support until ${lic.support_until}`
                : ''}
            </p>
            <div className="row-end">
              <button type="button" className="btn" onClick={onRunSetup}>
                <Icon name="tune" /> Change what this PC runs
              </button>
            </div>
          </div>
          <Uninstall onUninstalled={onUninstalled} />
          <EraseEverything />
        </>
      )}
    </section>
  );
}
