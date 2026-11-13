import { useEffect, useRef, useState } from 'react';
import { asSetupError } from '../api';
import type { SetupError } from '../api';
import { eraseApi, finished, nodeOutcome, reasonText } from '../erase';
import type { EraseNode, ErasePlan, NodeOutcome } from '../erase';
import { fleetApi } from '../fleet';
import type { CommandRecord } from '../fleet';
import { applyMsg, emptyRun, firstFailure, stepPercent } from '../progress';
import type { RunView } from '../progress';
import { Banner, Bar, ErrorBox, Icon } from '../ui';
import { AdminFields, useAdminAuth } from './AdminFields';
import { CopyLine } from './Fleet';
import { StepRow } from './Install';

type Phase = 'idle' | 'confirm' | 'nodes' | 'nodes-done' | 'this-pc' | 'done';

const OUTCOME: Record<NodeOutcome, { icon: string; text: string }> = {
  waiting: { icon: 'schedule', text: 'Waiting for it…' },
  running: { icon: 'progress_activity', text: 'Erasing…' },
  erased: { icon: 'check_circle', text: 'Erased' },
  failed: { icon: 'error', text: 'Not erased' },
  skipped: { icon: 'block', text: 'Not reached from here' },
};

function ManualScript({ plan }: { plan: ErasePlan }) {
  return (
    <details className="erase-manual">
      <summary>How to erase a PC by hand</summary>
      <p className="muted">
        In Terminal on that Mac, signed in as the user who joined it. It asks for that Mac&apos;s
        password once.
      </p>
      <CopyLine text={plan.manual_script} />
    </details>
  );
}

/** "Erase Lefi Crop from every PC" (ADR-054): the other PCs, then this one, then this app. */
export function EraseEverything() {
  const admin = useAdminAuth();
  const [phase, setPhase] = useState<Phase>('idle');
  const [plan, setPlan] = useState<ErasePlan | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [nodes, setNodes] = useState<EraseNode[]>([]);
  const [records, setRecords] = useState<Record<string, CommandRecord>>({});
  const [run, setRun] = useState<RunView | null>(null);
  const [error, setError] = useState<SetupError | null>(null);
  const [busy, setBusy] = useState(false);
  const authRef = useRef(admin.auth);
  authRef.current = admin.auth;

  const open = () => {
    setError(null);
    setPhase('confirm');
    eraseApi.plan().then(setPlan, (e) => setError(asSetupError(e)));
  };

  const outcomes = nodes.map((n) => nodeOutcome(n, records[n.id]));
  const allFinished = outcomes.every(finished);

  // Follow every PC's erase until each one is erased or has failed.
  useEffect(() => {
    if (phase !== 'nodes') return;
    if (allFinished) {
      const done = setTimeout(() => setPhase('nodes-done'), 0);
      return () => clearTimeout(done);
    }
    const t = setTimeout(() => {
      nodes
        .filter((n) => n.command_id && !finished(nodeOutcome(n, records[n.id])))
        .forEach((n) =>
          fleetApi.command(n.command_id as string).then(
            (d) => setRecords((r) => ({ ...r, [n.id]: d.record })),
            () => undefined,
          ),
        );
    }, 2000);
    return () => clearTimeout(t);
  }, [phase, nodes, records, allFinished]);

  // Every other PC erased (or none): this PC follows by itself.
  useEffect(() => {
    if (phase !== 'nodes-done' || !outcomes.every((o) => o === 'erased')) return;
    const t = setTimeout(eraseThisPc, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const start = () => {
    setBusy(true);
    setError(null);
    eraseApi
      .nodes(admin.auth)
      .then(
        (r) => {
          setNodes(r.nodes);
          setPhase('nodes');
        },
        (e) => setError(asSetupError(e)),
      )
      .finally(() => setBusy(false));
  };

  function eraseThisPc() {
    setPhase('this-pc');
    setError(null);
    setRun(emptyRun);
    eraseApi
      .thisPc(authRef.current, (m) => setRun((v) => applyMsg(v ?? emptyRun, m)))
      .then(
        (r) => {
          if (r.exit_code === 0) {
            admin.clear();
            setPhase('done');
          } else {
            setPhase('nodes-done');
          }
        },
        (e) => {
          setError(asSetupError(e));
          setPhase('nodes-done');
        },
      );
  }

  const quit = () => {
    setBusy(true);
    eraseApi.quit().catch((e) => {
      setError(asSetupError(e));
      setBusy(false);
    });
  };

  const failure = run ? firstFailure(run) : undefined;
  const leftovers = nodes.filter((n) => records[n.id]?.leftover);
  const notErased = nodes.filter((_, i) => outcomes[i] !== 'erased');
  const stoppedWithNodes = plan && !plan.service_running && (plan.registered_nodes ?? 0) > 0;

  const nodeList = (
    <ul className="erase-nodes">
      {nodes.map((n, i) => {
        const oc: NodeOutcome = outcomes[i] ?? 'waiting';
        const o = OUTCOME[oc];
        const rec = records[n.id];
        return (
          <li key={n.id}>
            <Icon name={o.icon} /> <strong>{n.name}</strong>{' '}
            <span className="muted">
              ({n.hostname}, {n.ip})
            </span>{' '}
            — {o.text}
            {oc === 'running' && rec?.current_step ? `: ${rec.current_step}` : ''}
            {oc === 'skipped' ? <p className="muted">{reasonText(n)}</p> : null}
            {oc === 'failed' && rec?.error ? <p className="muted">{rec.error}</p> : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="card card-danger">
      <h2 className="card-title">
        <Icon name="restart_alt" /> Erase Lefi Crop from every PC
      </h2>
      <p className="muted">
        Back to before Lefi Crop, to start again from zero: the other PCs of this installation, this
        PC with Lefi Brain and its database, the licence, and finally Lefi Crop Helper itself.
      </p>

      {phase === 'idle' ? (
        <div className="row-end">
          <button type="button" className="btn btn-danger" onClick={open}>
            Erase everything…
          </button>
        </div>
      ) : null}

      {phase === 'confirm' ? (
        <div className="confirm" role="alertdialog">
          <p>
            <strong>
              This deletes every reading, alert, user and setting, on every PC, and cannot be
              undone.
            </strong>{' '}
            The licence goes too: installing again needs a new activation code, because this PC gets
            a new installation ID. Homebrew, Ollama and the AI models that were on a PC before Lefi
            Crop stay.
          </p>
          {plan ? (
            <>
              <p>
                <strong>Other PCs</strong>
              </p>
              {plan.nodes.length ? (
                <ul className="erase-nodes">
                  {plan.nodes.map((n) => (
                    <li key={n.id}>
                      <Icon name={n.erasable ? 'check_circle' : 'warning'} />{' '}
                      <strong>{n.name}</strong>{' '}
                      <span className="muted">
                        ({n.hostname}, {n.ip})
                      </span>{' '}
                      — {n.erasable ? 'erased from here' : reasonText(n)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  {stoppedWithNodes
                    ? `The Lefi Crop Helper service is stopped, so the ${plan.registered_nodes} other PC(s) cannot be reached. Start it in Nodes first, or erase them by hand.`
                    : 'None joined this installation.'}
                </p>
              )}
              {plan.nodes.some((n) => !n.erasable) || stoppedWithNodes ? (
                <ManualScript plan={plan} />
              ) : null}
            </>
          ) : (
            <p className="muted">Looking at the other PCs…</p>
          )}
          <AdminFields a={admin} />
          <label className="toggle">
            <input
              type="checkbox"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
            />
            <span>
              <span className="toggle-label">
                I understand that everything is deleted on every PC, the licence included
              </span>
            </span>
          </label>
          {error ? <ErrorBox error={error} title="Nothing was erased" /> : null}
          <div className="row-end">
            <button type="button" className="btn" disabled={busy} onClick={() => setPhase('idle')}>
              Back
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy || !plan || !understood || !admin.ready}
              onClick={start}
            >
              {busy ? 'Starting…' : 'Erase everything'}
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'nodes' || phase === 'nodes-done' ? (
        <div className="confirm">
          <p>
            <strong>1. The other PCs</strong>
          </p>
          {nodes.length ? nodeList : <p className="muted">No other PC to erase.</p>}
          {error ? <ErrorBox error={error} title="This PC was not erased" /> : null}
          {failure ? (
            <Banner tone="crit" icon="error">
              <strong>{failure.message}</strong>
              {failure.hint ? <p>{failure.hint}</p> : null}
            </Banner>
          ) : null}
          {phase === 'nodes-done' ? (
            <>
              {notErased.length && plan ? (
                <Banner tone="warn" icon="warning">
                  <strong>
                    {notErased.length} PC(s) were not erased. After this PC is erased they can only
                    be erased by hand.
                  </strong>
                  <ManualScript plan={plan} />
                </Banner>
              ) : null}
              <div className="row-end">
                <button type="button" className="btn btn-danger" onClick={eraseThisPc}>
                  {error || failure ? 'Try this PC again' : 'Continue: erase this PC'}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {phase === 'this-pc' ? (
        <div className="confirm">
          <p>
            <strong>2. This PC</strong>
          </p>
          {run?.started ? (
            <>
              <Bar percent={stepPercent(run)} label="Erase progress" />
              <ol className="timeline">
                {run.steps.map((s) => (
                  <StepRow key={s.id} s={s} />
                ))}
              </ol>
            </>
          ) : (
            <p className="muted">Stopping the Lefi Crop Helper service…</p>
          )}
        </div>
      ) : null}

      {phase === 'done' ? (
        <>
          <Banner tone="ok" icon="verified">
            <strong>Lefi Crop was erased from this PC</strong>
            {nodes.length
              ? ` and from ${nodes.length - notErased.length} of ${nodes.length} other PC(s).`
              : '.'}
          </Banner>
          {leftovers.length ? (
            <div className="confirm">
              <p>
                One file stays on these PCs, owned by their administrator (it does nothing now). To
                remove it, run this in Terminal on each one:
              </p>
              {leftovers.map((n) => (
                <div key={n.id}>
                  <strong>{n.name}</strong> ({n.hostname})
                  <CopyLine text={records[n.id]?.leftover ?? ''} />
                </div>
              ))}
            </div>
          ) : null}
          {notErased.length && plan ? (
            <Banner tone="warn" icon="warning">
              <strong>
                Not erased: {notErased.map((n) => n.name).join(', ')}. Erase them by hand.
              </strong>
              <ManualScript plan={plan} />
            </Banner>
          ) : null}
          <p className="muted">
            Last step: Lefi Crop Helper closes and removes itself, its licence and its logs. To
            install again, open a new copy of Lefi Crop Helper.
          </p>
          {error ? (
            <ErrorBox error={error} title="Lefi Crop Helper could not remove itself" />
          ) : null}
          <div className="row-end">
            <button type="button" className="btn btn-danger" disabled={busy} onClick={quit}>
              <Icon name="logout" /> Remove Lefi Crop Helper and close
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
