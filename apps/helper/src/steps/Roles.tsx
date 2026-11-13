import { useEffect, useMemo, useRef, useState } from 'react';
import { asSetupError, setupApi } from '../api';
import type { AiNodeCheck, Role, SetupAnswers, SetupContext } from '../api';
import { fleetApi, findAiNodes } from '../fleet';
import type { FleetStatus, FoundAiNode } from '../fleet';
import { ROLE_PORTS } from '../hw';
import type { HwReport } from '../hw';
import { FIT_LABEL, ROLE_INFO } from '../messages';
import { Badge, Banner, Disclosure, Icon, Spinner } from '../ui';
import type { Tone } from '../ui';

const ROLES: Role[] = ['ai', 'core', 'admin', 'desktop'];

function fitTone(fit: string | undefined): Tone {
  if (fit === 'ok' || fit === 'gpu') return 'ok';
  if (fit === 'no') return 'crit';
  return 'warn';
}

function Toggle({
  checked,
  onChange,
  label,
  help,
  danger,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  help: string;
  danger?: boolean;
}) {
  return (
    <label className={`toggle ${danger ? 'toggle-danger' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="toggle-label">{label}</span>
        <span className="toggle-help">{help}</span>
      </span>
    </label>
  );
}

/** Problems the UI can see before asking the installer; the Rust side validates again. */
function rolesProblem(a: SetupAnswers, aiViable: boolean): string | null {
  if (!a.roles.length) return 'Choose at least one role for this PC.';
  if (a.roles.includes('ai') && !aiViable && !a.dev_allow_no_ai)
    return 'This PC cannot run a supported model on its GPU.';
  if (a.roles.includes('core') && !a.roles.includes('ai') && !a.ai_url?.trim())
    return 'A core PC without the AI role needs the address of the AI node.';
  return null;
}

/** A test result, with the address exactly as it was typed. */
export type TestedAiNode = AiNodeCheck & { typed: string };

/** The AI node passed the connection test, for the address now typed. */
export function aiNodeProblem(a: SetupAnswers, check: TestedAiNode | null): string | null {
  if (!a.roles.includes('core') || a.roles.includes('ai')) return null;
  const typed = a.ai_url?.trim() ?? '';
  if (!typed) return null; // rolesProblem already asks for the address
  if (!check || check.typed !== typed) return 'Test the connection to the AI node first.';
  if (!check.reachable) return 'The AI node does not answer at this address.';
  if (!check.models.length) return 'That address does not serve a supported AI model.';
  return null;
}

export function RolesStep({
  ctx,
  hw,
  answers,
  onChange,
  onBack,
  onNext,
  onOtherPcs,
}: {
  ctx: SetupContext;
  hw: HwReport;
  answers: SetupAnswers;
  onChange: (a: SetupAnswers) => void;
  onBack: () => void;
  onNext: () => void;
  onOtherPcs: () => void;
}) {
  const [check, setCheck] = useState<TestedAiNode | null>(null);
  const [testing, setTesting] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const testAddress = (typed: string) => {
    setTesting(true);
    setCheckError(null);
    setCheck(null);
    setupApi
      .checkAiNode(typed)
      .then(
        (c) => setCheck({ ...c, typed }),
        (e) => setCheckError(asSetupError(e).message),
      )
      .finally(() => setTesting(false));
  };
  const testAiNode = () => testAddress(answers.ai_url?.trim() ?? '');

  // This main PC already talks to the other PCs: find their AI instead of asking for an address.
  const remoteAi = answers.roles.includes('core') && !answers.roles.includes('ai');
  const [fleet, setFleet] = useState<FleetStatus | null>(null);
  const [fleetRead, setFleetRead] = useState(false);
  useEffect(() => {
    if (!remoteAi) return;
    let alive = true;
    const read = () =>
      fleetApi
        .status()
        .then((s) => alive && setFleet(s))
        .catch(() => undefined)
        .finally(() => alive && setFleetRead(true));
    void read();
    const t = setInterval(read, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [remoteAi]);
  const supported = useMemo(() => ctx.supported_models.map((m) => m.tag), [ctx.supported_models]);
  const found = useMemo(() => findAiNodes(fleet, supported), [fleet, supported]);
  const typedNow = answers.ai_url?.trim() ?? '';
  // Choose the PC by itself and test it once. Whatever the person typed is left alone.
  const autoTested = useRef('');
  const chosenFound = found.find((f) => f.url === typedNow);
  useEffect(() => {
    if (!remoteAi) return;
    const target = chosenFound ?? (typedNow ? undefined : found.find((f) => f.online));
    if (!target || autoTested.current === target.url) return;
    autoTested.current = target.url;
    if (typedNow !== target.url) onChange({ ...answers, ai_url: target.url });
    testAddress(target.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteAi, found, typedNow]);
  const otherPcs = fleet?.service === 'running' ? fleet.nodes.filter((n) => !n.revoked) : [];
  const rec = hw.recommendation;
  const aiViable = rec.verdict !== 'not_viable';
  const has = (r: Role) => answers.roles.includes(r);
  const set = (patch: Partial<SetupAnswers>) => onChange({ ...answers, ...patch });
  const toggleRole = (r: Role) =>
    set({
      roles: has(r) ? answers.roles.filter((x) => x !== r) : ROLES.filter((x) => x === r || has(x)),
    });

  const busyPorts = hw.ports.filter(
    (p) => p.in_use && answers.roles.some((r) => ROLE_PORTS[r].includes(p.port)),
  );
  const problem = rolesProblem(answers, aiViable) ?? aiNodeProblem(answers, check);
  const currentCheck = check && check.typed === (answers.ai_url?.trim() ?? '') ? check : null;

  return (
    <section className="step" aria-labelledby="roles-title">
      <header className="step-head">
        <h1 id="roles-title">What should this PC run?</h1>
        <p className="lead">
          Choose what this PC runs. The AI can run here or on another PC of the same network.
        </p>
      </header>

      {!aiViable ? (
        <Banner tone="warn" icon="neurology">
          <strong>This PC cannot take the AI role.</strong> {rec.reason} Lefi Crop requires its
          local AI, so this PC can only be the core node of an installation whose AI node is another
          PC on the LAN.
        </Banner>
      ) : null}

      <div className="choice-grid choice-grid-3">
        {ROLES.map((r) => {
          const info = ROLE_INFO[r];
          const disabled = r === 'ai' && !aiViable && !answers.dev_allow_no_ai;
          return (
            <button
              key={r}
              type="button"
              role="checkbox"
              aria-checked={has(r)}
              disabled={disabled}
              className={`choice ${has(r) ? 'choice-on' : ''}`}
              onClick={() => toggleRole(r)}
            >
              <Icon
                name={has(r) ? 'check_box' : 'check_box_outline_blank'}
                className="choice-check"
              />
              <Icon name={info.icon} className="choice-icon" />
              <span className="choice-title">{info.title}</span>
              <span className="choice-body">{info.body}</span>
            </button>
          );
        })}
      </div>

      {has('ai') ? (
        <div className="card">
          <h2 className="card-title">
            <Icon name="model_training" /> Model
          </h2>
          <div className="model-list" role="radiogroup" aria-label="Model">
            <label className={`model ${answers.model === 'recommended' ? 'model-on' : ''}`}>
              <input
                type="radio"
                name="model"
                checked={answers.model === 'recommended'}
                onChange={() => set({ model: 'recommended' })}
              />
              <span>
                <span className="model-title">
                  Recommended{rec.model ? `: ${rec.model}` : ''}{' '}
                  <Badge tone={rec.verdict === 'ok' ? 'ok' : 'warn'}>
                    {rec.verdict === 'ok' ? 'fits' : 'to be confirmed'}
                  </Badge>
                </span>
                <span className="model-why">{rec.reason}</span>
              </span>
            </label>
            {ctx.supported_models.map((m) => {
              const fit = rec.models.find((x) => x.tag === m.tag);
              return (
                <label key={m.tag} className={`model ${answers.model === m.tag ? 'model-on' : ''}`}>
                  <input
                    type="radio"
                    name="model"
                    checked={answers.model === m.tag}
                    onChange={() => set({ model: m.tag })}
                  />
                  <span>
                    <span className="model-title">
                      {m.label} <code>{m.tag}</code>{' '}
                      <Badge tone={fitTone(fit?.fit)}>{FIT_LABEL[fit?.fit ?? 'unknown']}</Badge>
                    </span>
                    <span className="model-why">
                      {m.mem_gb != null
                        ? `Measured ${m.mem_gb} GB at context ${m.ctx ?? '?'} (${m.measured_on ?? '?'}). `
                        : 'Footprint not measured yet. '}
                      {fit?.why}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <p className="muted">
            After installing, a real generation must run with the whole model in GPU memory,
            otherwise the install stops.
          </p>
        </div>
      ) : null}

      {has('core') && !has('ai') ? (
        <div className="card">
          <h2 className="card-title">
            <Icon name="neurology" /> The AI runs on another PC
          </h2>
          {found.length ? (
            <div className="model-list" role="radiogroup" aria-label="AI node">
              {found.map((f: FoundAiNode) => (
                <label key={f.id} className={`model ${typedNow === f.url ? 'model-on' : ''}`}>
                  <input
                    type="radio"
                    name="ai-node"
                    checked={typedNow === f.url}
                    onChange={() => {
                      autoTested.current = '';
                      set({ ai_url: f.url });
                    }}
                  />
                  <span>
                    <span className="model-title">
                      {f.name}{' '}
                      <Badge tone={f.online ? 'ok' : 'warn'}>
                        {f.online ? 'Online' : 'No signal now'}
                      </Badge>
                    </span>
                    <span className="model-why">
                      {f.url} · {f.models.join(', ')}
                      {f.bench ? ` · ${f.bench.tokens_per_s} tokens/s measured` : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ) : !fleetRead ? (
            <Spinner label="Looking for the AI on your other nodes…" />
          ) : otherPcs.length ? (
            <Banner tone="warn" icon="neurology">
              <strong>
                {otherPcs.map((n) => n.name).join(', ')} {otherPcs.length === 1 ? 'has' : 'have'} no
                AI ready yet.
              </strong>{' '}
              Install the AI on one of them in Nodes. This page finds it by itself.
            </Banner>
          ) : (
            <Banner tone="info" icon="lan">
              <strong>No other node has joined yet.</strong> Add the PC that will run the AI in
              Nodes and install its AI node there. This page finds it by itself.
            </Banner>
          )}
          {testing ? <Spinner label="Testing the connection from this PC…" /> : null}
          {checkError ? (
            <Banner tone="crit" icon="error">
              {checkError}
            </Banner>
          ) : null}
          {currentCheck && !currentCheck.reachable ? (
            <Banner tone="crit" icon="wifi_off">
              <strong>Nothing answers at {currentCheck.url}.</strong> Check that the other PC is on,
              on this network, and that its AI accepts connections from the network.
            </Banner>
          ) : null}
          {currentCheck?.reachable && !currentCheck.models.length ? (
            <Banner tone="warn" icon="neurology">
              <strong>It answers, but serves no supported AI model.</strong> Install the AI on that
              PC, or check the address.
            </Banner>
          ) : null}
          {currentCheck?.models.length ? (
            <Banner tone="ok" icon="verified">
              <strong>Connected.</strong> It serves {currentCheck.models.join(', ')}. While
              installing, a real generation checks that the whole model runs on that PC&apos;s GPU.
            </Banner>
          ) : null}
          <div className="row-end">
            {typedNow && !testing && !currentCheck?.models.length ? (
              <button type="button" className="btn" onClick={testAiNode}>
                <Icon name="refresh" /> Test again
              </button>
            ) : null}
            <button type="button" className="btn" onClick={onOtherPcs}>
              <Icon name="lan" /> Nodes
            </button>
          </div>
          <Disclosure title="Use another address" open={!!typedNow && !chosenFound}>
            <label className="field">
              <span className="field-label">Address of that PC</span>
              <input
                className="input"
                type="url"
                inputMode="url"
                placeholder="http://<its address>:11434"
                value={answers.ai_url ?? ''}
                onChange={(e) => set({ ai_url: e.target.value })}
              />
            </label>
            <div className="row-end">
              <button
                type="button"
                className="btn"
                disabled={testing || !answers.ai_url?.trim()}
                onClick={testAiNode}
              >
                <Icon name="wifi_find" /> {testing ? 'Testing…' : 'Test connection'}
              </button>
            </div>
          </Disclosure>
        </div>
      ) : null}

      <div className="card">
        <h2 className="card-title">
          <Icon name="settings" /> Options
        </h2>
        {has('ai') && !has('core') ? (
          <Toggle
            checked={answers.ai_lan}
            onChange={(v) => set({ ai_lan: v })}
            label="Let the core node reach this AI over the LAN"
            help="Ollama listens on the network. It has no password, so the firewall must allow only the core node."
          />
        ) : null}
        {has('admin') ? (
          <Toggle
            checked={answers.admin_https}
            onChange={(v) => set({ admin_https: v })}
            label="Use HTTPS on Lefi Gateway (recommended)"
            help="Encrypts passwords and data on your network. Nothing to install: Lefi Desktop will trust it when it is paired."
          />
        ) : null}
        <Toggle
          checked={answers.stop_conflicting_services}
          onChange={(v) => set({ stop_conflicting_services: v })}
          label="Stop other services that hold Lefi Crop's ports"
          help={
            busyPorts.length
              ? `In use now: ${busyPorts.map((p) => `${p.port}${p.process ? ` (${p.process})` : ''}`).join(', ')}.`
              : 'For example another Ollama server or a distribution MQTT broker. None is using the ports now.'
          }
        />
        {has('ai') ? (
          <Toggle
            checked={answers.update_model}
            onChange={(v) => set({ update_model: v })}
            label="Check online for a newer copy of the model"
            help="Only matters when the model is already downloaded."
          />
        ) : null}
        {ctx.debug_build ? (
          <div className="dev-options">
            <span className="dev-options-title">Development build only</span>
            {ctx.os === 'linux' ? (
              <Toggle
                checked={answers.service_mode === 'user'}
                onChange={(v) => set({ service_mode: v ? 'user' : 'systemd' })}
                label="Linux user mode (no root, nothing starts at boot)"
                help="The developer mode of the installer. Customers always get system services."
              />
            ) : null}
            <Toggle
              danger
              checked={answers.dev_allow_no_ai}
              onChange={(v) => set({ dev_allow_no_ai: v })}
              label="Continue without a viable AI (--dev-allow-no-ai)"
              help="For CI and GPU-less test machines. Recorded in the configuration; lefi check reports it as a FAIL."
            />
          </div>
        ) : null}
      </div>

      <footer className="actions">
        <button type="button" className="btn" onClick={onBack}>
          Back
        </button>
        <span className="grow" />
        {problem ? <span className="problem">{problem}</span> : null}
        <button type="button" className="btn btn-primary" disabled={!!problem} onClick={onNext}>
          Review the plan <Icon name="arrow_forward" />
        </button>
      </footer>
    </section>
  );
}
