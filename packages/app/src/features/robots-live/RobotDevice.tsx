import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  robotics,
  roboticsKeys,
  roboticsQueries,
  type SimRobot,
  type SimRobotBackend,
  type SimRobotPlace,
} from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { Badge, Button, EmptyState, Icon, Skeleton, useToast } from '../../shared/ui';
import { useCan } from '../session/useSession';
import styles from './robotsLive.module.css';

/** Why the simulated robot may not go on a PC (ADR-090), as Lefi Brain reports it. */
const PLACE_REASON: Record<string, string> = {
  ai_node: 'Runs the AI node — the robot goes on a PC without it, so both keep their performance',
  other_pc: 'Not yet: for now the simulated robot runs only on the main PC',
  offline: 'Not connected',
};

const POWER_LABEL: Record<string, string> = {
  on: 'On',
  starting: 'Starting… (the 3D scene takes 1–2 minutes)',
  off: 'Off',
  unknown: 'Unknown — Lefi Crop Helper is not answering',
};

function useRobotMutation<A>(fn: (a: A) => Promise<unknown>, ok: string) {
  const qc = useQueryClient();
  const toast = useToast((t) => t.show);
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roboticsKeys.all });
      toast(ok, 'ok');
    },
    onError: (e) => toast(describeError(e), 'bad'),
  });
}

/**
 * Add the simulated MH3 (ADR-090): Lefi Brain asks Lefi Crop Helper to install it on the chosen PC.
 * Only a PC without the AI node can be chosen; the others say why. Nothing to type in a terminal.
 */
export function AddRobotForm({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const platform = usePlatform();
  const places = useQuery(roboticsQueries.places(platform));
  const [node, setNode] = useState<string>();
  const [backend, setBackend] = useState<SimRobotBackend>('genesis');
  const [cpu, setCpu] = useState(false);
  const eligible = (places.data ?? []).filter((p) => p.eligible);
  const chosen = node ?? eligible[0]?.node_id;
  const add = useRobotMutation(
    () => robotics.add(platform, { node_id: chosen ?? '', backend, cpu }),
    'Installing the simulated robot. Its progress shows in Devices & Health → Robots.',
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate(undefined, { onSuccess: onAdded });
  };

  return (
    <form onSubmit={submit}>
      <div className={styles.addRobot}>
        <span className={styles.eyebrow}>Where it runs</span>
        {places.isError ? (
          <span className={styles.err}>{describeError(places.error)}</span>
        ) : !places.data ? (
          <Skeleton height={80} />
        ) : (
          <div className={styles.places} role="radiogroup" aria-label="PC for the robot">
            {places.data.map((p: SimRobotPlace) => (
              <label key={p.node_id} className={styles.place} data-disabled={!p.eligible}>
                <input
                  type="radio"
                  name="robot-place"
                  value={p.node_id}
                  disabled={!p.eligible}
                  checked={chosen === p.node_id}
                  onChange={() => setNode(p.node_id)}
                />
                <span className={styles.placeText}>
                  <b>
                    {p.name}
                    {p.is_main ? ' · main PC' : ''}
                  </b>
                  <span className={styles.faint}>
                    {p.eligible
                      ? 'Can run the simulated robot'
                      : (PLACE_REASON[p.reason ?? ''] ?? p.reason)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
        <span className={styles.eyebrow}>Simulation</span>
        <div className={styles.places} role="radiogroup" aria-label="Simulation">
          <label className={styles.place}>
            <input
              type="radio"
              name="robot-backend"
              checked={backend === 'genesis'}
              onChange={() => setBackend('genesis')}
            />
            <span className={styles.placeText}>
              <b>3D · MH3 in Genesis</b>
              <span className={styles.faint}>
                The real MH3 model, 3D views and what its camera sees. Needs a Mac with Apple
                Silicon (macOS 14+); downloads several GB once.
              </span>
            </span>
          </label>
          <label className={styles.place}>
            <input
              type="radio"
              name="robot-backend"
              checked={backend === 'lite'}
              onChange={() => setBackend('lite')}
            />
            <span className={styles.placeText}>
              <b>2D · map only</b>
              <span className={styles.faint}>
                A point on the map, missions and commands. No GPU, no 3D views, no MH3 model.
              </span>
            </span>
          </label>
        </div>
        {backend === 'genesis' && (
          <label className={styles.checkRow}>
            <input type="checkbox" checked={cpu} onChange={(e) => setCpu(e.target.checked)} />
            <span>Physics on the CPU (slower; only if the PC has no usable GPU)</span>
          </label>
        )}
        <p className={styles.note}>
          Simulation only: no physical robot is moved. The MH3 model belongs to Mirsee Robotics and
          may be used only for the GDG Windsor hackathon. The robot stays off until someone turns it
          on.
        </p>
      </div>
      <div className={styles.dialogFoot}>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" icon="download" disabled={add.isPending || !chosen}>
          Install simulated robot
        </Button>
      </div>
    </form>
  );
}

/** Why the robot is off, as Lefi Brain reports it (ADR-104). */
const POWER_PROBLEM: Record<string, string> = {
  starter_missing:
    'The MH3 starter is missing on its PC (older versions kept it inside Lefi Crop Helper, and an update removed it). Reinstall the robot.',
  program_missing: 'Files the simulated robot needs are missing on its PC. Reinstall the robot.',
  stopped: 'It stopped by itself after being turned on. Its last log lines say why.',
  power_failed: 'It could not be turned on or off.',
};
const NEEDS_REINSTALL = new Set(['starter_missing', 'program_missing']);

/** Turn the simulated robot on or off: `robot.command` or `device.manage` (ADR-090). */
function RobotPowerButton({ robot }: { robot: SimRobot }) {
  const platform = usePlatform();
  const canCommand = useCan('robot.command');
  const canManage = useCan('device.manage');
  const can = canCommand || canManage;
  const on = robot.power === 'on' || robot.power === 'starting';
  const power = useRobotMutation(
    (v: boolean) => robotics.power(platform, robot.id, v),
    on ? 'The simulated robot was turned off.' : 'Turning on the simulated robot…',
  );
  if (robot.device?.status !== 'installed') return null;
  const problem = robot.power_detail?.problem;
  const blocked = !!problem && NEEDS_REINSTALL.has(problem);
  return (
    <Button
      variant={on ? 'secondary' : 'primary'}
      icon={power.isPending ? undefined : 'power_settings_new'}
      disabled={!can || power.isPending || robot.power === 'unknown' || (!on && blocked)}
      title={
        !can
          ? 'Turning the robot on needs robot.command or device.manage'
          : blocked && !on
            ? 'Reinstall the robot first'
            : undefined
      }
      aria-busy={power.isPending}
      onClick={() => power.mutate(!on)}
    >
      {power.isPending && <span className={styles.spinner} aria-hidden />}
      {power.isPending
        ? on
          ? 'Turning off…'
          : 'Turning on…'
        : robot.power === 'starting'
          ? 'Cancel start'
          : on
            ? 'Turn off robot'
            : 'Turn on robot'}
    </Button>
  );
}

/** Install the robot again on the same PC, same simulation (ADR-104): `device.manage`. */
function RobotReinstallButton({ robot, primary }: { robot: SimRobot; primary?: boolean }) {
  const platform = usePlatform();
  const canManage = useCan('device.manage');
  const [asking, setAsking] = useState(false);
  const reinstall = useRobotMutation(
    () => robotics.reinstall(platform, robot.id),
    'Reinstalling the simulated robot. Its progress shows in Devices & Health → Robots.',
  );
  const d = robot.device;
  if (!canManage || !d || (d.status !== 'installed' && d.status !== 'install_failed')) return null;
  if (!asking)
    return (
      <Button
        variant={primary ? 'primary' : 'secondary'}
        size={primary ? 'md' : 'sm'}
        icon="restart_alt"
        disabled={reinstall.isPending}
        onClick={() => setAsking(true)}
      >
        Reinstall
      </Button>
    );
  return (
    <span className={styles.row}>
      <span className={styles.faint}>
        Install everything again on {d.node_name}
        {d.backend === 'genesis' ? ' (downloads what is missing)' : ''}?
      </span>
      <Button
        size="sm"
        icon="restart_alt"
        disabled={reinstall.isPending}
        onClick={() => reinstall.mutate(undefined, { onSettled: () => setAsking(false) })}
      >
        Reinstall
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  );
}

/** Seconds since the robot was seen starting, counted here (no clock comparison with Lefi Brain). */
function useStartingFor(starting: boolean): number {
  const [secs, setSecs] = useState(0);
  const [was, setWas] = useState(starting);
  if (was !== starting) {
    setWas(starting);
    setSecs(0);
  }
  useEffect(() => {
    if (!starting) return;
    const t = setInterval(() => setSecs((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [starting]);
  return starting ? secs : 0;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * The robot's power state, always shown (ADR-104): on, starting (with the time it has taken and
 * what the simulator is printing), off, or why it is off with what to do. Everything is SIMULATED.
 */
export function RobotPowerStatus({ robot }: { robot: SimRobot }) {
  const d = robot.device;
  const power = robot.power ?? 'unknown';
  const detail = robot.power_detail;
  const starting = power === 'starting';
  const secs = useStartingFor(starting);
  const [showLog, setShowLog] = useState(false);
  if (!d || d.status !== 'installed') return null;
  const problem = power === 'on' || starting ? null : (detail?.problem ?? null);
  const tone = problem ? 'bad' : power === 'on' ? 'ok' : starting ? 'busy' : 'off';
  const log = detail?.log_tail ?? null;
  const backend = d.backend === 'genesis' ? 'the 3D scene (1–2 minutes the first time)' : 'the map';
  return (
    <div className={styles.powerState} data-tone={tone} role="status" aria-live="polite">
      <div className={styles.powerHead}>
        {starting ? (
          <span className={styles.spinner} aria-hidden />
        ) : (
          <Icon
            name={
              problem
                ? 'error'
                : power === 'on'
                  ? 'check_circle'
                  : power === 'unknown'
                    ? 'help'
                    : 'power_off'
            }
            size={20}
          />
        )}
        <span>
          {starting ? (
            <>
              <b>Starting · {mmss(secs)}</b> — the simulator is running and building {backend}. It
              turns on when it answers.
            </>
          ) : power === 'on' ? (
            <>
              <b>On</b> — the simulator is answering on {d.node_name}.
            </>
          ) : problem ? (
            <>
              <b>Off · {POWER_PROBLEM[problem] ?? problem}</b>
              {detail?.message ? <span className={styles.mono}> {detail.message}</span> : null}
            </>
          ) : power === 'unknown' ? (
            <b>{POWER_LABEL.unknown}</b>
          ) : (
            <>
              <b>Off</b> — turn it on to see it and send it on missions.
            </>
          )}
        </span>
        <span className={styles.powerActions}>
          {problem && NEEDS_REINSTALL.has(problem) ? (
            <RobotReinstallButton robot={robot} primary />
          ) : (
            <RobotPowerButton robot={robot} />
          )}
        </span>
      </div>
      {log && (starting || problem) && (
        <>
          <button type="button" className={styles.logToggle} onClick={() => setShowLog(!showLog)}>
            {showLog || problem === 'stopped' ? 'Hide' : 'Show'} what the simulator printed
          </button>
          {(showLog || problem === 'stopped') && <pre className={styles.logTail}>{log}</pre>}
        </>
      )}
    </div>
  );
}

function InstallProgress({ robot }: { robot: SimRobot }) {
  const d = robot.device!;
  const p = d.progress;
  const pct = p.steps_total ? Math.round((100 * p.steps_done) / p.steps_total) : 0;
  return (
    <div className={styles.progress}>
      <div
        className={styles.bar}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={d.status === 'removing' ? 'Removing' : 'Installing'}
      >
        <i style={{ width: `${Math.max(pct, 4)}%` }} />
      </div>
      <span className={styles.faint}>
        {d.status === 'removing' ? 'Removing' : 'Installing'} · step {p.steps_done} of{' '}
        {p.steps_total || '…'}
        {p.title ? ` · ${p.title}` : ''}
      </span>
      {p.message && <span className={styles.mono}>{p.message}</span>}
    </div>
  );
}

/** Devices & Health → Robots: the simulated robot as a device of the installation. */
export function RobotsDevices({ onAdd }: { onAdd: () => void }) {
  const platform = usePlatform();
  const canManage = useCan('device.manage');
  const q = useQuery({ ...roboticsQueries.robots(platform), refetchInterval: 2_000 });
  const remove = useRobotMutation(
    (id: string) => robotics.remove(platform, id),
    'Removing the simulated robot and its download.',
  );
  if (q.isError)
    return (
      <EmptyState mascot="sad" title="Could not load the robots">
        {describeError(q.error)}
      </EmptyState>
    );
  if (!q.data) return <Skeleton height={200} />;
  const added = q.data.filter((r) => r.device);
  if (added.length === 0)
    return (
      <EmptyState
        mascot="curious"
        title="No simulated robot yet"
        action={
          canManage ? (
            <Button icon="add" onClick={onAdd}>
              Add simulated robot
            </Button>
          ) : undefined
        }
      >
        Add the simulated MH3: Lefi Crop Helper installs it on a PC without the AI node. Then send
        it on missions from the Robot Mission Center. No physical robot is involved.
      </EmptyState>
    );

  return (
    <div className={styles.robotCards}>
      {added.map((r) => {
        const d = r.device!;
        return (
          <section key={r.id} className={styles.card} aria-label={r.name}>
            <div className={styles.rowBetween}>
              <span className={styles.robotId}>
                <Icon name="smart_toy" size={24} />
                <span>
                  <b>{r.name}</b>
                  <span className={styles.faint}>
                    {r.id} · {d.backend === 'genesis' ? '3D · Genesis' : '2D · map only'} · on{' '}
                    {d.node_name}
                  </span>
                </span>
              </span>
              <Badge tone="sim" variant="tag">
                SIMULATED
              </Badge>
            </div>
            {d.status === 'installing' || d.status === 'removing' ? (
              <InstallProgress robot={r} />
            ) : d.status === 'install_failed' ? (
              <div className={styles.failed}>
                <b>The installation failed</b>
                <span className={styles.muted}>
                  {d.progress.message ?? 'See the installer log on that PC.'}
                  {d.progress.error_code ? ` (${d.progress.error_code})` : ''}
                </span>
              </div>
            ) : (
              <RobotPowerStatus robot={r} />
            )}
            <div className={styles.row}>
              {d.status === 'installed' && (
                <Link to="/robots" className={styles.link2}>
                  Open the Robot Mission Center →
                </Link>
              )}
              <RobotReinstallButton robot={r} />
              {canManage && (d.status === 'installed' || d.status === 'install_failed') && (
                <Button
                  variant="danger"
                  size="sm"
                  icon="delete"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(r.id)}
                >
                  {d.status === 'install_failed' ? 'Forget it' : 'Remove'}
                </Button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
