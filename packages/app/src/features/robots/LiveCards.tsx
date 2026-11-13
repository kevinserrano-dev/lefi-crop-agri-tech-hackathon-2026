import { useState } from 'react';
import type { RobotLive } from '@lefi/api';
import { mascots, toneVars } from '@lefi/ui';
import { ActionButton, Badge, Button, Icon } from '../../shared/ui';
import { elapsed, stateTone, WORKFLOW } from './presentation';
import { useRobotActions } from './useRobotCommand';
import styles from './robots.module.css';

export function WorkflowCard({ step, skipped }: { step: number; skipped: number[] }) {
  return (
    <section className={styles.card}>
      <div className={styles.rowBetween}>
        <span className={styles.cardTitle}>Autonomous inspection workflow</span>
        <span className={styles.faint}>
          AI alert → policy → dispatch → inspect → supervisor → next action
        </span>
      </div>
      <ol className={styles.workflow}>
        {WORKFLOW.map((label, i) => (
          <li
            key={label}
            data-done={step > 0 && i + 1 < step && !skipped.includes(i + 1)}
            data-skipped={skipped.includes(i + 1)}
            data-current={i + 1 === step}
            title={skipped.includes(i + 1) ? 'Not applicable: manual dispatch' : undefined}
          >
            <span>{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function RobotCard({ live }: { live: RobotLive }) {
  const r = live.robot;
  const t = toneVars(stateTone(r.mode === 'Docked · charging' ? 'Completed' : r.mode));
  return (
    <section className={styles.card}>
      <div className={styles.robotHead}>
        <img src={mascots.working} alt="" />
        <div className={styles.grow}>
          <span className={styles.cardTitle}>{r.id}</span>
          <span className={styles.faint}>{r.model}</span>
        </div>
        <span className={styles.pill} style={{ background: t.bg, color: t.fg }}>
          {r.mode}
        </span>
      </div>
      <div className={styles.twoCol}>
        <div className={styles.stack}>
          <span className={styles.faint}>Battery</span>
          <div className={styles.battery}>
            <div className={styles.track}>
              <div
                style={{
                  width: `${r.battery_pct}%`,
                  background: r.battery_pct < 25 ? 'var(--lefi-crit-dot)' : 'var(--lefi-green-400)',
                }}
              />
            </div>
            <b>{r.battery_pct} %</b>
          </div>
        </div>
        <div className={styles.stack}>
          <span className={styles.faint}>Connectivity</span>
          <span className={styles.link}>
            <Icon name="wifi" size={16} />
            {r.link}
          </span>
        </div>
      </div>
    </section>
  );
}

/** Active mission + supervisor controls. Cancel (safe stop) is visible whenever a mission runs. */
export function MissionCard({ live }: { live: RobotLive }) {
  const { command } = useRobotActions();
  const [target, setTarget] = useState(live.map.targets[0]?.id ?? '');
  const m = live.mission;
  const c = live.controls;
  const busy = command.isPending;
  const send = (intent: Parameters<typeof command.mutate>[0]['intent'], arg?: string) =>
    command.mutate({ intent, ...(arg ? { arg } : {}) });
  const tt = m ? toneVars(stateTone(m.state)) : null;

  return (
    <section className={styles.card}>
      <div className={styles.rowBetween}>
        <span className={styles.cardTitle}>Active mission</span>
        {m && (
          <span className={styles.mono}>
            {m.id} · {elapsed(m.elapsed_s)}
          </span>
        )}
      </div>
      {!m ? (
        <div className={styles.idle}>
          <img src={mascots.sleeping} alt="" />
          <span className={styles.muted}>
            No active mission. The robot is docked. Choose a target below to dispatch an inspection.
          </span>
        </div>
      ) : (
        <div className={styles.mission}>
          <div className={styles.rowBetween}>
            <b>{m.title}</b>
            <span className={styles.pill} style={{ background: tt!.bg, color: tt!.fg }}>
              {m.state}
            </span>
          </div>
          <span className={styles.faint}>
            {m.origin} · target {m.target} · {m.photos} photo(s)
          </span>
          <button
            type="button"
            className={styles.cancel}
            disabled={busy}
            data-locked={!c.cancel.allowed}
            title={c.cancel.reason ?? 'Safe stop, then return to dock'}
            onClick={() => send('mission.cancel')}
          >
            <Icon name={c.cancel.allowed ? 'cancel' : 'lock'} size={18} />
            Cancel mission · safe stop
          </button>
        </div>
      )}

      <div className={styles.controlsHead}>
        <span className={styles.eyebrow}>Supervisor controls</span>
        <span className={styles.authNote} data-ok={c.goto.allowed}>
          {live.auth_note}
        </span>
      </div>
      <div className={styles.controls}>
        {live.mission && live.mission.state === 'Paused' ? (
          <ActionButton
            label="Resume navigation"
            icon="play_arrow"
            availability={c.resume}
            busy={busy}
            onClick={() => send('nav.resume')}
          />
        ) : (
          <ActionButton
            label="Pause navigation"
            icon="pause"
            availability={c.pause}
            busy={busy}
            onClick={() => send('nav.pause')}
          />
        )}
        <ActionButton
          label="Stop safely & cancel"
          icon="front_hand"
          availability={c.cancel}
          busy={busy}
          onClick={() => send('mission.cancel')}
        />
        <ActionButton
          label="Return to base"
          icon="home"
          availability={c.return}
          busy={busy}
          onClick={() => send('nav.return')}
        />
        <ActionButton
          label="Request photo"
          icon="photo_camera"
          availability={c.photo}
          busy={busy}
          onClick={() => send('camera.photo')}
        />
        <ActionButton
          label={live.camera.live ? 'Stop live video' : 'Start live video'}
          icon={live.camera.live ? 'videocam_off' : 'videocam'}
          availability={c.video}
          busy={busy}
          onClick={() => send(live.camera.live ? 'camera.video.stop' : 'camera.video.start')}
        />
        <ActionButton
          label="Request status"
          icon="info"
          availability={c.status}
          busy={busy}
          onClick={() => send('query.status')}
        />
      </div>
      <div className={styles.redirect}>
        <select aria-label="Target" value={target} onChange={(e) => setTarget(e.target.value)}>
          {live.map.targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.id}
              {t.allowed ? '' : ' · restricted (REI)'}
            </option>
          ))}
        </select>
        <ActionButton
          label={m ? 'Redirect' : 'Dispatch inspection'}
          icon="alt_route"
          variant="solid"
          availability={c.goto}
          busy={busy}
          onClick={() => send('nav.goto', target)}
        />
      </div>
    </section>
  );
}

export function CameraCard({ live, large }: { live: RobotLive; large?: boolean }) {
  return (
    <section className={large ? styles.cameraLarge : styles.camera}>
      <div
        className={styles.feed}
        aria-label={live.camera.live ? 'Simulated live feed' : 'Live video off'}
      >
        {live.camera.live ? (
          <span className={styles.liveTag}>
            <i /> LIVE · SIMULATED FEED
          </span>
        ) : (
          <div className={styles.feedOff}>
            <Icon name="videocam_off" size={34} />
            Live video off
          </div>
        )}
        <span className={styles.timecode}>{live.camera.time}</span>
        <span className={styles.feedLabel}>{live.camera.label}</span>
      </div>
      <div className={styles.photos}>
        <div className={styles.rowBetween}>
          <b>Inspection photos</b>
          <span>delivered to supervisor</span>
        </div>
        {live.photos.length === 0 ? (
          <span>No photos captured yet.</span>
        ) : (
          <div className={styles.photoGrid}>
            {live.photos.slice(0, large ? 12 : 4).map((p) => (
              <div key={p.id} className={styles.photo} title={`${p.label} · ${p.time} · ${p.by}`}>
                <span>{p.id} · SIM</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

const EXAMPLES = [
  'Go inspect plant A-03',
  'Send me a picture of Zone B',
  'Start live video',
  'Pause the inspection',
  'Return to base',
  'What did you find?',
  'Cancel your current mission',
];

/** Free-text commands. The Brain interprets and validates them; the parser used is shown in the log. */
export function TalkCard({ live }: { live: RobotLive }) {
  const { command } = useRobotActions();
  const [text, setText] = useState('');
  const send = (t: string) =>
    t.trim() && command.mutate({ text: t.trim() }, { onSuccess: () => setText('') });
  const recent = live.commands.slice(0, 3);
  return (
    <section className={styles.card}>
      <div className={styles.talkHead}>
        <img src={mascots.curious} alt="" />
        <div>
          <span className={styles.cardTitle}>Talk to LEFI-R1</span>
          <span className={styles.faint}>
            Natural-language commands · interpreted by Lefi Brain · authorisation &amp; safety
            checked
          </span>
        </div>
      </div>
      <form
        className={styles.talkForm}
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Go inspect Plant B-07"
          aria-label="Command for LEFI-R1"
        />
        <Button type="submit" icon="send" disabled={command.isPending}>
          Send
        </Button>
      </form>
      <div className={styles.examples}>
        {EXAMPLES.map((e) => (
          <button key={e} type="button" onClick={() => send(e)}>
            {e}
          </button>
        ))}
      </div>
      {recent.length === 0 ? (
        <span className={styles.faint}>
          Your commands and the robot’s acknowledgements appear here.
        </span>
      ) : (
        recent.map((c) => (
          <div key={c.id} className={styles.chat}>
            <span className={styles.mono}>{c.time}</span>
            <div>
              <b>“{c.text}”</b>
              <span data-exec={c.exec}>{c.result}</span>
              <em>{c.parser}</em>
            </div>
          </div>
        ))
      )}
    </section>
  );
}

export function SummaryCard({ live }: { live: RobotLive }) {
  const s = live.summary;
  return (
    <section className={`${styles.card} ${styles.summary}`}>
      <img src={s.state === 'available' ? mascots.happy : mascots.sleeping} alt="" />
      <div>
        <span className={styles.eyebrow} style={{ color: 'var(--lefi-forest-600)' }}>
          AI mission summary{' '}
          {s.simulated && (
            <Badge tone="sim" variant="tag">
              Simulated
            </Badge>
          )}
        </span>
        <span className={styles.body}>
          {s.state === 'available' && s.text
            ? s.text
            : 'AI reasoning unavailable — Lefi AI is stopped. Manual robot controls keep working.'}
        </span>
      </div>
    </section>
  );
}

export function QueueCard({ live }: { live: RobotLive }) {
  const { queue } = useRobotActions();
  const av = live.queue_actions;
  const op = (id: string, o: 'up' | 'down' | 'cancel') => queue.mutate({ id, op: o });
  return (
    <section className={styles.card}>
      <div className={styles.rowBetween}>
        <span className={styles.cardTitle}>Mission queue</span>
        <span className={styles.faint}>
          {av.allowed ? 'Reprioritise or cancel queued missions' : av.reason}
        </span>
      </div>
      {live.queue.length === 0 && <span className={styles.faint}>Queue is empty.</span>}
      {live.queue.map((q, i) => (
        <div key={q.id} className={styles.queueRow}>
          <span className={styles.mono}>#{i + 1}</span>
          <div className={styles.grow}>
            <b>{q.title}</b>
            <span className={styles.faint}>
              {q.id} · {q.origin} · {q.priority}
            </span>
          </div>
          <button
            type="button"
            aria-label={`Move ${q.id} up`}
            disabled={i === 0}
            data-locked={!av.allowed}
            title={av.reason ?? undefined}
            onClick={() => op(q.id, 'up')}
          >
            <Icon name="arrow_upward" size={16} />
          </button>
          <button
            type="button"
            aria-label={`Move ${q.id} down`}
            disabled={i === live.queue.length - 1}
            data-locked={!av.allowed}
            title={av.reason ?? undefined}
            onClick={() => op(q.id, 'down')}
          >
            <Icon name="arrow_downward" size={16} />
          </button>
          <button
            type="button"
            aria-label={`Cancel ${q.id}`}
            className={styles.qCancel}
            data-locked={!av.allowed}
            title={av.reason ?? undefined}
            onClick={() => op(q.id, 'cancel')}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
      <span className={styles.faint}>
        Queued missions start only after the active mission completes and policy checks pass.
      </span>
    </section>
  );
}
