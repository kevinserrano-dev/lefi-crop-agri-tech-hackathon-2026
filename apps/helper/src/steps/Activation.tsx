import { useState } from 'react';
import { asSetupError, setupApi } from '../api';
import type { ActivationStatus, SetupContext, SetupError } from '../api';
import { Badge, Banner, ErrorBox, Icon } from '../ui';

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ActivationStep({
  ctx,
  status,
  onStatus,
  onBack,
  onNext,
}: {
  ctx: SetupContext;
  status: ActivationStatus;
  onStatus: (s: ActivationStatus) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SetupError | null>(null);
  const [copied, setCopied] = useState(false);
  const lic = status.licence;
  const supportEnded = !!lic && lic.support_until < todayUtc();

  const submit = () => {
    setBusy(true);
    setError(null);
    setupApi
      .activate(code)
      .then(
        (s) => {
          onStatus(s);
          setCode('');
        },
        (e) => setError(asSetupError(e)),
      )
      .finally(() => setBusy(false));
  };

  const copy = () => {
    void navigator.clipboard?.writeText(status.installation_id).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <section className="step" aria-labelledby="activation-title">
      <header className="step-head">
        <h1 id="activation-title">Activate Lefi Crop</h1>
        <p className="lead">
          Each installation is activated by Lefi. The code is checked here, on this PC, without
          internet.
        </p>
      </header>

      {!ctx.debug_build && !status.production_key_embedded ? (
        <Banner tone="crit" icon="key_off">
          This build of Lefi Crop Helper contains no Lefi licence key, so it cannot be activated.
          Use an official build.
        </Banner>
      ) : null}

      <div className="card">
        <h2 className="card-title">
          <Icon name="fingerprint" /> Installation id
        </h2>
        <div className="install-id-row">
          <code className="install-id" aria-label="Installation id">
            {status.installation_id}
          </code>
          <button type="button" className="btn" onClick={copy}>
            <Icon name={copied ? 'check' : 'content_copy'} /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="muted">
          Send this id and your purchase reference to Lefi. The code you receive works only for this
          installation. The id comes from this installation’s own certificate authority, created on
          this PC; it is not a hardware serial number.
        </p>
      </div>

      {lic ? (
        <div className="card card-ok">
          <h2 className="card-title">
            <Icon name="verified" /> Activated{' '}
            {status.development_licence ? <Badge tone="sim">Development code</Badge> : null}
          </h2>
          <dl className="licence">
            <dt>Customer</dt>
            <dd>{lic.customer}</dd>
            <dt>Licence</dt>
            <dd>
              <code>{lic.licence_id}</code> · {lic.edition}
            </dd>
            <dt>PCs included</dt>
            <dd>{lic.max_pcs} (this PC included)</dd>
            <dt>Support until</dt>
            <dd>
              {lic.support_until}{' '}
              {supportEnded ? <Badge tone="warn">ended</Badge> : <Badge tone="ok">active</Badge>}
            </dd>
          </dl>
          {supportEnded ? (
            <p className="muted">
              With support ended, updates and adding PCs are blocked. Lefi Crop itself, alerts and
              safety functions keep working.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="card">
          <label className="field">
            <span className="field-label">Activation code</span>
            <textarea
              className="input code-input"
              rows={4}
              spellCheck={false}
              autoComplete="off"
              placeholder="LEFI1-…"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <span className="field-help">Paste the whole code from Lefi’s message.</span>
          </label>
          {status.stored_code_problem ? (
            <Banner tone="warn" icon="history">
              A code saved earlier no longer verifies: {status.stored_code_problem}
            </Banner>
          ) : null}
          {error ? <ErrorBox error={error} title="The code was not accepted" /> : null}
          <div className="row-end">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !code.trim()}
              onClick={submit}
            >
              <Icon name="key" /> {busy ? 'Checking…' : 'Activate'}
            </button>
          </div>
        </div>
      )}

      {ctx.hackathon_build && !lic ? (
        <div className="dev-options">
          <span className="dev-options-title">Hackathon build</span>
          <p className="muted">
            This package was made for the competition's judges: no activation code is needed. It
            activates this installation for up to 10 PCs.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              setupApi.skipActivation().then(onStatus, (e) => setError(asSetupError(e)))
            }
          >
            <Icon name="key" /> Activate for the hackathon
          </button>
        </div>
      ) : null}

      {ctx.debug_build && !ctx.hackathon_build && !lic ? (
        <div className="dev-options">
          <span className="dev-options-title">Development build only</span>
          <p className="muted">
            Issue a test code with{' '}
            <code>lefi-license issue --dev --installation {status.installation_id} …</code>, or
            continue without one for this session.
          </p>
          <button
            type="button"
            className="btn"
            disabled={status.dev_skipped}
            onClick={() =>
              setupApi.skipActivation().then(onStatus, (e) => setError(asSetupError(e)))
            }
          >
            {status.dev_skipped ? 'Skipped for this session' : 'Continue without activation'}
          </button>
        </div>
      ) : null}

      <footer className="actions">
        <button type="button" className="btn" onClick={onBack}>
          Back
        </button>
        <span className="grow" />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!lic && !(ctx.debug_build && status.dev_skipped)}
          onClick={onNext}
        >
          Scan this PC <Icon name="arrow_forward" />
        </button>
      </footer>
    </section>
  );
}
