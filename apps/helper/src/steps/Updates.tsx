import { useCallback, useEffect, useState } from 'react';
import { asSetupError, setupApi } from '../api';
import type { InstallerMsg, SetupContext, SetupError } from '../api';
import { applyMsg, emptyRun } from '../progress';
import type { RunView } from '../progress';
import { Badge, Banner, Bar, ErrorBox, Icon, Spinner } from '../ui';
import { updatesApi } from '../updates';
import type { UpdateFile, UpdateSettings, UpdatesStatus } from '../updates';
import { firstFailure, stepPercent } from '../progress';
import { StepRow } from './Install';

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="ver-row">
      <span className="ver-label">{label}</span>
      <span className="ver-value">{value}</span>
      {note ? <span className="muted">{note}</span> : null}
    </div>
  );
}

function FileCard({
  f,
  packaged,
  onInstall,
  busy,
}: {
  f: UpdateFile;
  packaged: boolean;
  onInstall: (path: string) => void;
  busy: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const m = f.manifest;
  return (
    <div className={`card ${f.problem ? '' : 'card-ok'}`}>
      <h2 className="card-title">
        <Icon name="system_update" /> {m ? `Lefi Crop ${m.release}` : 'Unknown file'}{' '}
        {m?.security ? <Badge tone="crit">Security fix</Badge> : null}
        {f.problem ? (
          <Badge tone="off">Cannot install</Badge>
        ) : (
          <Badge tone="ok">Signed by Lefi</Badge>
        )}
      </h2>
      <p className="muted">
        {f.path}
        {m ? ` · released ${m.released_at}` : ''}
      </p>
      {m?.notes ? <p>{m.notes}</p> : null}
      {m ? (
        <p className="muted">
          Contains Lefi Crop Helper {m.components.helper}, Lefi Brain {m.components.brain}, Lefi Desktop{' '}
          {m.components.desktop ?? '—'}, service {m.components.helperd}.
        </p>
      ) : null}
      {f.problem ? (
        <Banner tone="warn" icon="block">
          {f.problem}
        </Banner>
      ) : confirm ? (
        <div className="confirm" role="alertdialog">
          <p>
            <strong>Install Lefi Crop {m?.release}?</strong> Lefi Crop Helper restarts with the new
            version and then offers to update Lefi Brain and Lefi Desktop. The current version is
            kept so it can be put back.
          </p>
          <div className="row-end">
            <button type="button" className="btn" onClick={() => setConfirm(false)}>
              Back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => onInstall(f.path)}
            >
              Install
            </button>
          </div>
        </div>
      ) : (
        <div className="row-end">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!packaged || busy}
            title={packaged ? undefined : 'Only the packaged app can replace itself'}
            onClick={() => setConfirm(true)}
          >
            <Icon name="download" /> Install this update
          </button>
        </div>
      )}
    </div>
  );
}

export function UpdatesView({ ctx }: { ctx: SetupContext }) {
  const [status, setStatus] = useState<UpdatesStatus | null>(null);
  const [settings, setSettings] = useState<UpdateSettings | null>(null);
  const [error, setError] = useState<SetupError | null>(null);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<RunView | null>(null);
  const [brainRun, setBrainRun] = useState<RunView | null>(null);
  const [brainAsk, setBrainAsk] = useState(false);

  const refresh = useCallback(() => {
    updatesApi.status().then(setStatus, (e) => setError(asSetupError(e)));
  }, []);

  useEffect(() => {
    refresh();
    updatesApi.settings().then(setSettings, () => setSettings({ auto_components: false }));
  }, [refresh]);

  const updateDesktop = () => {
    setBusy(true);
    setError(null);
    setRun(emptyRun);
    setupApi
      .runInstall(
        {
          roles: ['desktop'],
          model: 'recommended',
          ai_url: null,
          ai_lan: false,
          admin_https: false,
          stop_conflicting_services: false,
          update_model: false,
          service_mode: ctx.os === 'linux' ? 'systemd' : null,
          dev_allow_no_ai: false,
        },
        (m: InstallerMsg) => setRun((v) => applyMsg(v ?? emptyRun, m)),
      )
      .catch((e) => setError(asSetupError(e)))
      .finally(() => {
        setBusy(false);
        refresh();
      });
  };

  const updateBrain = () => {
    setBrainAsk(false);
    setBusy(true);
    setError(null);
    setBrainRun(emptyRun);
    setupApi
      .runBrainUpdate((m: InstallerMsg) => setBrainRun((v) => applyMsg(v ?? emptyRun, m)))
      .catch((e) => setError(asSetupError(e)))
      .finally(() => {
        setBusy(false);
        refresh();
      });
  };

  const installHelper = (path: string) => {
    setBusy(true);
    setError(null);
    updatesApi
      .applyHelper(path)
      .catch((e) => setError(asSetupError(e)))
      .finally(() => setBusy(false));
  };

  const toggleAuto = (v: boolean) =>
    updatesApi
      .setSettings({ auto_components: v })
      .then(setSettings, (e) => setError(asSetupError(e)));

  const desktop = status?.components.find((c) => c.component === 'desktop');
  const brain = status?.components.find((c) => c.component === 'brain');

  return (
    <div className="tab-panel">
      <p className="muted">
        Lefi Crop Helper updates every part of Lefi Crop. A new version arrives as a signed{' '}
        <code>.lefiupdate</code> file on a USB stick or in Downloads; it is found automatically.
      </p>
      {error ? <ErrorBox error={error} title="Update" /> : null}
      {!status && !error ? <Spinner label="Looking for updates…" /> : null}

      {status ? (
        <>
          <div className="card">
            <h2 className="card-title">
              <Icon name="inventory_2" /> Installed on this PC
            </h2>
            <Row label="Lefi Crop release" value={status.release || 'unknown'} />
            <Row
              label="Lefi Crop Helper"
              value={status.helper}
              note={status.packaged ? undefined : 'development build'}
            />
            <Row
              label="Lefi Brain"
              value={status.installed.brain ?? 'not running'}
              note={
                status.bundled.brain
                  ? `this Lefi Crop Helper carries ${status.bundled.brain}`
                  : undefined
              }
            />
            <Row
              label="Lefi Desktop"
              value={status.installed.desktop?.version ?? 'not installed'}
              note={
                status.bundled.desktop
                  ? `this Lefi Crop Helper carries ${status.bundled.desktop}`
                  : undefined
              }
            />
            {status.support_until ? (
              <p className="muted">
                Updates are covered by your licence until {status.support_until}.
              </p>
            ) : null}
          </div>

          {desktop?.outdated ? (
            <div className="card">
              <h2 className="card-title">
                <Icon name="dashboard" /> Lefi Desktop {desktop.installed} → {desktop.available}
              </h2>
              <p className="muted">
                The app is replaced; the previous version is kept by the installer so it can be put
                back.
              </p>
              {run?.started ? (
                <div className="overall">
                  <Bar percent={stepPercent(run)} label="Lefi Desktop update" />
                  <span className="muted">
                    {run.result === 'ok'
                      ? 'Updated.'
                      : run.result
                        ? `Ended: ${run.result}`
                        : `${run.stepsDone} of ${run.stepsTotal} steps`}
                  </span>
                </div>
              ) : null}
              <div className="row-end">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={updateDesktop}
                >
                  <Icon name="system_update" /> Update Lefi Desktop
                </button>
              </div>
            </div>
          ) : null}

          {brain?.outdated || brainRun ? (
            <div className="card">
              <h2 className="card-title">
                <Icon name="hub" /> Lefi Brain {brain?.installed ?? ''} → {brain?.available ?? ''}
              </h2>
              <p className="muted">
                The new Lefi Brain is prepared next to the running one, the database is backed up and
                migrated, then the service switches and is checked. If anything fails, the current
                Lefi Brain and its database come back by themselves. Lefi Brain is unavailable for a few
                seconds during the switch.
              </p>
              {brainRun?.started ? (
                <>
                  <div className="overall">
                    <Bar percent={stepPercent(brainRun)} label="Lefi Brain update" />
                    <span className="muted">
                      {brainRun.stepsDone} of {brainRun.stepsTotal} steps
                    </span>
                  </div>
                  <ol className="timeline">
                    {brainRun.steps.map((s) => (
                      <StepRow key={s.id} s={s} />
                    ))}
                  </ol>
                </>
              ) : null}
              {brainRun?.result === 'ok' ? (
                <Banner tone="ok" icon="verified">
                  Lefi Brain was updated and answers its health check. The previous version is kept.
                </Banner>
              ) : null}
              {brainRun && firstFailure(brainRun) ? (
                <Banner
                  tone={
                    firstFailure(brainRun)?.code === 'BRAIN_UPDATE_ROLLED_BACK' ? 'warn' : 'crit'
                  }
                  icon={
                    firstFailure(brainRun)?.code === 'BRAIN_UPDATE_ROLLED_BACK' ? 'undo' : 'error'
                  }
                >
                  <strong>
                    {firstFailure(brainRun)?.code === 'BRAIN_UPDATE_ROLLED_BACK'
                      ? 'Not updated — the previous Lefi Brain is running again'
                      : 'Lefi Brain update stopped'}
                  </strong>
                  <p>{firstFailure(brainRun)?.message}</p>
                  {firstFailure(brainRun)?.hint ? (
                    <p className="muted">{firstFailure(brainRun)?.hint}</p>
                  ) : null}
                </Banner>
              ) : null}
              {brainAsk ? (
                <div className="confirm" role="alertdialog">
                  <p>
                    <strong>Update Lefi Brain now?</strong> Sensors keep sending; Lefi Brain is away
                    for a few seconds while it switches.
                  </p>
                  <div className="row-end">
                    <button type="button" className="btn" onClick={() => setBrainAsk(false)}>
                      Back
                    </button>
                    <button type="button" className="btn btn-primary" onClick={updateBrain}>
                      Update Lefi Brain
                    </button>
                  </div>
                </div>
              ) : brain?.outdated ? (
                <div className="row-end">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => setBrainAsk(true)}
                  >
                    <Icon name="system_update" /> Update Lefi Brain
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {status.files.length ? (
            status.files.map((f) => (
              <FileCard
                key={f.path}
                f={f}
                packaged={status.packaged}
                onInstall={installHelper}
                busy={busy}
              />
            ))
          ) : (
            <div className="card">
              <p className="muted">
                No update file found in Downloads or on a connected USB stick.{' '}
                <button type="button" className="btn btn-small" onClick={refresh}>
                  <Icon name="refresh" /> Look again
                </button>
              </p>
            </div>
          )}

          <div className="card">
            <h2 className="card-title">
              <Icon name="settings" /> Settings
            </h2>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings?.auto_components ?? false}
                onChange={(e) => void toggleAuto(e.target.checked)}
              />
              <span>
                <span className="toggle-label">Update Lefi Desktop automatically</span>
                <span className="toggle-help">
                  Off (default): you get a notification and approve each update. Lefi Crop Helper
                  itself and Lefi Brain always ask first.
                </span>
              </span>
            </label>
          </div>
        </>
      ) : null}
    </div>
  );
}
