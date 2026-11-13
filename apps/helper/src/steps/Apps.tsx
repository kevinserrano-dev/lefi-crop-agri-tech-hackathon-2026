import { useCallback, useEffect, useState } from 'react';
import { asSetupError, setupApi } from '../api';
import type { InstallerMsg, SetupContext, SetupError } from '../api';
import { consoleApi } from '../console';
import { fleetApi } from '../fleet';
import type { FleetStatus, NodeUpdates } from '../fleet';
import { applyMsg, emptyRun, firstFailure, stepPercent } from '../progress';
import type { RunView } from '../progress';
import { isNewer, updatesApi } from '../updates';
import type { UpdatesStatus } from '../updates';
import { Badge, Banner, Bar, ErrorBox, Icon, Spinner } from '../ui';
import { AdminFields, useAdminAuth } from './AdminFields';
import { PairedDevices } from './PairedDevices';
import { ComponentRow, CopyLine } from './Fleet';

/** Official apps of Lefi Crop, here and on the other nodes (ADR-043). */
export function AppsView({ ctx, onManage }: { ctx: SetupContext; onManage: () => void }) {
  const [status, setStatus] = useState<UpdatesStatus | null>(null);
  const [fleet, setFleet] = useState<FleetStatus | null>(null);
  const [error, setError] = useState<SetupError | null>(null);
  const [run, setRun] = useState<RunView | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const admin = useAdminAuth();

  const refresh = useCallback(() => {
    updatesApi.status().then(setStatus, (e) => setError(asSetupError(e)));
    fleetApi.status().then(setFleet, () => undefined);
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(() => fleetApi.status().then(setFleet, () => undefined), 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const follow = (m: InstallerMsg) => setRun((v) => applyMsg(v ?? emptyRun, m));
  const go = (p: Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setAsking(false);
    setRun(emptyRun);
    p.catch((e) => setError(asSetupError(e))).finally(() => {
      setBusy(false);
      admin.clear();
      refresh();
    });
  };
  const install = () =>
    go(
      setupApi.runInstall(
        {
          roles: ['desktop'],
          model: 'recommended',
          ai_url: null,
          ai_lan: false,
          admin_https: true,
          stop_conflicting_services: false,
          update_model: false,
          service_mode: ctx.os === 'linux' ? 'systemd' : null,
          dev_allow_no_ai: false,
        },
        follow,
      ),
    );

  const here = status?.installed.desktop ?? null;
  const carried = status?.bundled.desktop ?? null;
  // This Lefi Crop Helper carries a newer Lefi Desktop than the one installed (ADR-051).
  const update = !!here && isNewer(carried, here.version);
  const failure = run ? firstFailure(run) : undefined;
  const nodes = fleet?.service === 'running' ? fleet.nodes.filter((n) => !n.revoked) : [];

  return (
    <section className="step" aria-labelledby="apps-title">
      <header className="step-head">
        <h1 id="apps-title">Apps</h1>
        <p className="lead">
          Official Lefi Crop apps: install or remove them on any of your nodes.
        </p>
      </header>
      {error ? <ErrorBox error={error} title="Not done" /> : null}
      {!status && !error ? <Spinner label="Looking at this PC…" /> : null}

      {status ? (
        <div className="card">
          <h2 className="card-title">
            <Icon name="dashboard" /> Lefi Desktop <span className="muted">on this PC</span>{' '}
            <Badge tone={here ? 'ok' : 'off'}>
              {here ? `Installed · ${here.version}` : 'Not installed'}
            </Badge>
          </h2>
          <p className="muted">
            The dashboard for operators and supervisors.{' '}
            {here ? here.path : carried ? `This Helper carries version ${carried}.` : ''}
          </p>
          <Banner tone="info" icon="info">
            It signs in to the real Lefi Brain once paired (below). Screens without a Lefi Brain
            module yet still show labelled sample data.
          </Banner>
          {update && !run?.started ? (
            <Banner tone="info" icon="system_update">
              <strong>
                A new version of Lefi Desktop is available: {here?.version} → {carried}
              </strong>
              <p>
                It is updated here, by itself. The previous version is kept so it can be put back,
                and this PC stays paired with Lefi Brain.
              </p>
              <div className="row-end">
                <button type="button" className="btn btn-primary" disabled={busy} onClick={install}>
                  <Icon name="system_update" /> Update Lefi Desktop
                </button>
              </div>
            </Banner>
          ) : null}
          {run?.result === 'ok' && update === false && here ? (
            <p className="muted">
              Lefi Desktop {here.version} is installed. If it was open, close and open it again to
              use this version.
            </p>
          ) : null}
          {run?.started ? (
            <div className="overall">
              <Bar percent={stepPercent(run)} label="Progress" />
              <span className="muted">
                {run.result === 'ok' ? 'Done.' : `${run.stepsDone} of ${run.stepsTotal} steps`}
              </span>
            </div>
          ) : null}
          {failure ? (
            <Banner tone="crit" icon="error">
              <strong>{failure.message}</strong>
              {failure.hint ? <p>{failure.hint}</p> : null}
            </Banner>
          ) : null}
          {asking ? (
            <div className="confirm" role="alertdialog">
              <p>
                <strong>Remove Lefi Desktop from this PC?</strong>
              </p>
              <AdminFields a={admin} />
              <div className="row-end">
                <button type="button" className="btn" onClick={() => setAsking(false)}>
                  Back
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={!admin.ready}
                  onClick={() => go(consoleApi.removeComponent('desktop', admin.auth, follow))}
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div className="row-end">
              {here ? (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => setAsking(true)}
                >
                  <Icon name="delete" /> Remove
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !carried}
                  title={carried ? undefined : 'This Helper does not carry Lefi Desktop'}
                  onClick={install}
                >
                  <Icon name="download" /> Install
                </button>
              )}
            </div>
          )}
        </div>
      ) : null}

      <PairedDevices />

      {nodes.map((n) => {
        const report = n.last_heartbeat?.report ?? null;
        const c = report?.components.find((x) => x.id === 'desktop');
        const canAct =
          !!(fleet?.service === 'running' && fleet.remote_install_available) &&
          n.connectivity === 'online' &&
          !n.active_command &&
          !n.service_outdated;
        const nodeUpdate = !!c?.installed && isNewer(carried, c.version);
        const serviceUpdate = n.updates?.service ?? null;
        const serviceVersion = n.last_heartbeat?.helperd_version ?? null;
        const online = n.connectivity === 'online' && !n.active_command;
        return (
          <div className="card" key={n.id}>
            <h2 className="card-title">
              <Icon name="computer" /> {n.name} <span className="muted">{n.hostname}</span>
            </h2>
            <p className="muted small">
              Lefi Crop Helper service:{' '}
              {serviceVersion ? `version ${serviceVersion}` : 'version not known yet (no signal)'}
              {serviceVersion && !serviceUpdate ? ' · up to date' : ''}
            </p>
            {serviceUpdate ? (
              <NodeServiceUpdate
                nodeId={n.id}
                update={serviceUpdate}
                command={fleet?.service === 'running' ? fleet.update_command : ''}
                canAct={online}
                onChanged={refresh}
              />
            ) : null}
            {nodeUpdate ? (
              <NodeDesktopUpdate
                nodeId={n.id}
                assigned={n.assigned}
                from={c?.version ?? ''}
                to={carried ?? ''}
                canAct={canAct}
                onChanged={refresh}
              />
            ) : null}
            <ComponentRow
              n={n}
              id="desktop"
              label="Lefi Desktop"
              c={c}
              report={report}
              canAct={canAct}
              onChanged={refresh}
            />
          </div>
        );
      })}
      <div className="row-end">
        <button type="button" className="btn" onClick={onManage}>
          <Icon name="lan" /> Other components, in Nodes
        </button>
      </div>
    </section>
  );
}

/**
 * That PC's Lefi Crop Helper service is older than the program this main PC shares (ADR-062). A
 * service that can replace itself gets one click; an older one is updated once on that PC.
 */
function NodeServiceUpdate({
  nodeId,
  update,
  command,
  canAct,
  onChanged,
}: {
  nodeId: string;
  update: NonNullable<NodeUpdates['service']>;
  command: string;
  canAct: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<SetupError | null>(null);
  const send = () => {
    setBusy(true);
    setError(null);
    fleetApi
      .updateService(nodeId)
      .then(
        () => {
          setSent(true);
          onChanged();
        },
        (e) => setError(asSetupError(e)),
      )
      .finally(() => setBusy(false));
  };
  return (
    <Banner tone="info" icon="system_update">
      <strong>
        A new version of the Lefi Crop Helper service is available for this PC: {update.installed}{' '}
        → {update.available}
      </strong>
      {error ? <ErrorBox error={error} title="Not updated" /> : null}
      {!update.remote ? (
        <>
          <p>
            This PC's service is too old to update itself. Once, on that PC, open Terminal and run
            (macOS asks for its password once; later updates are done from here):
          </p>
          <CopyLine text={command} />
        </>
      ) : sent ? (
        <p>Updating on that PC. It restarts its service by itself; its progress shows in Nodes.</p>
      ) : (
        <div className="row-end">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !canAct}
            title={canAct ? undefined : 'That PC must be online and not busy'}
            onClick={send}
          >
            <Icon name="system_update" /> Update the service there
          </button>
        </div>
      )}
    </Banner>
  );
}

/**
 * Lefi Desktop on another PC is older than the one this Lefi Crop Helper carries: one click sends
 * the installer's `desktop` role to that PC (ADR-051). Nothing to type there; it stays paired.
 */
function NodeDesktopUpdate({
  nodeId,
  assigned,
  from,
  to,
  canAct,
  onChanged,
}: {
  nodeId: string;
  assigned: string[];
  from: string;
  to: string;
  canAct: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<SetupError | null>(null);
  const update = () => {
    setBusy(true);
    setError(null);
    (assigned.includes('desktop')
      ? Promise.resolve<unknown>(null)
      : fleetApi.assign(nodeId, [...assigned, 'desktop'])
    )
      .then(() => fleetApi.install(nodeId, false, ['desktop']))
      .then(
        () => {
          setSent(true);
          onChanged();
        },
        (e) => setError(asSetupError(e)),
      )
      .finally(() => setBusy(false));
  };
  return (
    <Banner tone="info" icon="system_update">
      <strong>
        A new version of Lefi Desktop is available for this PC: {from} → {to}
      </strong>
      {error ? <ErrorBox error={error} title="Not updated" /> : null}
      {sent ? (
        <p>Updating on that PC. Its progress shows below.</p>
      ) : (
        <div className="row-end">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !canAct}
            title={canAct ? undefined : 'That PC must be online and not busy'}
            onClick={update}
          >
            <Icon name="system_update" /> Update Lefi Desktop there
          </button>
        </div>
      )}
    </Banner>
  );
}
