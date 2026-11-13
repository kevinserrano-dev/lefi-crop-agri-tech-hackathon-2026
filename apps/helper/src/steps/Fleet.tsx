import { useCallback, useEffect, useState } from 'react';
import { asSetupError } from '../api';
import type { SetupError } from '../api';
import { ago, fleetApi, SATELLITE_COMPONENTS, uptime } from '../fleet';
import type {
  ComponentState,
  ComponentStateName,
  FleetNode,
  FleetStatus,
  JoinCode,
  NodeReport,
} from '../fleet';
import { Badge, Banner, Disclosure, ErrorBox, Icon, Spinner } from '../ui';
import type { Tone } from '../ui';
import { AdminFields, useAdminAuth } from './AdminFields';
import { RemoteJob } from './RemoteJob';

const TONE: Record<string, Tone> = {
  online: 'ok',
  stale: 'warn',
  offline: 'crit',
  never: 'off',
  revoked: 'off',
};
const LABEL: Record<string, string> = {
  online: 'Online',
  stale: 'No signal for a while',
  offline: 'Offline',
  never: 'Not reporting yet',
  revoked: 'Removed',
};

const COMPONENT_STATE: Record<ComponentStateName, { label: string; tone: Tone }> = {
  running: { label: 'Running', tone: 'ok' },
  stopped: { label: 'Stopped', tone: 'crit' },
  disabled: { label: 'Switched off', tone: 'warn' },
  installed: { label: 'Installed', tone: 'ok' },
  external: { label: 'Running, not managed', tone: 'warn' },
  not_installed: { label: 'Not installed', tone: 'off' },
};

function Fact({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="node-fact">
      <span className="node-fact-label">{label}</span>
      <span className="node-fact-value">{value ?? 'unknown'}</span>
    </div>
  );
}

export function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-line">
      <code>{text}</code>
      <button
        type="button"
        className="btn btn-small"
        aria-label={`Copy ${text}`}
        onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true))}
      >
        <Icon name={copied ? 'check' : 'content_copy'} />
      </button>
    </div>
  );
}

/** Everything the main PC knows about the AI on that PC. All measured there. */
function AiDetails({
  n,
  report,
  onChanged,
}: {
  n: FleetNode;
  report: NodeReport;
  onChanged: () => void;
}) {
  const ai = report.ai;
  const b = n.ai_bench;
  const m = report.metrics;
  if (!ai) return <p className="muted">The AI does not answer on that PC now.</p>;
  const model = ai.loaded[0]?.name ?? ai.models[0]?.name;
  return (
    <div className="details">
      <h3 className="details-title">Speed</h3>
      {b ? (
        <>
          <div className="node-facts-grid">
            <Fact label="Tokens per second" value={b.tokens_per_s} />
            <Fact label="Model tested" value={b.model} />
            <Fact label="Share on GPU" value={b.gpu_pct === null ? null : `${b.gpu_pct}%`} />
            <Fact label="Loading the model" value={b.load_ms === null ? null : `${b.load_ms} ms`} />
            <Fact
              label="Reading the prompt"
              value={b.prompt_ms === null ? null : `${b.prompt_ms} ms`}
            />
            <Fact label="Measured" value={new Date(b.at * 1000).toLocaleString()} />
          </div>
        </>
      ) : (
        <p className="muted">Not measured yet. Measure speed runs one real, short generation.</p>
      )}
      <h3 className="details-title">GPU and memory, now</h3>
      <div className="node-facts-grid">
        <Fact
          label="GPU in use"
          value={m.gpu_utilization_pct === null ? null : `${m.gpu_utilization_pct}%`}
        />
        <Fact
          label="GPU memory in use"
          value={m.gpu_memory_in_use_gb === null ? null : `${m.gpu_memory_in_use_gb} GB`}
        />
        <Fact
          label="PC memory in use"
          value={
            m.memory_used_gb === null
              ? null
              : `${m.memory_used_gb} of ${report.pc.memory_gb ?? '?'} GB`
          }
        />
      </div>
      <h3 className="details-title">Models</h3>
      <ul className="plain-list">
        {ai.models.map((x) => {
          const l = ai.loaded.find((y) => y.name === x.name);
          return (
            <li key={x.name}>
              <code>{x.name}</code> · {x.size_gb} GB on disk
              {l
                ? ` · loaded now: ${l.size_gb} GB, ${l.gpu_pct ?? '?'}% on GPU, context ${l.context_length ?? '?'}`
                : ''}
            </li>
          );
        })}
      </ul>
      <h3 className="details-title">Where to reach it</h3>
      <CopyLine text={n.ai_endpoint} />
      {model ? (
        <Disclosure title="Try it from a terminal">
          <CopyLine
            text={`curl ${n.ai_endpoint}/api/generate -d '${JSON.stringify({ model, prompt: 'Hello', stream: false, think: false })}'`}
          />
        </Disclosure>
      ) : null}
      {ai.lan ? (
        <Banner tone="warn" icon="shield">
          <strong>Open to your local network, without a password.</strong> Ollama has no
          authentication: allow only this main PC on port 11434 in that PC&apos;s firewall or the
          router.
        </Banner>
      ) : null}
      {ai.lan === false ? (
        <Banner tone="warn" icon="wifi_off">
          <strong>Only that PC can reach it.</strong> Lefi Brain needs it on the network: install the
          AI node again.
        </Banner>
      ) : null}
      {ai.kill_switch ? (
        <Banner tone="warn" icon="power_settings_new">
          The AI kill switch is on there.
        </Banner>
      ) : null}
      <h3 className="details-title">Lefi Brain</h3>
      {n.used_by_brain ? (
        <p className="muted">Lefi Brain uses this AI.</p>
      ) : (
        <>
          <p className="muted">
            Lefi Brain does not use this AI.
            {n.ai_link?.state === 'failed' && n.ai_link.code !== 'NO_BRAIN'
              ? ` Last attempt: ${n.ai_link.message}`
              : ''}
          </p>
          <div className="row-end">
            <button
              type="button"
              className="btn btn-small"
              disabled={n.ai_link?.state === 'linking' || n.connectivity !== 'online'}
              onClick={() => void fleetApi.linkAi(n.id).then(onChanged, () => undefined)}
            >
              <Icon name="link" /> {n.ai_link?.state === 'linking' ? 'Connecting…' : 'Use this AI'}
            </button>
          </div>
        </>
      )}
      <p className="muted">Ollama {ai.version ?? 'version unknown'}</p>
    </div>
  );
}

type RowAsk = 'install' | 'remove' | 'stop' | null;

export function ComponentRow({
  n,
  id,
  label,
  c,
  report,
  canAct,
  onChanged,
}: {
  n: FleetNode;
  id: string;
  label: string;
  c: ComponentState | undefined;
  report: NodeReport | null;
  canAct: boolean;
  onChanged: () => void;
}) {
  const [ask, setAsk] = useState<RowAsk>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SetupError | null>(null);
  const [open, setOpen] = useState(false);
  const admin = useAdminAuth();
  const state = c?.state ?? 'not_installed';
  const chosen = n.assigned.includes(id);
  const removable = id === 'ai' || id === 'desktop';
  const showDetails = id === 'ai' && !!report?.ai;
  const st = COMPONENT_STATE[state];

  const act = (p: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setAsk(null);
    p()
      .then(onChanged, (e) => setError(asSetupError(e)))
      .finally(() => setBusy(false));
  };
  // Choosing a component and installing it are one action here.
  const install = (dryRun: boolean) =>
    act(() =>
      (chosen ? Promise.resolve<unknown>(null) : fleetApi.assign(n.id, [...n.assigned, id])).then(
        () => fleetApi.install(n.id, dryRun, [id]),
      ),
    );
  const needsInstall = state === 'not_installed' || state === 'external';

  return (
    <div className="comp-row">
      <div className="comp-row-head">
        <div className="grow">
          <strong>{label}</strong> <Badge tone={st.tone}>{st.label}</Badge>
          {c?.version ? <span className="muted"> · version {c.version}</span> : null}
          {id === 'ai' && n.ai_bench ? (
            <span className="muted"> · {n.ai_bench.tokens_per_s} tokens/s</span>
          ) : null}
          {c?.detail ? <div className="muted">{c.detail}</div> : null}
          {c?.path ? <div className="muted">{c.path}</div> : null}
        </div>
        <div className="comp-row-actions">
          {needsInstall ? (
            <>
              <button
                type="button"
                className="btn btn-small"
                disabled={!canAct || busy}
                onClick={() => install(true)}
              >
                <Icon name="visibility" /> Preview
              </button>
              <button
                type="button"
                className="btn btn-small btn-primary"
                disabled={!canAct || busy}
                onClick={() => setAsk('install')}
              >
                <Icon name="download" /> Install
              </button>
            </>
          ) : null}
          {id === 'ai' && state === 'running' ? (
            <>
              <button
                type="button"
                className="btn btn-small"
                disabled={!canAct || busy}
                onClick={() => act(() => fleetApi.measureAi(n.id))}
              >
                <Icon name="speed" /> Measure speed
              </button>
              <button
                type="button"
                className="btn btn-small"
                disabled={!canAct || busy}
                onClick={() => act(() => fleetApi.service(n.id, 'restart'))}
              >
                <Icon name="restart_alt" /> Restart
              </button>
              <button
                type="button"
                className="btn btn-small"
                disabled={!canAct || busy}
                onClick={() => setAsk('stop')}
              >
                <Icon name="stop" /> Stop
              </button>
            </>
          ) : null}
          {id === 'ai' && state === 'disabled' ? (
            <button
              type="button"
              className="btn btn-small btn-primary"
              disabled={!canAct || busy}
              onClick={() => act(() => fleetApi.service(n.id, 'on'))}
            >
              <Icon name="power_settings_new" /> Turn the AI on
            </button>
          ) : null}
          {id === 'ai' && (state === 'running' || state === 'stopped') ? (
            <button
              type="button"
              className="btn btn-small"
              disabled={!canAct || busy}
              title="Stays off across restarts, until it is turned on here"
              onClick={() => act(() => fleetApi.service(n.id, 'off'))}
            >
              <Icon name="power_settings_new" /> Kill switch
            </button>
          ) : null}
          {id === 'ai' && state === 'stopped' ? (
            <button
              type="button"
              className="btn btn-small btn-primary"
              disabled={!canAct || busy}
              onClick={() => act(() => fleetApi.service(n.id, 'start'))}
            >
              <Icon name="play_arrow" /> Start
            </button>
          ) : null}
          {removable && c?.installed ? (
            <button
              type="button"
              className="btn btn-small"
              disabled={!canAct || busy}
              onClick={() => setAsk('remove')}
            >
              <Icon name="delete" /> Remove
            </button>
          ) : null}
          {showDetails ? (
            <button
              type="button"
              className="btn btn-small"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              <Icon name={open ? 'expand_less' : 'expand_more'} /> Details
            </button>
          ) : null}
        </div>
      </div>
      {ask ? (
        <div className="confirm" role="alertdialog">
          <p>
            <strong>
              {ask === 'install'
                ? `Install ${label} on ${n.name}?`
                : ask === 'remove'
                  ? `Remove ${label} from ${n.name}?`
                  : `Stop the AI on ${n.name}?`}
            </strong>{' '}
            {ask === 'install'
              ? 'It downloads what it needs on that PC (internet needed there, once).'
              : ask === 'remove' && id === 'ai'
                ? 'Its service stops and is removed. Ollama and the downloaded models stay on that PC. Lefi Brain cannot use this AI any more.'
                : ask === 'stop'
                  ? 'Lefi Brain cannot use it until it is started again.'
                  : 'The app is deleted from that PC.'}
          </p>
          {ask === 'remove' ? <AdminFields a={admin} /> : null}
          <div className="row-end">
            <button type="button" className="btn" onClick={() => setAsk(null)}>
              Back
            </button>
            <button
              type="button"
              className={ask === 'install' ? 'btn btn-primary' : 'btn btn-danger'}
              disabled={ask === 'remove' && !admin.ready}
              onClick={() =>
                ask === 'install'
                  ? install(false)
                  : act(() =>
                      ask === 'remove'
                        ? fleetApi.remove(n.id, id, admin.auth)
                        : fleetApi.service(n.id, 'stop'),
                    )
              }
            >
              {ask === 'install' ? 'Install' : ask === 'remove' ? 'Remove' : 'Stop'}
            </button>
          </div>
        </div>
      ) : null}
      {error ? <ErrorBox error={error} title="Not done" /> : null}
      {open && report ? <AiDetails n={n} report={report} onChanged={onChanged} /> : null}
    </div>
  );
}

function NodeCard({
  n,
  remoteAvailable,
  updateCommand,
  onChanged,
}: {
  n: FleetNode;
  remoteAvailable: boolean;
  updateCommand: string;
  onChanged: () => void;
}) {
  const [error, setError] = useState<SetupError | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const admin = useAdminAuth();
  const hb = n.last_heartbeat;
  const report = hb?.report ?? null;
  const canAct =
    remoteAvailable && n.connectivity === 'online' && !n.active_command && !n.service_outdated;

  return (
    <div className={`card node ${n.revoked ? 'node-revoked' : ''}`}>
      <div className="node-head">
        <Icon name="computer" className="node-icon" />
        <div className="grow">
          <div className="node-title">
            {n.name} <Badge tone={TONE[n.connectivity] ?? 'off'}>{LABEL[n.connectivity]}</Badge>
          </div>
          <div className="muted">
            {n.hostname} · {n.ip} · {n.name}.local · {n.os} {n.arch} · last signal{' '}
            {ago(n.seconds_since_seen)}
          </div>
        </div>
      </div>
      {n.service_outdated && !n.revoked ? (
        <Banner tone="warn" icon="system_update">
          <strong>The service on this PC is out of date.</strong> It cannot install nor report
          details until it is updated. On that PC, in Terminal (it stays joined):
          <CopyLine text={updateCommand} />
        </Banner>
      ) : n.updates?.service && !n.revoked ? (
        <Banner tone="info" icon="system_update">
          A new version of the Lefi Crop Helper service is available for this PC:{' '}
          {n.updates.service.installed} → {n.updates.service.available}. Update it in Apps.
        </Banner>
      ) : null}
      {hb && !n.revoked ? (
        <div className="node-facts-grid">
          <Fact label="Chip" value={report?.pc.chip} />
          <Fact
            label="Memory"
            value={report?.pc.memory_gb == null ? null : `${report.pc.memory_gb} GB`}
          />
          <Fact label="macOS" value={report?.pc.os_version} />
          <Fact label="Up" value={uptime(hb.uptime_s)} />
          <Fact
            label="Free disk"
            value={hb.disk_free_gb === null ? null : `${hb.disk_free_gb} GB`}
          />
          <Fact label="Load (1 min)" value={report?.metrics.load_1m} />
          <Fact label="Helper service" value={hb.helperd_version} />
        </div>
      ) : null}
      {!n.revoked ? (
        <>
          <div className="comp-list" role="group" aria-label={`Components of ${n.name}`}>
            {SATELLITE_COMPONENTS.map((c) => (
              <ComponentRow
                key={c.id}
                n={n}
                id={c.id}
                label={c.label}
                c={report?.components.find((x) => x.id === c.id)}
                report={report}
                canAct={canAct}
                onChanged={onChanged}
              />
            ))}
          </div>
          <p className="muted">Lefi Brain and Lefi Gateway run only on the main PC.</p>
          {error ? <ErrorBox error={error} title="Not saved" /> : null}
          <RemoteJob node={n} remoteAvailable={remoteAvailable} onChanged={onChanged} />
          <div className="row-end node-actions">
            {confirmRemove ? (
              <>
                <span className="problem">
                  Remove this node? It stops reporting and must join again with a new code. What is
                  installed there stays.
                </span>
                <AdminFields a={admin} />
                <button type="button" className="btn" onClick={() => setConfirmRemove(false)}>
                  Keep
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={!admin.ready}
                  onClick={() =>
                    fleetApi
                      .revoke(n.id, admin.auth)
                      .then(onChanged, (e) => setError(asSetupError(e)))
                  }
                >
                  Remove
                </button>
              </>
            ) : (
              <button type="button" className="btn" onClick={() => setConfirmRemove(true)}>
                <Icon name="link_off" /> Remove this node
              </button>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function FleetView({ activated }: { activated: boolean }) {
  const [status, setStatus] = useState<FleetStatus | null>(null);
  const [error, setError] = useState<SetupError | null>(null);
  const [code, setCode] = useState<JoinCode | null>(null);
  const [onlyIp, setOnlyIp] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');

  const refresh = useCallback(() => {
    fleetApi.status().then(
      (s) => {
        setStatus(s);
        setError(null);
      },
      (e) => setError(asSetupError(e)),
    );
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const startService = (atBoot: boolean) => {
    setBusy(true);
    setError(null);
    fleetApi
      .startService(atBoot)
      .then(
        () => setTimeout(refresh, 1200),
        (e) => setError(asSetupError(e)),
      )
      .finally(() => setBusy(false));
  };

  const newCode = () => {
    setBusy(true);
    fleetApi
      .createCode(onlyIp.trim() || null)
      .then(
        (c) => {
          setCode(c);
          refresh();
        },
        (e) => setError(asSetupError(e)),
      )
      .finally(() => setBusy(false));
  };

  const copy = (what: string, text: string) =>
    void navigator.clipboard?.writeText(text).then(() => setCopied(what));

  const running = status?.service === 'running' ? status : null;
  const active = running ? running.nodes.filter((n) => !n.revoked) : [];

  return (
    <section className="step" aria-labelledby="fleet-title">
      <header className="step-head">
        <h1 id="fleet-title">Nodes</h1>
        <p className="lead">
          Every PC of this installation is a node. {running ? running.main_name : 'This PC'} is the
          main one: it runs Lefi Brain and manages the others.
        </p>
      </header>

      {!activated ? (
        <Banner tone="warn" icon="key">
          Activate this PC first (Activation step).
        </Banner>
      ) : null}
      {error ? <ErrorBox error={error} title="Something went wrong" /> : null}
      {!status && !error && activated ? (
        <Spinner label="Asking the Lefi Crop Helper service…" />
      ) : null}

      {status?.service === 'stopped' && activated ? (
        <div className="card">
          <h2 className="card-title">
            <Icon name="power_settings_new" /> The Lefi Crop Helper service is not running
          </h2>
          <p className="muted">
            It serves the page the other nodes open, receives their signals and keeps running
            without this window. It starts whenever this Mac starts, even before anyone logs in;
            macOS asks for an administrator password once to allow that.
          </p>
          <div className="row-end">
            <button
              type="button"
              className="btn"
              disabled={busy}
              title="No administrator password needed; it stops when you log out"
              onClick={() => startService(false)}
            >
              Only while I am logged in
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => startService(true)}
            >
              <Icon name="play_arrow" /> Start the Lefi Crop Helper service
            </button>
          </div>
        </div>
      ) : null}

      {running?.service_outdated ? (
        <Banner tone="warn" icon="restart_alt">
          <strong>The Lefi Crop Helper service must restart.</strong> It still runs the version from
          before this update, so the new pages and commands are not available yet.
          <div className="row-end">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => startService(running.service_registered !== 'login')}
            >
              <Icon name="restart_alt" /> Restart the service
            </button>
          </div>
        </Banner>
      ) : null}

      {running ? (
        <>
          <div className="card">
            <h2 className="card-title">
              <Icon name="add_link" /> Add a node{' '}
              <Badge tone={running.service_registered === 'boot' ? 'ok' : 'warn'}>
                {running.service_registered === 'boot'
                  ? 'Service starts with this Mac'
                  : 'Service starts only at login'}
              </Badge>{' '}
              <Badge tone="info">
                {active.length + 1} of {running.max_pcs} nodes in the licence
              </Badge>
            </h2>
            <ol className="plain-list">
              <li>
                On the new PC, open <code className="code-chip">{running.join_url}</code>{' '}
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => copy('url', running.join_url)}
                >
                  <Icon name={copied === 'url' ? 'check' : 'content_copy'} />
                </button>
              </li>
              <li>Create a one-time code here and follow the page there.</li>
            </ol>
            <div className="code-row">
              <label className="field grow">
                <span className="field-label">Only for the PC at this address (optional)</span>
                <input
                  className="input"
                  placeholder="192.168.8.21"
                  value={onlyIp}
                  onChange={(e) => setOnlyIp(e.target.value)}
                />
              </label>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={newCode}>
                <Icon name="key" /> Create a code
              </button>
            </div>
            {code ? (
              <div className="join-code">
                <div className="join-code-value" aria-label="Join code">
                  {code.code}
                </div>
                <div className="muted">
                  Valid once, until{' '}
                  {new Date(code.expires_at * 1000).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {code.expected_ip ? `, only from ${code.expected_ip}` : ''}.
                </div>
                <pre className="log">{code.join_command}</pre>
                <div className="row-end">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => copy('cmd', code.join_command)}
                  >
                    <Icon name={copied === 'cmd' ? 'check' : 'content_copy'} /> Copy the command
                  </button>
                </div>
              </div>
            ) : null}
            <p className="muted">
              Security fingerprint: <code>{running.ca_fingerprint.slice(0, 16)}</code> — the page on
              the new PC must show the same.{' '}
              {running.satellite_available
                ? `PCs supported now: ${running.satellite_platform.replace('-', ' ')}.`
                : 'This main PC has no satellite program to share.'}
            </p>
          </div>

          {running.nodes.length ? (
            running.nodes
              .slice()
              .sort((a, b) => Number(a.revoked) - Number(b.revoked))
              .map((n) => (
                <NodeCard
                  key={n.id}
                  n={n}
                  remoteAvailable={running.remote_install_available}
                  updateCommand={running.update_command}
                  onChanged={refresh}
                />
              ))
          ) : (
            <div className="card">
              <p className="muted">No other node has joined yet.</p>
            </div>
          )}

          <Banner tone="info" icon="info">
            Install, stop or remove components from here. Each PC downloads its tools itself (it
            needs internet once); Lefi Brain always stays on this PC.
          </Banner>
          <Disclosure title="Service details">
            <p className="muted">
              Installation {running.installation_id} · addresses{' '}
              {running.lan_ips.join(', ') || 'unknown'} · full fingerprint{' '}
              <code>{running.ca_fingerprint}</code>
            </p>
            <button
              type="button"
              className="btn"
              onClick={() => fleetApi.stopService().then(refresh, (e) => setError(asSetupError(e)))}
            >
              Stop the Lefi Crop Helper service
            </button>
          </Disclosure>
        </>
      ) : null}
    </section>
  );
}
