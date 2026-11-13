import { useEffect, useState } from 'react';
import { mascots } from '@lefi/ui';
import { asSetupError } from '../api';
import type { SetupError } from '../api';
import { consoleApi, credentialsText } from '../console';
import type { Credentials, Login } from '../console';
import { nextStepLines } from '../progress';
import type { RunView } from '../progress';
import { Banner, Badge, ErrorBox, Icon, Spinner } from '../ui';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-small"
      aria-label={label}
      onClick={() =>
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
    >
      <Icon name={done ? 'check' : 'content_copy'} />
    </button>
  );
}

function CredentialRow({ c }: { c: Login }) {
  return (
    <tr>
      <td className="cred-user">{c.username}</td>
      <td className="cred-pass">
        <code>{c.password}</code>
      </td>
      <td>
        <CopyButton text={c.password} label={`Copy the password of ${c.username}`} />
      </td>
    </tr>
  );
}

export function FinishStep({ run, onFinished }: { run: RunView; onFinished: () => void }) {
  const lines = nextStepLines(run.output).filter((l) => !l.startsWith('Credentials:'));
  const failures = run.checks?.fail ?? 0;
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [error, setError] = useState<SetupError | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    consoleApi.credentials().then(setCreds, (e) => setError(asSetupError(e)));
  }, []);

  const hasAny = !!creds && (!!creds.admin || creds.devices.length > 0);
  const finish = () => {
    setBusy(true);
    setError(null);
    consoleApi
      .finish()
      .then(onFinished, (e) => setError(asSetupError(e)))
      .finally(() => setBusy(false));
  };

  return (
    <section className="step" aria-labelledby="finish-title">
      <div className="hero">
        <img className="hero-mascot" src={failures ? mascots.caring : mascots.celebrating} alt="" />
        <div>
          <h1 id="finish-title">
            {failures ? 'Installed, with checks to fix' : 'Lefi Crop is installed'}
          </h1>
          <p className="lead">
            {failures
              ? `${failures} check${failures > 1 ? 's' : ''} failed. You can fix them after setup, from Status.`
              : 'The services are registered and will start again on their own.'}
          </p>
        </div>
      </div>

      {!creds && !error ? <Spinner label="Reading the credentials…" /> : null}

      {hasAny && creds ? (
        <div className="card card-attention">
          <h2 className="card-title">
            <Icon name="key" /> Save these credentials now
          </h2>
          <Banner tone="warn" icon="warning">
            <strong>They are shown only here.</strong> Once you continue, this screen does not come
            back. Keep them in a password manager.
          </Banner>
          <div className="row-end">
            <CopyButton text={credentialsText(creds)} label="Copy all the credentials" />
            <span className="muted">Copy everything</span>
          </div>
          {creds.admin ? (
            <>
              <h3 className="details-title">
                Super administrator <Badge tone="info">Highest role</Badge>
              </h3>
              <p className="muted">
                To sign in to Lefi Desktop, which asks for a new password the first time, and to
                remove or uninstall anything in Lefi Crop Helper.
              </p>
              <table className="creds">
                <tbody>
                  <CredentialRow c={creds.admin} />
                </tbody>
              </table>
            </>
          ) : null}
          {creds.devices.length ? (
            <>
              <h3 className="details-title">MQTT devices</h3>
              <p className="muted">
                For Lefi Brain, the simulators, and the firmware of each ESP32. The ESP32 passwords
                are needed when you flash a board.
              </p>
              <table className="creds">
                <tbody>
                  {creds.devices.map((d) => (
                    <CredentialRow key={d.username} c={d} />
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </div>
      ) : null}

      {lines.length ? (
        <div className="card">
          <h2 className="card-title">
            <Icon name="folder_open" /> Where things are
          </h2>
          <ul className="plain-list mono">
            {lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <ErrorBox error={error} title="Setup is not finished" /> : null}

      {creds && hasAny ? (
        <label className="toggle">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <span>
            <span className="toggle-label">I saved the credentials</span>
            <span className="toggle-help">I understand they are not shown again.</span>
          </span>
        </label>
      ) : null}

      <footer className="actions">
        <span className="grow" />
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !creds || (hasAny && !saved)}
          onClick={finish}
        >
          {busy ? 'Finishing…' : 'Finish setup and continue'} <Icon name="arrow_forward" />
        </button>
      </footer>
    </section>
  );
}
