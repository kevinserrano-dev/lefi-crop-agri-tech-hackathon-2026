import { Link } from '@tanstack/react-router';
import type { ActivityItem, Robot, ShiftNow, Task } from '@lefi/api';
import { mascots, toneVars, type Tone } from '@lefi/ui';
import { roleColor } from '../../shared/lib/roles';
import { Avatar, Card, ProvenanceBadge } from '../../shared/ui';
import styles from './dashboard.module.css';

const PRIORITY: Record<Task['priority'], { tone: Tone; label: string }> = {
  critical: { tone: 'crit', label: 'Critical' },
  high: { tone: 'warn', label: 'High' },
  normal: { tone: 'info', label: 'Normal' },
};

export function PendingTasksCard({
  tasks,
  allowed,
}: {
  tasks: Task[] | undefined;
  allowed: boolean;
}) {
  return (
    <Card
      title="Pending tasks & incidents"
      actions={
        allowed && (
          <Link to="/tasks" className={styles.cardLink}>
            View all
          </Link>
        )
      }
    >
      {!allowed && <span className={styles.muted}>Your role cannot view tasks.</span>}
      {tasks?.length === 0 && <span className={styles.muted}>No pending tasks.</span>}
      {tasks?.slice(0, 5).map((t) => {
        const p = toneVars(PRIORITY[t.priority].tone);
        return (
          <div key={t.id} className={styles.taskRow}>
            <span className={styles.taskDot} style={{ background: p.dot }} />
            <div className={styles.taskText}>
              <span className={styles.taskTitle}>{t.title}</span>
              <span className={styles.taskMeta}>
                {[t.zone_id, t.assignee, t.due_label].filter(Boolean).join(' · ')}
              </span>
            </div>
            <span className={styles.taskPriority} style={{ background: p.bg, color: p.fg }}>
              {PRIORITY[t.priority].label}
            </span>
          </div>
        );
      })}
    </Card>
  );
}

export function RobotCard({ robots, allowed }: { robots: Robot[] | undefined; allowed: boolean }) {
  const r = robots?.[0];
  const docked = r?.state === 'docked';
  const color = docked
    ? 'var(--lefi-ok-fg)'
    : r?.state === 'safe_stop'
      ? 'var(--lefi-crit-fg)'
      : 'var(--lefi-sim-fg)';
  return (
    <Card
      title="Robot availability"
      actions={
        allowed && (
          <Link to="/robots" className={styles.cardLink}>
            Mission Center
          </Link>
        )
      }
    >
      {!allowed && <span className={styles.muted}>Your role cannot view robots.</span>}
      {allowed && robots?.length === 0 && (
        <span className={styles.muted}>No robot registered.</span>
      )}
      {r && (
        <>
          <div className={styles.robot}>
            <img src={mascots.working} alt="" className={styles.robotMascot} />
            <div className={styles.robotText}>
              <span className={styles.robotName}>{r.name}</span>
              <span className={styles.robotMode} style={{ color }}>
                <span className={styles.robotDot} style={{ background: color }} />
                {r.mode} {r.origin === 'SIMULATED' && <ProvenanceBadge origin={r.origin} />}
              </span>
              <div className={styles.battery}>
                <div className={styles.batteryTrack}>
                  <div style={{ width: `${r.battery_pct ?? 0}%` }} />
                </div>
                {r.battery_pct === null ? 'Battery not reported' : `${r.battery_pct} % battery`}
              </div>
            </div>
          </div>
          <div className={styles.facts}>
            <div>
              <span>Last mission</span>
              <b>{r.last_mission?.title ?? 'None yet'}</b>
            </div>
            <div>
              <span>State</span>
              <b>{r.last_mission?.state ?? '—'}</b>
            </div>
            <div>
              <span>Images captured</span>
              <b>{r.last_mission ? r.last_mission.images.toLocaleString('en-CA') : '—'}</b>
            </div>
            <div>
              <span>AI flags raised</span>
              <b style={{ color: 'var(--lefi-warn-fg)' }}>{r.last_mission?.ai_flags ?? '—'}</b>
            </div>
          </div>
          {r.note && <span className={styles.muted}>{r.note}</span>}
        </>
      )}
    </Card>
  );
}

export function ShiftActivityCard({
  shift,
  activity,
}: {
  shift: ShiftNow | undefined;
  activity: ActivityItem[] | undefined;
}) {
  return (
    <Card
      title="Shift activity"
      actions={
        shift && (
          <span className={styles.muted}>{`${shift.name} · ${shift.start}–${shift.end}`}</span>
        )
      }
    >
      {shift && (
        <div className={styles.crew}>
          <div className={styles.avatars}>
            {shift.on_site.slice(0, 7).map((p) => (
              <span key={p.name} className={styles.avatarRing}>
                <Avatar name={p.name} size={30} color={roleColor(p.role_id)} />
              </span>
            ))}
          </div>
          <span className={styles.crewCount}>
            {shift.on_site.length} on site · {shift.on_break} on break
          </span>
        </div>
      )}
      {activity?.map((a) => (
        <div key={`${a.time}-${a.who}`} className={styles.activityRow}>
          <span className={styles.activityTime}>{a.time}</span>
          <span>
            <b>{a.who}</b> {a.what}
          </span>
        </div>
      ))}
    </Card>
  );
}
