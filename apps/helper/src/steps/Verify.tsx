import { useState } from 'react';
import { asSetupError, setupApi } from '../api';
import type { SetupError } from '../api';
import { applyMsg, checkLines, emptyRun } from '../progress';
import type { RunView } from '../progress';
import { Badge, ErrorBox, Icon, Spinner } from '../ui';
import type { Tone } from '../ui';

const TONE: Record<string, Tone> = { pass: 'ok', warn: 'warn', fail: 'crit', pending: 'info' };

export function VerifyStep({ installRun, onNext }: { installRun: RunView; onNext: () => void }) {
  const [recheck, setRecheck] = useState<RunView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SetupError | null>(null);

  const view = recheck ?? installRun;
  const lines = checkLines(view);
  const c = view.checks;

  const again = () => {
    setBusy(true);
    setError(null);
    setRecheck(emptyRun);
    setupApi
      .runCheck((m) => setRecheck((v) => applyMsg(v ?? emptyRun, m)))
      .catch((e) => setError(asSetupError(e)))
      .finally(() => setBusy(false));
  };

  return (
    <section className="step" aria-labelledby="verify-title">
      <header className="step-head">
        <h1 id="verify-title">Verification</h1>
        <p className="lead">
          The same checks as <code>lefi check</code>
          {recheck ? ', run again just now' : ', from the end of the install'}.
        </p>
      </header>

      {c ? (
        <div className="summary">
          <Badge tone="ok">{c.pass} PASS</Badge>
          <Badge tone="warn">{c.warn} WARN</Badge>
          <Badge tone="crit">{c.fail} FAIL</Badge>
          {c.pending ? <Badge tone="info">{c.pending} PENDING</Badge> : null}
        </div>
      ) : null}
      {busy ? <Spinner label="Running the checks…" /> : null}
      {error ? <ErrorBox error={error} title="The checks could not run" /> : null}

      <div className="card">
        {lines.length ? (
          <ul className="checks">
            {lines.map((l, i) => (
              <li key={i} className={`check check-${l.level}`}>
                <Badge tone={TONE[l.level] ?? 'off'}>{l.level.toUpperCase()}</Badge>
                <span>{l.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            {busy ? 'Waiting for results…' : 'No check results were reported.'}
          </p>
        )}
      </div>

      <footer className="actions">
        <button type="button" className="btn" onClick={again} disabled={busy}>
          <Icon name="refresh" /> Run the checks again
        </button>
        <span className="grow" />
        <button type="button" className="btn btn-primary" onClick={onNext} disabled={busy}>
          Finish <Icon name="arrow_forward" />
        </button>
      </footer>
    </section>
  );
}
