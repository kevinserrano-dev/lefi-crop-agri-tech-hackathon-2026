import { useEffect, useState } from 'react';
import { asSetupError } from '../api';
import type { SetupError } from '../api';
import { consoleApi } from '../console';
import type { StatusItem, SystemStatus } from '../console';
import { ago, fleetApi } from '../fleet';
import type { FleetStatus } from '../fleet';
import { Badge, ErrorBox, Icon, Spinner } from '../ui';
import type { Tone } from '../ui';

const CONN: Record<string, { label: string; tone: Tone }> = {
  online: { label: 'Online', tone: 'ok' },
  stale: { label: 'No signal for a while', tone: 'warn' },
  offline: { label: 'Offline', tone: 'crit' },
  never: { label: 'Not reporting yet', tone: 'off' },
};

function Item({ i }: { i: StatusItem }) {
  return (
    <li className="status-row">
      <div className="grow">
        <strong>{i.title}</strong>{' '}
        <Badge tone={i.state === 'running' ? 'ok' : 'crit'}>
          {i.state === 'running' ? 'Running' : 'Not answering'}
        </Badge>
        <div className="muted">
          {[i.detail, i.version ? `version ${i.version}` : null, i.model]
            .filter(Boolean)
            .join(' · ')}
          {i.loaded?.length
            ? ` · loaded: ${i.loaded.map((m) => `${m.name} (${m.gpu_pct ?? '?'}% on GPU)`).join(', ')}`
            : ''}
        </div>
      </div>
    </li>
  );
}

/** What is running now, measured when this screen asks; nothing here is remembered or estimated. */
export function StatusView({ onManage }: { onManage: () => void }) {
  const [s, setS] = useState<SystemStatus | null>(null);
  const [fleet, setFleet] = useState<FleetStatus | null>(null);
  const [error, setError] = useState<SetupError | null>(null);

  useEffect(() => {
    let alive = true;
    const read = () => {
      consoleApi.status().then(
        (v) => {
          if (!alive) return;
          setS(v);
          setError(null);
        },
        (e) => alive && setError(asSetupError(e)),
      );
      fleetApi.status().then(
        (v) => alive && setFleet(v),
        () => undefined,
      );
    };
    read();
    const t = setInterval(read, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const nodes = fleet?.service === 'running' ? fleet.nodes.filter((n) => !n.revoked) : [];

  return (
    <section className="step" aria-labelledby="status-title">
      <header className="step-head">
        <h1 id="status-title">Status</h1>
        <p className="lead">What is running on every node of this installation, measured now.</p>
      </header>
      {error ? <ErrorBox error={error} title="Could not read the status" /> : null}
      {!s && !error ? <Spinner label="Asking the services…" /> : null}
      {s ? (
        <div className="card">
          <h2 className="card-title">
            <Icon name="computer" /> {s.name} <Badge tone="info">This PC · main</Badge>
          </h2>
          <p className="muted">
            {s.hostname} · {s.pc.chip ?? 'chip unknown'} · {s.pc.memory_gb ?? '?'} GB · memory in
            use {s.metrics.memory_used_gb ?? '?'} GB · GPU in use{' '}
            {s.metrics.gpu_utilization_pct ?? '?'}% · load {s.metrics.load_1m ?? '?'}
          </p>
          <ul className="status-list">
            {s.items.map((i) => (
              <Item key={i.id} i={i} />
            ))}
          </ul>
        </div>
      ) : null}
      {fleet?.service === 'stopped' ? (
        <div className="card">
          <p className="muted">
            The Lefi Crop Helper service is not running, so the other nodes cannot report.
          </p>
          <div className="row-end">
            <button type="button" className="btn" onClick={onManage}>
              <Icon name="lan" /> Start it in Nodes
            </button>
          </div>
        </div>
      ) : null}
      {nodes.map((n) => {
        const report = n.last_heartbeat?.report;
        const c = CONN[n.connectivity] ?? { label: n.connectivity, tone: 'off' as Tone };
        return (
          <div className="card" key={n.id}>
            <h2 className="card-title">
              <Icon name="computer" /> {n.name} <Badge tone={c.tone}>{c.label}</Badge>
              <span className="grow" />
              <button type="button" className="btn btn-small" onClick={onManage}>
                <Icon name="tune" /> Manage
              </button>
            </h2>
            <p className="muted">
              {n.hostname} · {n.ip} · last signal {ago(n.seconds_since_seen)}
              {report
                ? ` · memory in use ${report.metrics.memory_used_gb ?? '?'} GB · GPU in use ${report.metrics.gpu_utilization_pct ?? '?'}%`
                : ''}
            </p>
            <ul className="status-list">
              {(report?.components ?? [])
                .filter((x) => x.state !== 'not_installed')
                .map((x) => (
                  <li className="status-row" key={x.id}>
                    <div className="grow">
                      <strong>
                        {x.id === 'ai' ? 'AI node' : x.id === 'desktop' ? 'Lefi Desktop' : x.id}
                      </strong>{' '}
                      <Badge
                        tone={x.state === 'running' || x.state === 'installed' ? 'ok' : 'warn'}
                      >
                        {x.state}
                      </Badge>
                      <div className="muted">
                        {x.version ? `version ${x.version}` : ''}
                        {x.id === 'ai' && n.ai_bench
                          ? ` · ${n.ai_bench.tokens_per_s} tokens/s (measured)`
                          : ''}
                        {x.id === 'ai' ? ` · ${n.ai_endpoint}` : ''}
                      </div>
                    </div>
                  </li>
                ))}
              {report && !report.components.some((x) => x.state !== 'not_installed') ? (
                <li className="muted">Nothing installed there yet.</li>
              ) : null}
              {!report ? (
                <li className="muted">Its service is out of date or not reporting.</li>
              ) : null}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
