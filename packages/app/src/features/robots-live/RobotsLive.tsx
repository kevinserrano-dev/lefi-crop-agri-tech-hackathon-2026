import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  robotics,
  roboticsKeys,
  roboticsQueries,
  type SimMission,
  type SimRobot,
  type SimRobotCommand,
  type SimScene,
} from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { Button, EmptyState, Icon, Skeleton, useToast } from '../../shared/ui';
import { useCan } from '../session/useSession';
import { useRobotVideo } from '../live/useLiveVideo';
import { RobotPowerStatus } from './RobotDevice';
import { SceneMap } from './SceneMap';
import styles from './robotsLive.module.css';

const FEEDS: Array<[string, string]> = [
  ['overview', 'Greenhouse'],
  ['follow', 'Follow robot'],
  ['head', 'Robot head camera'],
];
const STEPS = ['QUEUED', 'DISPATCHED', 'NAVIGATING', 'INSPECTING', 'REPORTING', 'COMPLETED'];
const STEP_LABEL: Record<string, string> = {
  QUEUED: 'Queued',
  DISPATCHED: 'Sent',
  NAVIGATING: 'Driving',
  INSPECTING: 'Inspecting',
  REPORTING: 'Reporting',
  COMPLETED: 'Done',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
  TIMED_OUT: 'Timed out',
  VALIDATING: 'Checking',
  CREATED: 'Created',
};
const PHASE: Record<string, string> = {
  idle: 'Standing still',
  turning: 'Turning',
  driving: 'Driving',
  aligning: 'Facing the plant',
};
const TRAIL_MAX = 400;

/** Why the views are empty while the simulator does not answer: its power state first (ADR-104). */
function waitingText(robot: SimRobot): string {
  if (!robot.device) return 'The simulator is not answering.';
  if (robot.power === 'starting')
    return 'Starting the simulator… the views appear when it answers.';
  if (robot.power === 'off') return 'The robot is off. Turn it on above.';
  if (robot.power === 'unknown') return 'Lefi Crop Helper is not answering on the robot’s PC.';
  return 'The simulator is not answering.';
}

const newKey = () =>
  globalThis.crypto?.randomUUID?.() ?? `m-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Robot Mission Center against the real Lefi Brain (ADR-091): the MH3 in the starter's Genesis
 * simulation, with our greenhouse. Lefi Brain turns a mission into commands; this screen shows the
 * 3D views Genesis renders, the robot on a 2D map, the mission's steps and every command sent.
 * Everything is SIMULATED; cancel and the safe stop are always available.
 */
export function RobotsLive() {
  const platform = usePlatform();
  const q = useQuery(roboticsQueries.robots(platform));
  if (q.isError)
    return (
      <EmptyState mascot="sad" title="Could not load the robots">
        {describeError(q.error)}
      </EmptyState>
    );
  if (!q.data) return <Skeleton height={520} />;
  const robot = q.data[0];
  if (!robot) return <NoRobot />;
  const d = robot.device;
  if (d && d.status !== 'installed')
    return (
      <EmptyState
        mascot={d.status === 'install_failed' ? 'sad' : 'curious'}
        title={
          d.status === 'install_failed'
            ? 'The simulated robot could not be installed'
            : d.status === 'removing'
              ? 'The simulated robot is being removed'
              : 'The simulated robot is being installed'
        }
        action={
          <Link to="/devices" className={styles.link2}>
            See it in Devices &amp; Health → Robots
          </Link>
        }
      >
        {d.status === 'install_failed'
          ? (d.progress.message ?? 'See the installer log on that PC.')
          : `On ${d.node_name}: step ${d.progress.steps_done} of ${d.progress.steps_total || '…'}${
              d.progress.title ? ` · ${d.progress.title}` : ''
            }. The download happens once.`}
      </EmptyState>
    );
  return <RobotCenter robot={robot} />;
}

/** No robot yet: people add it from Devices & Health; Lefi Crop Helper installs it (ADR-090). */
function NoRobot() {
  const canManage = useCan('device.manage');
  return (
    <EmptyState
      mascot="curious"
      title="No simulated robot yet"
      action={
        canManage ? (
          <Link to="/devices" className={styles.link2}>
            Add it in Devices &amp; Health → Robots
          </Link>
        ) : undefined
      }
    >
      {canManage
        ? 'Add the simulated MH3 from Devices & Health: Lefi Crop Helper installs it on a PC without the AI node, then you send it on missions from here.'
        : 'A person who manages devices can add the simulated MH3 from Devices & Health.'}{' '}
      No physical robot is involved.
    </EmptyState>
  );
}

function RobotCenter({ robot }: { robot: SimRobot }) {
  const platform = usePlatform();
  const online = robot.connection === 'online';
  const scene = useQuery({ ...roboticsQueries.scene(platform, robot.id), enabled: online });
  const pose = robot.state?.pose ?? null;
  const trail = useTrail(pose, robot.active_mission?.id ?? null);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className={styles.page}>
      <div className={styles.banner}>
        <span className={styles.simTag}>
          <Icon name="science" size={17} /> SIMULATION
        </span>
        {robot.backend === 'lite' ? (
          <span>
            <b>2D robot simulation</b> (lite: a point on the map, no 3D and no MH3 model) in a
            simulated greenhouse. No physical robot is connected: positions are simulated.
          </span>
        ) : (
          <span>
            <b>{robot.model}</b> in Genesis, from the Humanoid Application Lab × Mirsee Robotics
            starter, in a simulated greenhouse. No physical robot is connected: positions, views and
            photos are simulated.
          </span>
        )}
      </div>

      <RobotPowerStatus robot={robot} />
      <RobotStrip robot={robot} />

      <div className={styles.grid}>
        <section className={styles.card}>
          <ViewPanel robot={robot} />
        </section>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.eyebrow}>
              <Icon name="map" size={16} /> Map · seen from above
            </span>
            {pose && (
              <span className={styles.mono}>
                x {pose.x.toFixed(2)} m · y {pose.y.toFixed(2)} m · {pose.yaw_deg.toFixed(0)}°
              </span>
            )}
          </div>
          {scene.data ? (
            <SceneMap
              scene={scene.data}
              pose={pose}
              trail={trail}
              target={robot.active_mission?.station_id ?? null}
              selected={selected}
              onPick={setSelected}
            />
          ) : (
            <div className={styles.placeholder}>
              {online ? 'Loading the scene…' : waitingText(robot)}
            </div>
          )}
          <div className={styles.legend}>
            <span>
              <i style={{ background: '#5BC0EB' }} /> Path driven
            </span>
            <span>
              <i style={{ background: '#E8C547' }} /> Going to
            </span>
            <span>
              <i style={{ background: '#1F74D8' }} /> Dock
            </span>
          </div>
        </section>
      </div>

      <div className={styles.grid}>
        <MissionPanel robot={robot} scene={scene.data} selected={selected} onSelect={setSelected} />
        <CommandLog robotId={robot.id} />
      </div>

      <MissionHistory robotId={robot.id} />
    </div>
  );
}

/** Poses seen since the current mission started, for the path drawn on the map. Updated while
 * rendering (React's "adjust state when a prop changes"), never in an effect. */
function useTrail(
  pose: { x: number; y: number } | null,
  missionId: string | null,
): Array<{ x: number; y: number }> {
  const [trail, setTrail] = useState<Array<{ x: number; y: number }>>([]);
  const [mission, setMission] = useState(missionId);
  if (missionId !== mission) {
    setMission(missionId);
    if (missionId) setTrail([]);
  }
  const last = trail[trail.length - 1];
  if (pose && (!last || Math.hypot(last.x - pose.x, last.y - pose.y) >= 0.03)) {
    setTrail([...trail, { x: pose.x, y: pose.y }].slice(-TRAIL_MAX));
  }
  return trail;
}

function RobotStrip({ robot }: { robot: SimRobot }) {
  const platform = usePlatform();
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const canSee = useCan('nav.robots');
  const stop = useMutation({
    mutationFn: () => robotics.stop(platform, robot.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roboticsKeys.all });
      toast('Safe stop sent to the simulated robot. Recorded in the audit trail.', 'ok');
    },
    onError: (e) => toast(describeError(e), 'bad'),
  });
  const s = robot.state;
  const conn =
    robot.device && robot.power === 'starting'
      ? { label: 'Starting', cls: styles.warn }
      : robot.device && robot.power === 'off'
        ? { label: 'Off', cls: styles.warn }
        : robot.connection === 'online'
          ? { label: 'Online', cls: styles.ok }
          : robot.connection === 'offline'
            ? { label: 'Not answering', cls: styles.bad }
            : { label: 'Never answered', cls: styles.bad };
  return (
    <div className={styles.strip}>
      <div className={styles.robotId}>
        <Icon name="smart_toy" size={26} />
        <div>
          <b>{robot.name}</b>
          <span className={styles.faint}>{robot.id}</span>
        </div>
        <span className={`${styles.pill} ${conn.cls}`}>{conn.label}</span>
      </div>
      <Stat label="Doing" value={s ? (PHASE[s.phase] ?? s.phase) : '—'} />
      <Stat label="Speed" value={s ? `${s.linear_mps.toFixed(2)} m/s` : '—'} />
      <Stat label="Driven" value={s ? `${s.odometry_m.toFixed(1)} m` : '—'} />
      <Stat label="Head tilt" value={s ? `${s.head_pitch.toFixed(2)} rad` : '—'} />
      <Stat
        label="Mission"
        value={robot.active_mission ? robot.active_mission.station_label : 'None'}
      />
      {robot.error && <span className={styles.err}>{robot.error}</span>}
      <Button
        variant="danger"
        icon="front_hand"
        disabled={!canSee || stop.isPending}
        onClick={() => stop.mutate()}
        className={styles.stopBtn}
      >
        Safe stop
      </Button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.faint}>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function ViewPanel({ robot }: { robot: SimRobot }) {
  const canWatch = useCan('robot.camera');
  const feeds = FEEDS.filter(([f]) => robot.feeds.includes(f));
  const [feed, setFeed] = useState(feeds[0]?.[0] ?? 'overview');
  const on = canWatch && robot.connection === 'online' && robot.feeds.includes(feed);
  const [canvas, video] = useRobotVideo(robot.id, feed, on);

  return (
    <>
      <div className={styles.cardHead}>
        <span className={styles.eyebrow}>
          <Icon name="view_in_ar" size={16} /> 3D view · Genesis
        </span>
        <div className={styles.tabs} role="tablist" aria-label="Simulated view">
          {feeds.map(([f, label]) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={feed === f}
              onClick={() => setFeed(f)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.video}>
        {on && <canvas ref={canvas} className={styles.canvas} aria-label={`Simulated ${feed}`} />}
        <span className={styles.simOverlay}>SIMULATED</span>
        {on && video.phase === 'live' && <span className={styles.fps}>{video.fps} fps</span>}
        {!on && (
          <div className={styles.videoMsg}>
            {!canWatch
              ? 'Watching the simulated views needs the robot camera permission.'
              : robot.connection !== 'online'
                ? waitingText(robot)
                : robot.feeds.length === 0
                  ? 'This simulator runs without 3D (lite backend): only the map is available.'
                  : 'Choose a view.'}
          </div>
        )}
        {on && video.phase !== 'live' && (
          <div className={styles.videoMsg}>
            {video.phase === 'error' ? describeError(video.error) : 'Connecting to the view…'}
          </div>
        )}
      </div>
    </>
  );
}

function MissionPanel({
  robot,
  scene,
  selected,
  onSelect,
}: {
  robot: SimRobot;
  scene: SimScene | undefined;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const platform = usePlatform();
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const canCommand = useCan('robot.command');
  const canSee = useCan('nav.robots');
  const m = robot.active_mission;
  const refresh = () => void qc.invalidateQueries({ queryKey: roboticsKeys.all });
  const start = useMutation({
    mutationFn: (v: { station: string; kind: 'inspect' | 'go_to' }) =>
      robotics.start(platform, {
        robot_id: robot.id,
        station_id: v.station,
        kind: v.kind,
        idempotency_key: newKey(),
      }),
    onSuccess: (mission) => {
      refresh();
      toast(`Mission to ${mission.station_label} started (simulated).`, 'ok');
    },
    onError: (e) => toast(describeError(e), 'bad'),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => robotics.cancel(platform, id),
    onSuccess: () => {
      refresh();
      toast('Mission cancelled; the robot was told to stop.', 'ok');
    },
    onError: (e) => toast(describeError(e), 'bad'),
  });
  const plants = scene?.stations.filter((s) => s.kind !== 'dock') ?? [];
  const dock = scene?.stations.find((s) => s.kind === 'dock');
  const online = robot.connection === 'online';
  const busy = !!m || start.isPending;

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.eyebrow}>
          <Icon name="flag" size={16} /> Mission
        </span>
      </div>
      {m ? (
        <ActiveMission
          mission={m}
          canCancel={canSee}
          cancelling={cancel.isPending}
          onCancel={() => cancel.mutate(m.id)}
        />
      ) : (
        <>
          <span className={styles.muted}>
            Choose a plant (here or on the map) and send the robot to inspect it: it drives there,
            looks down and takes a simulated photo with its head camera.
          </span>
          <div className={styles.stations}>
            {plants.map((s) => (
              <button
                key={s.id}
                type="button"
                className={styles.stationBtn}
                aria-pressed={selected === s.id}
                onClick={() => onSelect(s.id)}
              >
                <Icon name="potted_plant" size={18} />
                <span>{s.label}</span>
                <span className={styles.faint}>{s.kind}</span>
              </button>
            ))}
          </div>
          <div className={styles.row}>
            <Button
              icon="search"
              disabled={!canCommand || !online || busy || !selected || selected === dock?.id}
              onClick={() => selected && start.mutate({ station: selected, kind: 'inspect' })}
            >
              Inspect {plants.find((p) => p.id === selected)?.label ?? 'plant'}
            </Button>
            {dock && (
              <Button
                variant="secondary"
                icon="ev_station"
                disabled={!canCommand || !online || busy}
                onClick={() => start.mutate({ station: dock.id, kind: 'go_to' })}
              >
                Return to dock
              </Button>
            )}
          </div>
          {!canCommand && (
            <span className={styles.faint}>Your role can watch the robot but not send it.</span>
          )}
        </>
      )}
    </section>
  );
}

function ActiveMission({
  mission,
  canCancel,
  cancelling,
  onCancel,
}: {
  mission: SimMission;
  canCancel: boolean;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const steps = mission.kind === 'go_to' ? STEPS.filter((s) => s !== 'INSPECTING') : STEPS;
  const at = steps.indexOf(mission.state);
  return (
    <>
      <div className={styles.rowBetween}>
        <span>
          <b>{mission.kind === 'inspect' ? 'Inspect' : 'Go to'}</b> {mission.station_label}
        </span>
        <Button
          variant="danger"
          size="sm"
          icon="cancel"
          disabled={!canCancel || cancelling}
          onClick={onCancel}
        >
          Cancel mission
        </Button>
      </div>
      <ol className={styles.steps}>
        {steps.map((s, i) => (
          <li key={s} data-state={i < at ? 'done' : i === at ? 'now' : 'next'}>
            {STEP_LABEL[s]}
          </li>
        ))}
      </ol>
      <ul className={styles.events}>
        {[...mission.events].reverse().map((e, i) => (
          <li key={i}>
            <span className={styles.mono}>{time(e.at)}</span>
            <b>{STEP_LABEL[e.state] ?? e.state}</b>
            {e.note && <span className={styles.muted}>{e.note}</span>}
          </li>
        ))}
      </ul>
    </>
  );
}

function describeArgs(c: SimRobotCommand): string {
  const a = c.args as Record<string, unknown>;
  if (c.kind === 'go_to') return String(a.station_id ?? `${String(a.x)}, ${String(a.y)}`);
  if (c.kind === 'look') return `head ${Number(a.head_pitch).toFixed(2)} rad`;
  return '';
}

function CommandLog({ robotId }: { robotId: string }) {
  const platform = usePlatform();
  const q = useQuery(roboticsQueries.commands(platform, robotId));
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.eyebrow}>
          <Icon name="terminal" size={16} /> Commands sent by Lefi Brain
        </span>
      </div>
      {!q.data ? (
        <Skeleton height={160} />
      ) : q.data.length === 0 ? (
        <span className={styles.muted}>No command yet.</span>
      ) : (
        <ul className={styles.log}>
          {q.data.map((c) => (
            <li key={c.id}>
              <span className={styles.mono}>{time(c.sent_at)}</span>
              <b className={styles.cmdKind}>{c.kind}</b>
              <span className={styles.grow}>{describeArgs(c)}</span>
              <span className={styles.faint}>
                {c.actor === 'lefi-brain' ? 'Lefi Brain' : 'person'}
              </span>
              <span className={`${styles.pill} ${CMD_TONE[c.state] ?? ''}`} title={c.message ?? ''}>
                {c.state}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const CMD_TONE: Record<string, string> = {
  done: styles.ok ?? '',
  running: styles.info ?? '',
  accepted: styles.info ?? '',
  sent: styles.info ?? '',
  failed: styles.bad ?? '',
  rejected: styles.bad ?? '',
  unreachable: styles.bad ?? '',
  cancelled: styles.warn ?? '',
};

function MissionHistory({ robotId }: { robotId: string }) {
  const platform = usePlatform();
  const q = useQuery(roboticsQueries.missions(platform, robotId));
  const [open, setOpen] = useState<string | null>(null);
  const done = (q.data ?? []).filter((m) => !m.active);
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.eyebrow}>
          <Icon name="history" size={16} /> Missions & simulated photos
        </span>
      </div>
      {done.length === 0 ? (
        <span className={styles.muted}>No finished mission yet.</span>
      ) : (
        <div className={styles.history}>
          {done.map((m) => (
            <div key={m.id} className={styles.historyItem}>
              <div className={styles.rowBetween}>
                <b>{m.station_label}</b>
                <span
                  className={`${styles.pill} ${m.state === 'COMPLETED' ? styles.ok : styles.bad}`}
                >
                  {STEP_LABEL[m.state] ?? m.state}
                </span>
              </div>
              <span className={styles.faint}>
                {time(m.created_at)} · {m.kind === 'inspect' ? 'inspection' : 'go to'}
                {m.reason ? ` · ${m.reason}` : ''}
              </span>
              {m.has_photo &&
                (open === m.id ? (
                  <MissionPhoto missionId={m.id} />
                ) : (
                  <Button
                    variant="link"
                    size="sm"
                    icon="photo_camera"
                    onClick={() => setOpen(m.id)}
                  >
                    Show simulated photo
                  </Button>
                ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MissionPhoto({ missionId }: { missionId: string }) {
  const platform = usePlatform();
  const q = useQuery(roboticsQueries.photo(platform, missionId));
  if (q.isError) return <span className={styles.err}>{describeError(q.error)}</span>;
  if (!q.data) return <Skeleton height={120} />;
  return (
    <figure className={styles.photo}>
      <img src={`data:image/jpeg;base64,${q.data.jpeg_base64}`} alt="Simulated head-camera photo" />
      <figcaption>SIMULATED · head camera</figcaption>
    </figure>
  );
}
