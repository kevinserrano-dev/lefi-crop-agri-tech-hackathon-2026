import { useEffect, useState } from 'react';
import { asSetupError, setupApi } from '../api';
import type { PlanPreview, SetupAnswers, SetupContext, SetupError } from '../api';
import { firstFailure, fromEvents } from '../progress';
import { Banner, Disclosure, ErrorBox, Icon, LogView, Spinner } from '../ui';

export function PlanStep({
  ctx,
  installAllowed,
  answers,
  plan,
  onPlan,
  onBack,
  onInstall,
}: {
  ctx: SetupContext;
  installAllowed: boolean;
  answers: SetupAnswers;
  plan: PlanPreview | null;
  onPlan: (p: PlanPreview) => void;
  onBack: () => void;
  onInstall: () => void;
}) {
  // The error belongs to the answers it was produced for; new answers clear it.
  const [failed, setFailed] = useState<{ for: SetupAnswers; error: SetupError } | null>(null);
  const error = failed?.for === answers ? failed.error : null;
  const busy = !plan && !error;

  useEffect(() => {
    if (plan) return;
    let alive = true;
    setupApi.previewPlan(answers).then(
      (p) => {
        if (alive) onPlan(p);
      },
      (e) => {
        if (alive) setFailed({ for: answers, error: asSetupError(e) });
      },
    );
    return () => {
      alive = false;
    };
  }, [answers, plan, onPlan]);

  const view = plan ? fromEvents(plan.events, plan.output) : null;
  const failure = view ? firstFailure(view) : undefined;
  const ok = !!plan && plan.exit_code === 0 && view?.result === 'ok' && !failure;
  const systemInstall = ctx.os === 'linux' && answers.service_mode !== 'user';

  return (
    <section className="step" aria-labelledby="plan-title">
      <header className="step-head">
        <h1 id="plan-title">The plan</h1>
        <p className="lead">
          From a dry run of the installer with your answers. Nothing on this PC has changed yet.
        </p>
      </header>

      {busy ? <Spinner label="Asking the installer for its plan (dry run)…" /> : null}
      {error ? <ErrorBox error={error} title="The plan could not be prepared" /> : null}
      {failure ? (
        <ErrorBox
          title={`The installer would stop${failure.step ? ` at “${failure.step}”` : ''}`}
          error={{
            code: failure.code || 'STEP_FAILED',
            message: failure.message,
            hint: failure.hint,
          }}
        />
      ) : null}
      {plan && !ok && !failure ? (
        <Banner tone="crit" icon="error">
          The dry run ended with exit code {String(plan.exit_code)} ({view?.result ?? 'no result'}).
          See the installer output below.
        </Banner>
      ) : null}

      {view?.started ? (
        <div className="card">
          <h2 className="card-title">
            <Icon name="checklist" /> {view.stepsTotal} steps · roles {view.roles}
          </h2>
          <ol className="plan-list">
            {view.steps.map((s) => (
              <li key={s.id}>
                <span className="plan-title">{s.title}</span>
                {s.state === 'skipped' && s.reason ? (
                  <span className="muted"> — {s.reason}</span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {plan ? (
        <div className="card">
          <h2 className="card-title">
            <Icon name="info" /> Before you start
          </h2>
          <ul className="plain-list">
            <li>Internet is needed during the install to download the tools and the model.</li>
            {answers.roles.includes('ai') ? (
              <li>The model download is several GB; its progress is shown in real bytes.</li>
            ) : null}
            {systemInstall && ctx.needs_elevation ? (
              <li>
                Your system will ask for an administrator password: Lefi Crop installs system
                services that start at boot.
              </li>
            ) : null}
            {ctx.os === 'macos' ? (
              <li>
                If Homebrew is missing, its installer needs an administrator password; that is not
                handled from this window yet.
              </li>
            ) : null}
            {answers.stop_conflicting_services ? (
              <li>Other services holding Lefi Crop’s ports will be stopped.</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {plan ? (
        <>
          <Disclosure title="Installer output (dry run)">
            <LogView lines={plan.output} />
          </Disclosure>
          <Disclosure title="Answers file sent to the installer">
            <LogView lines={plan.answers.trimEnd().split('\n')} />
          </Disclosure>
        </>
      ) : null}

      {ctx.install_blocked_reason ? (
        <Banner tone="warn" icon="lock">
          {ctx.install_blocked_reason}
        </Banner>
      ) : null}

      <footer className="actions">
        <button type="button" className="btn" onClick={onBack}>
          Back
        </button>
        <span className="grow" />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!ok || !installAllowed}
          onClick={onInstall}
        >
          <Icon name="download" /> Install
        </button>
      </footer>
    </section>
  );
}
