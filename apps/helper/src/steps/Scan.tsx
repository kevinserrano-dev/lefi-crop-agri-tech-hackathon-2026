import { useCallback, useEffect, useState } from 'react';
import { asSetupError, setupApi } from '../api';
import type { SetupError } from '../api';
import { fmtGb } from '../hw';
import type { HwReport } from '../hw';
import { Badge, ErrorBox, Icon, Spinner } from '../ui';

function Fact({
  icon,
  label,
  value,
  note,
  unknown,
}: {
  icon: string;
  label: string;
  value: string;
  note?: string | null;
  unknown?: boolean;
}) {
  return (
    <div className="fact">
      <Icon name={icon} className="fact-icon" />
      <div>
        <div className="fact-label">{label}</div>
        <div className="fact-value">
          {value} {unknown ? <Badge tone="warn">unknown</Badge> : null}
        </div>
        {note ? <div className="fact-note">{note}</div> : null}
      </div>
    </div>
  );
}

export function ScanStep({
  hw,
  onScanned,
  onBack,
  onNext,
}: {
  hw: HwReport | null;
  onScanned: (r: HwReport) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [busy, setBusy] = useState(!hw);
  const [error, setError] = useState<SetupError | null>(null);

  const runScan = useCallback(
    () =>
      setupApi
        .scan()
        .then(onScanned, (e) => setError(asSetupError(e)))
        .finally(() => setBusy(false)),
    [onScanned],
  );
  const scan = () => {
    setBusy(true);
    setError(null);
    void runScan();
  };

  useEffect(() => {
    if (!hw) void runScan();
    // Scan once on first visit; "Scan again" repeats it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const acc = hw?.accelerator;
  const busyPorts = hw?.ports.filter((p) => p.in_use) ?? [];

  return (
    <section className="step" aria-labelledby="scan-title">
      <header className="step-head">
        <h1 id="scan-title">This PC</h1>
        <p className="lead">
          Measured by <code>lefi hw --json</code>. Values that cannot be measured are shown as
          unknown.
        </p>
      </header>

      {busy ? <Spinner label="Scanning hardware…" /> : null}
      {error ? <ErrorBox error={error} title="The hardware scan failed" /> : null}

      {hw && !busy ? (
        <>
          <div className="fact-grid">
            <Fact
              icon="computer"
              label="Computer"
              value={hw.host.model ?? hw.host.name ?? 'unknown'}
              note={`${hw.os.name ?? hw.os.kernel} · ${hw.os.arch}`}
            />
            <Fact
              icon="developer_board"
              label="Processor"
              value={hw.cpu.model ?? 'unknown'}
              note={hw.cpu.cores ? `${hw.cpu.cores} cores` : null}
              unknown={!hw.cpu.model}
            />
            <Fact
              icon="memory_alt"
              label="Memory"
              value={fmtGb(hw.memory.total_gb)}
              unknown={hw.memory.total_gb == null}
            />
            <Fact
              icon="neurology"
              label="AI accelerator"
              value={acc && acc.kind !== 'none' ? (acc.name ?? acc.kind) : 'None usable (CPU only)'}
              note={acc?.memory_gb != null ? `${fmtGb(acc.memory_gb)} GPU memory` : acc?.basis}
              unknown={!!acc && acc.kind !== 'none' && acc.memory_gb == null}
            />
            <Fact
              icon="hard_drive"
              label="Free disk"
              value={fmtGb(hw.disk.free_gb)}
              note={
                hw.disk.total_gb != null
                  ? `of ${fmtGb(hw.disk.total_gb)} at ${hw.disk.path}`
                  : hw.disk.path
              }
              unknown={hw.disk.free_gb == null}
            />
            <Fact
              icon={hw.power.source === 'battery' ? 'battery_5_bar' : 'power'}
              label="Power"
              value={
                hw.power.source === 'ac'
                  ? 'Plugged in'
                  : hw.power.source === 'battery'
                    ? 'On battery'
                    : 'unknown'
              }
              note={
                hw.power.battery_percent != null ? `Battery ${hw.power.battery_percent}%` : null
              }
              unknown={!hw.power.source}
            />
          </div>

          <div className="card">
            <h2 className="card-title">
              <Icon name="lan" /> Network ports
            </h2>
            {busyPorts.length ? (
              <ul className="plain-list">
                {busyPorts.map((p) => (
                  <li key={p.port}>
                    Port <strong>{p.port}</strong> is in use{p.process ? ` by ${p.process}` : ''} —
                    fine if it is a Lefi Crop service being re-installed.
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">All ports Lefi Crop uses are free.</p>
            )}
            {hw.platform.ollama_installed ? (
              <p className="muted">
                Ollama {hw.platform.ollama_version ?? ''} is already installed.
              </p>
            ) : null}
          </div>

          {hw.unknown.length ? (
            <div className="card card-warn">
              <h2 className="card-title">
                <Icon name="help" /> Not measurable here
              </h2>
              <ul className="plain-list">
                {hw.unknown.map((u) => (
                  <li key={u.field}>
                    <code>{u.field}</code>: {u.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}

      <footer className="actions">
        <button type="button" className="btn" onClick={onBack}>
          Back
        </button>
        <span className="grow" />
        <button type="button" className="btn" onClick={scan} disabled={busy}>
          <Icon name="refresh" /> Scan again
        </button>
        <button type="button" className="btn btn-primary" disabled={!hw || busy} onClick={onNext}>
          Choose roles <Icon name="arrow_forward" />
        </button>
      </footer>
    </section>
  );
}
