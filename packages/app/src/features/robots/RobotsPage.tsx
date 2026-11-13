import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { queries } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { Icon, Skeleton } from '../../shared/ui';
import { FloorMap } from './FloorMap';
import {
  CameraCard,
  MissionCard,
  QueueCard,
  RobotCard,
  SummaryCard,
  TalkCard,
  WorkflowCard,
} from './LiveCards';
import { HistoryTab, LogTab, ViewerTab } from './Tabs';
import { useRobotActions } from './useRobotCommand';
import styles from './robots.module.css';

type Tab = 'live' | 'history' | 'viewer' | 'log';
const TABS: Array<[Tab, string]> = [
  ['live', 'Live operations'],
  ['history', 'Missions & history'],
  ['viewer', 'Inspection viewer'],
  ['log', 'Command log'],
];

/** Autonomous Robot Mission Center (design). The robot is simulated; cancel is always available. */
export function RobotsPage() {
  const platform = usePlatform();
  const live = useQuery(queries.robotLive(platform));
  const { speed } = useRobotActions();
  // Deep links: ?robot=<id>, ?tab=history&mission=<id> (incidents, zones, devices).
  const search = useSearch({ strict: false }) as { robot?: string; tab?: Tab; mission?: string };
  const [tab, setTab] = useState<Tab>(search.tab ?? (search.mission ? 'history' : 'live'));
  const [robot, setRobot] = useState(search.robot ?? 'LEFI-R1');
  const key = JSON.stringify(search);
  const [seen, setSeen] = useState(key);
  if (key !== seen) {
    setSeen(key);
    if (search.robot) setRobot(search.robot);
    if (search.tab || search.mission) setTab(search.tab ?? 'history');
  }

  if (live.isPending) return <Skeleton height={500} />;
  if (live.isError) return <span className={styles.muted}>{describeError(live.error)}</span>;
  const l = live.data;
  const sel = l.fleet.find((r) => r.id === robot) ?? l.fleet[0]!;

  return (
    <>
      <div className={styles.rowBetween}>
        <span className={styles.eyebrow}>Fleet · select a robot</span>
        <Link to="/devices" className={styles.link2}>
          Fleet health in Devices &amp; Health →
        </Link>
      </div>
      <div className={styles.fleet}>
        {l.fleet.map((r) => (
          <button
            key={r.id}
            type="button"
            className={styles.fleetItem}
            aria-pressed={r.id === robot}
            onClick={() => setRobot(r.id)}
          >
            <Icon name={r.kind === 'drone' ? 'flight' : 'smart_toy'} size={22} />
            <div className={styles.stack}>
              <span>
                <b className={styles.mono}>{r.id}</b> <span className={styles.faint}>{r.home}</span>
              </span>
              <span className={styles.faint}>{r.state}</span>
            </div>
            <div className={styles.fleetRight}>
              <span className={styles.mono}>
                {r.battery_pct === null ? '—' : `${r.battery_pct} %`}
              </span>
              <span className={styles.faint}>{r.link}</span>
            </div>
          </button>
        ))}
      </div>

      <div className={styles.simBanner}>
        <span className={styles.simTag}>
          <Icon name="science" size={17} /> SIMULATION MODE
        </span>
        <span className={styles.simText}>
          LEFI-R1 is a simulated MH3-compatible robot. Movement, camera feed, photos and device
          acknowledgements come from the simulator driver <b>{l.sim.driver}</b> — no physical robot
          is connected. A hardware adapter can replace the driver without changing this screen.
        </span>
        <div className={styles.speed} role="group" aria-label="Simulation speed">
          {([1, 2, 4] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={l.sim.speed === s}
              onClick={() => speed.mutate(s)}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Mission center">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {sel.id !== 'LEFI-R1' && (
        <div className={styles.otherRobot}>
          <Icon name="info" size={18} />
          {sel.id} is registered, but no adapter is connected: only LEFI-R1 is simulated. Once its
          hardware adapter exists it gets the same live map, camera, commands and history.
          <Link to="/devices" search={{ device: sel.id }} className={styles.link2}>
            Open {sel.id} in Devices &amp; Health →
          </Link>
        </div>
      )}

      {tab === 'live' && (
        <>
          <WorkflowCard step={l.workflow_step} skipped={l.workflow_skipped} />
          <div className={styles.liveGrid}>
            <FloorMap live={l} />
            <div className={styles.stack16}>
              <RobotCard live={l} />
              <MissionCard live={l} />
            </div>
          </div>
          <div className={styles.bottomGrid}>
            <CameraCard live={l} />
            <TalkCard live={l} />
            <div className={styles.stack16}>
              <SummaryCard live={l} />
              <QueueCard live={l} />
            </div>
          </div>
        </>
      )}
      {tab === 'history' && <HistoryTab key={search.mission} initial={search.mission} />}
      {tab === 'viewer' && <ViewerTab live={l} />}
      {tab === 'log' && <LogTab live={l} />}
    </>
  );
}
