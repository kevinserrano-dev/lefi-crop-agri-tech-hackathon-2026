import { useCallback, useEffect, useState } from 'react';
import { logos, mascots } from '@lefi/ui';
import { asSetupError, canInstall, isTauri, setupApi } from './api';
import type {
  ActivationStatus,
  InstallerMsg,
  PlanPreview,
  SetupAnswers,
  SetupContext,
  SetupError,
} from './api';
import type { HwReport } from './hw';
import { FLEET_GUIDE, GUIDE, ROLLBACK_GUIDE, STEPS } from './messages';
import type { StepId } from './messages';
import { applyMsg, emptyRun } from './progress';
import type { RunView } from './progress';
import { Banner, ErrorBox, Icon, Spinner } from './ui';
import { WelcomeStep } from './steps/Welcome';
import { ActivationStep } from './steps/Activation';
import { ScanStep } from './steps/Scan';
import { RolesStep } from './steps/Roles';
import { PlanStep } from './steps/Plan';
import { InstallStep } from './steps/Install';
import { VerifyStep } from './steps/Verify';
import { FinishStep } from './steps/Finish';
import { StatusView } from './steps/Status';
import { AppsView } from './steps/Apps';
import { BackupsView } from './steps/Backups';
import { SettingsView } from './steps/Settings';
import { consoleApi } from './console';
import { FleetView } from './steps/Fleet';
import { notifyNew, pending, updatesApi } from './updates';
import { needsDecision, type InstallSession } from './resume';
import { ResumeStep, SessionOkNote } from './steps/Resume';

function defaultAnswers(ctx: SetupContext, hw: HwReport): SetupAnswers {
  const aiViable = hw.recommendation.verdict !== 'not_viable';
  return {
    roles: aiViable ? ['ai', 'core', 'admin'] : ['core', 'admin'],
    model: 'recommended',
    ai_url: aiViable ? null : '',
    ai_lan: false,
    admin_https: true,
    stop_conflicting_services: true,
    update_model: false,
    service_mode: ctx.os === 'linux' ? 'systemd' : null,
    dev_allow_no_ai: false,
  };
}

export function App() {
  const [ctx, setCtx] = useState<SetupContext | null>(null);
  const [ctxError, setCtxError] = useState<SetupError | null>(null);
  const [activation, setActivation] = useState<ActivationStatus | null>(null);
  const [step, setStep] = useState<StepId>('welcome');
  const [hw, setHw] = useState<HwReport | null>(null);
  const [answers, setAnswers] = useState<SetupAnswers | null>(null);
  const [plan, setPlan] = useState<PlanPreview | null>(null);
  const [run, setRun] = useState<RunView>(emptyRun);
  const [installState, setInstallState] = useState<'idle' | 'running' | 'done'>('idle');
  const [installError, setInstallError] = useState<SetupError | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const [view, setView] = useState<'wizard' | 'fleet' | 'status' | 'apps' | 'backups' | 'settings'>(
    'wizard',
  );
  // After "Finish setup and continue" this app is the console of the installation (ADR-043).
  const [finished, setFinished] = useState(false);
  const [sealed, setSealed] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [undo, setUndo] = useState<RunView | null>(null);
  const [undoState, setUndoState] = useState<'idle' | 'running' | 'done'>('idle');
  const [undoError, setUndoError] = useState<SetupError | null>(null);
  const [session, setSession] = useState<InstallSession | null>(null);
  const [sessionHandled, setSessionHandled] = useState(false);

  const resetUndo = () => {
    setCancelRequested(false);
    setUndo(null);
    setUndoState('idle');
    setUndoError(null);
  };

  useEffect(() => {
    if (!isTauri()) return;
    setupApi
      .context()
      .then((c) => {
        setCtx(c);
        return setupApi.activationStatus();
      })
      .then((a) => {
        setActivation(a);
        // Reopened after activating: say so instead of starting from the welcome screen again.
        if (a.licence) setStep('activation');
        // Only the offer to continue depends on this: it never stops the app.
        void consoleApi.state().then(
          (c) => {
            if (c.finished) {
              setFinished(true);
              setSealed(true);
              setView('status');
            } else if (c.has_credentials) {
              // Installed, credentials not confirmed yet: they must not be lost.
              setStep('finish');
              setSessionHandled(true);
            }
          },
          () => undefined,
        );
        return setupApi.installSession().then(setSession, () => setSession(null));
      })
      .catch((e) => setCtxError(asSetupError(e)));
    const off = setupApi.onCloseBlocked(() => setCloseBlocked(true));
    return () => {
      void off.then((f) => f());
    };
  }, []);

  // An installer that outlived the app: follow it until it ends, then ask what to do.
  const stillRunning = session?.state === 'still_running';
  useEffect(() => {
    if (!stillRunning) return;
    const t = setInterval(() => void setupApi.installSession().then(setSession), 3000);
    return () => clearInterval(t);
  }, [stillRunning]);

  // Updates (ADR-035): while Lefi Crop Helper is open, look every 5 minutes, notify once per item,
  // and apply a Lefi Desktop update by itself only when the setting allows it.
  const licensed = !!activation?.licence;
  useEffect(() => {
    if (!isTauri() || !licensed) return;
    let alive = true;
    const check = async () => {
      try {
        const s = await updatesApi.status();
        if (!alive) return;
        setPendingCount(pending(s).length);
        await notifyNew(s);
        const auto = (await updatesApi.settings()).auto_components;
        const desk = s.components.find((c) => c.component === 'desktop' && c.outdated);
        if (auto && desk) {
          await setupApi.runInstall(
            {
              roles: ['desktop'],
              model: 'recommended',
              ai_url: null,
              ai_lan: false,
              admin_https: false,
              stop_conflicting_services: false,
              update_model: false,
              service_mode: null,
              dev_allow_no_ai: false,
            },
            () => undefined,
          );
        }
      } catch {
        /* the next check retries */
      }
    };
    void check();
    const t = setInterval(() => void check(), 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [licensed]);

  const onScanned = useCallback(
    (report: HwReport) => {
      setHw(report);
      if (ctx) setAnswers((a) => a ?? defaultAnswers(ctx, report));
    },
    [ctx],
  );

  const startInstallWith = useCallback((a: SetupAnswers) => {
    setSessionHandled(true);
    setRun(emptyRun);
    setInstallError(null);
    setExitCode(null);
    setCancelRequested(false);
    setUndo(null);
    setUndoState('idle');
    setUndoError(null);
    setInstallState('running');
    setStep('install');
    setupApi
      .runInstall(a, (m: InstallerMsg) => setRun((v) => applyMsg(v, m)))
      .then(
        (r) => setExitCode(r.exit_code),
        (e) => setInstallError(asSetupError(e)),
      )
      .finally(() => setInstallState('done'));
  }, []);

  const startInstall = useCallback(() => {
    if (answers) startInstallWith(answers);
  }, [answers, startInstallWith]);

  if (!isTauri()) {
    return (
      <div className="standalone">
        <img src={mascots.curious} alt="" width={120} />
        <h1>Lefi Crop Helper runs as a desktop app</h1>
        <p>It drives the real installer on this PC, so it cannot run in a browser tab.</p>
        <code className="code-chip">pnpm dev:helper</code>
      </div>
    );
  }

  const cancelInstall = () => {
    setCancelRequested(true);
    setupApi.cancelInstall().then(
      (accepted) => {
        if (!accepted) setCancelRequested(false);
      },
      (e) => {
        setCancelRequested(false);
        setInstallError(asSetupError(e));
      },
    );
  };

  const undoChanges = () => {
    setUndo(emptyRun);
    setUndoError(null);
    setUndoState('running');
    setupApi
      .runRollback((m: InstallerMsg) => setUndo((v) => applyMsg(v ?? emptyRun, m)))
      .catch((e) => setUndoError(asSetupError(e)))
      .finally(() => setUndoState('done'));
  };

  const decide =
    needsDecision(session) &&
    !sessionHandled &&
    !finished &&
    !!ctx &&
    !!activation &&
    canInstall(ctx, activation) &&
    view === 'wizard';

  const order = STEPS.map((s) => s.id);
  const current = order.indexOf(step);
  const locked = installState !== 'idle';
  const canVisit = (id: StepId) => {
    const i = order.indexOf(id);
    if (undoState === 'running') return false;
    if (locked) return i >= order.indexOf('install') && i <= current;
    return i < current;
  };
  const failed = installState === 'done' && (installError || exitCode !== 0);
  const undoing = !!run.rollback || undoState !== 'idle';
  const guide =
    view !== 'wizard' ? FLEET_GUIDE : step === 'install' && undoing ? ROLLBACK_GUIDE : GUIDE[step];
  const busy = installState === 'running' || undoState === 'running';

  return (
    <div className="shell">
      <aside className="rail">
        <img className="rail-logo" src={logos.full} alt="Lefi Crop" />
        <p className="rail-product">Helper</p>
        {!finished ? (
          <ol className="rail-steps">
            {STEPS.map((s, i) => {
              const state =
                i < current ? 'done' : i === current && view === 'wizard' ? 'current' : 'todo';
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`rail-step rail-step-${state}`}
                    disabled={!(canVisit(s.id) || (view === 'fleet' && i === current))}
                    aria-current={state === 'current' ? 'step' : undefined}
                    onClick={() => {
                      setView('wizard');
                      setStep(s.id);
                    }}
                  >
                    <Icon name={state === 'done' ? 'check_circle' : s.icon} />
                    {s.label}
                  </button>
                </li>
              );
            })}
          </ol>
        ) : null}
        {finished ? (
          <>
            <button
              type="button"
              className={`rail-step ${view === 'status' ? 'rail-step-current' : 'rail-step-done'}`}
              onClick={() => setView('status')}
            >
              <Icon name="monitor_heart" />
              Status
            </button>
          </>
        ) : (
          <p className="rail-section">After setup</p>
        )}
        <button
          type="button"
          className={`rail-step ${view === 'fleet' ? 'rail-step-current' : 'rail-step-done'}`}
          disabled={!activation?.licence || busy}
          title={activation?.licence ? undefined : 'Activate this PC first'}
          aria-current={view === 'fleet' ? 'page' : undefined}
          onClick={() => setView('fleet')}
        >
          <Icon name="lan" />
          Nodes
        </button>
        {finished ? (
          <button
            type="button"
            className={`rail-step ${view === 'apps' ? 'rail-step-current' : 'rail-step-done'}`}
            onClick={() => setView('apps')}
          >
            <Icon name="apps" />
            Apps
          </button>
        ) : null}
        {finished ? (
          <button
            type="button"
            className={`rail-step ${view === 'backups' ? 'rail-step-current' : 'rail-step-done'}`}
            aria-current={view === 'backups' ? 'page' : undefined}
            onClick={() => setView('backups')}
          >
            <Icon name="backup" />
            Backups
          </button>
        ) : null}
        <button
          type="button"
          className={`rail-step ${view === 'settings' ? 'rail-step-current' : 'rail-step-done'}`}
          disabled={!activation?.licence || busy}
          aria-current={view === 'settings' ? 'page' : undefined}
          onClick={() => setView('settings')}
        >
          <Icon name="settings" />
          Settings
          {pendingCount ? <span className="rail-badge">{pendingCount}</span> : null}
        </button>
        <div className="guide" aria-live="polite">
          <img
            className="guide-mascot"
            key={view === 'wizard' ? step : 'console'}
            src={mascots[failed && step === 'install' && !undoing ? 'sad' : guide.mascot]}
            alt=""
          />
          <p className="guide-line">
            {failed && step === 'install' && !undoing
              ? 'Something stopped the installer. The details below say what and how to fix it.'
              : guide.line}
          </p>
          <span className="guide-tag">Lefi guide · scripted, no AI</span>
        </div>
      </aside>

      <main className="content">
        {ctx?.debug_build ? (
          <div className="dev-ribbon" role="note">
            DEVELOPMENT BUILD · trusts development activation codes · installer from{' '}
            {ctx.payload_root}
            {activation?.dev_skipped && !activation.licence ? ' · ACTIVATION SKIPPED' : ''}
          </div>
        ) : null}
        {closeBlocked && installState === 'running' ? (
          <Banner tone="warn" icon="block">
            The installer is still running. Closing now would interrupt a step halfway; the window
            can be closed when it finishes.
          </Banner>
        ) : null}
        {ctxError ? (
          <ErrorBox error={ctxError} title="Lefi Crop Helper cannot find the installer" />
        ) : null}
        {!ctx && !ctxError ? <Spinner label="Starting…" /> : null}

        {ctx && activation && view === 'fleet' ? (
          <FleetView activated={!!activation.licence} />
        ) : null}
        {view === 'status' ? <StatusView onManage={() => setView('fleet')} /> : null}
        {ctx && view === 'apps' ? <AppsView ctx={ctx} onManage={() => setView('fleet')} /> : null}
        {view === 'backups' ? <BackupsView /> : null}
        {ctx && activation && view === 'settings' ? (
          <SettingsView
            ctx={ctx}
            activation={activation}
            pendingUpdates={pendingCount}
            onRunSetup={() => {
              setFinished(false);
              setStep('scan');
              setView('wizard');
            }}
            onUninstalled={() => {
              setFinished(false);
              setSealed(false);
              setSession(null);
              setSessionHandled(true);
              setStep('activation');
              setView('wizard');
            }}
          />
        ) : null}
        {decide && session ? (
          <ResumeStep
            session={session}
            onContinue={() => {
              if (!session.answers) return;
              setAnswers(session.answers);
              startInstallWith(session.answers);
            }}
            onUndo={() => {
              setSessionHandled(true);
              setAnswers(session.answers);
              setStep('install');
              undoChanges();
            }}
            onLater={() => setSessionHandled(true)}
          />
        ) : null}
        {!decide && ctx && activation && view === 'wizard' ? (
          <>
            {session?.state === 'ok' && step === 'activation' ? <SessionOkNote /> : null}
            {step === 'welcome' && <WelcomeStep ctx={ctx} onNext={() => setStep('activation')} />}
            {step === 'activation' && (
              <ActivationStep
                ctx={ctx}
                status={activation}
                onStatus={setActivation}
                onBack={() => setStep('welcome')}
                onNext={() => setStep('scan')}
              />
            )}
            {step === 'scan' && (
              <ScanStep
                hw={hw}
                onScanned={onScanned}
                onBack={() => setStep('activation')}
                onNext={() => setStep('roles')}
              />
            )}
            {step === 'roles' && hw && answers && (
              <RolesStep
                ctx={ctx}
                hw={hw}
                answers={answers}
                onChange={(a) => {
                  setAnswers(a);
                  setPlan(null);
                }}
                onBack={() => setStep('scan')}
                onNext={() => setStep('plan')}
                onOtherPcs={() => setView('fleet')}
              />
            )}
            {step === 'plan' && answers && (
              <PlanStep
                ctx={ctx}
                installAllowed={canInstall(ctx, activation)}
                answers={answers}
                plan={plan}
                onPlan={setPlan}
                onBack={() => setStep(hw ? 'roles' : 'scan')}
                onInstall={startInstall}
              />
            )}
            {step === 'install' && (
              <InstallStep
                run={run}
                state={installState}
                error={installError}
                exitCode={exitCode}
                cancelRequested={cancelRequested}
                onCancel={cancelInstall}
                undo={undo}
                undoState={undoState}
                undoError={undoError}
                onUndo={undoChanges}
                allowUndo={!sealed}
                onRetryNow={() => {
                  resetUndo();
                  startInstall();
                }}
                onRetry={() => {
                  resetUndo();
                  setInstallState('idle');
                  setPlan(null);
                  setStep('plan');
                }}
                onNext={() => setStep('verify')}
              />
            )}
            {step === 'verify' && <VerifyStep installRun={run} onNext={() => setStep('finish')} />}
            {step === 'finish' && (
              <FinishStep
                run={run}
                onFinished={() => {
                  setFinished(true);
                  setSealed(true);
                  setView('status');
                }}
              />
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
