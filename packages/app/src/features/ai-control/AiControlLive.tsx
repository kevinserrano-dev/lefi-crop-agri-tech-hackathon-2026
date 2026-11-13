import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { operations, operationsQueries, type AiControlView } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { Button, EmptyState, Icon, Skeleton, useToast } from '../../shared/ui';
import styles from './aiControl.module.css';

type Part = AiControlView['parts'][number];

const PART_STATE: Record<Part['state'], { label: string; color: string }> = {
  online: { label: 'Online', color: 'var(--lefi-ok-fg)' },
  stopped: { label: 'Stopped', color: 'var(--lefi-crit-fg)' },
  unavailable: { label: 'Unavailable', color: 'var(--lefi-warn-fg)' },
  not_built: { label: 'Not built yet', color: 'var(--lefi-off-fg)' },
  off: { label: 'Off', color: 'var(--lefi-off-fg)' },
};

const LABEL: Record<string, string> = {
  available: 'Online',
  disabled: 'Stopped',
  unreachable: 'Unreachable',
  model_missing: 'Model missing',
  unconfigured: 'Not configured',
};

/**
 * AI Control & Safety against the real Lefi Brain (ADR-085), in the design's layout. Only what
 * exists: Lefi AI's state, the kill switch (`lefi ai off`), which parts need AI, the one action
 * Lefi AI may take (cameras a person allowed) and its settings. Everything else in the design is
 * shown as not available, with the reason; nothing here drives an actuator (ADR-004).
 */
export function AiControlLive() {
  const platform = usePlatform();
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const q = useQuery(operationsQueries.aiControl(platform));
  const [reason, setReason] = useState('');
  const after = (v: AiControlView, msg: string) => {
    qc.setQueryData(operationsQueries.aiControl(platform).queryKey, v);
    void qc.invalidateQueries();
    toast(msg, v.kill_switch ? 'bad' : 'ok');
  };
  const stop = useMutation({
    mutationFn: () => operations.stopAi(platform, reason.trim()),
    onSuccess: (v) => {
      setReason('');
      after(v, 'Lefi AI stopped. Recorded in the audit trail.');
    },
    onError: (e) => toast(describeError(e), 'bad'),
  });
  const resume = useMutation({
    mutationFn: () => operations.resumeAi(platform),
    onSuccess: (v) => after(v, 'Lefi AI resumed. Recorded in the audit trail.'),
    onError: (e) => toast(describeError(e), 'bad'),
  });

  if (q.isError)
    return (
      <EmptyState mascot="sad" title="Could not load AI Control & Safety">
        {describeError(q.error)}
      </EmptyState>
    );
  if (!q.data) return <Skeleton height={500} />;
  const c = q.data;
  const online = c.state === 'available';
  const st = c.kill_switch
    ? { icon: 'front_hand', bg: 'var(--lefi-crit-bg)', fg: 'var(--lefi-crit-fg)' }
    : online
      ? { icon: 'psychiatry', bg: 'var(--lefi-ok-bg)', fg: 'var(--lefi-ok-fg)' }
      : { icon: 'cloud_off', bg: 'var(--lefi-warn-bg)', fg: 'var(--lefi-warn-fg)' };
  const keeps = c.parts.filter((p) => p.kind === 'no_ai');
  const paused = c.parts.filter((p) => p.kind === 'ai' && p.state !== 'not_built');
  const allowedCams = c.actions.find((a) => a.mode === 'allowed_per_camera')?.cameras ?? [];

  return (
    <>
      <div className={styles.top}>
        <section className={styles.card}>
          <div className={styles.statusHead}>
            <span className={styles.statusIcon} style={{ background: st.bg, color: st.fg }}>
              <Icon name={st.icon} size={26} />
            </span>
            <div className={styles.statusText}>
              <span className={styles.eyebrow}>Lefi AI status</span>
              <span className={styles.statusLabel} style={{ color: st.fg }}>
                {LABEL[c.state] ?? c.state}
              </span>
            </div>
          </div>
          <span className={styles.muted}>
            {c.model ? `Model ${c.model} · ` : ''}
            {c.reason}
            {c.busy ? ` · ${c.busy} answer(s) in progress` : ''}
          </span>
          <div>
            {c.parts.map((p) => (
              <div key={p.name} className={styles.service}>
                <span className={styles.grow} title={p.detail}>
                  {p.name}
                </span>
                <span className={styles.kind} data-ai={p.kind === 'ai'}>
                  {p.kind === 'ai' ? 'AI' : 'Runs without AI'}
                </span>
                <span className={styles.serviceState} style={{ color: PART_STATE[p.state].color }}>
                  {PART_STATE[p.state].label}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className={`${styles.card} ${styles.danger}`}>
          <div className={styles.dangerHead}>
            <Icon name="emergency_home" size={28} color="var(--lefi-crit-dot)" />
            <span className={styles.cardTitle}>Emergency stop</span>
          </div>
          <span className={styles.body}>
            Stops Lefi AI immediately: it answers nothing and moves no camera until a person resumes
            it. Rules, sensors, alerts and notifications keep running. Lefi Brain has no pump, valve
            or other automation to stop. Every stop is recorded in the audit trail.
          </span>
          {!c.kill_switch ? (
            <>
              {c.can_stop && (
                <label className={styles.field}>
                  Reason
                  <input
                    value={reason}
                    maxLength={200}
                    placeholder="e.g. Lefi AI aimed a camera at the wrong bench"
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              )}
              <button
                type="button"
                className={styles.bigStop}
                disabled={!c.can_stop || reason.trim().length < 3 || stop.isPending}
                title={
                  !c.can_stop
                    ? 'Your role cannot stop Lefi AI'
                    : reason.trim().length < 3
                      ? 'Write the reason first'
                      : undefined
                }
                onClick={() => stop.mutate()}
              >
                <Icon name="front_hand" size={24} />
                STOP LEFI AI
              </button>
              <span className={styles.faint}>
                Also from the red button in the top bar, or `lefi ai off` on the main PC.
              </span>
            </>
          ) : (
            <>
              <div className={styles.haltedBox}>
                <b>Lefi AI is stopped</b>
                <span>{c.stopped_note ?? 'Kill switch on.'}</span>
              </div>
              <Button
                icon="play_circle"
                disabled={!c.can_resume || resume.isPending}
                title={
                  c.can_resume ? undefined : 'Resuming needs a Manager or System Administrator'
                }
                onClick={() => resume.mutate()}
              >
                Resume Lefi AI
              </Button>
              <span className={styles.faint}>
                Resume needs a Manager or System Administrator (or `lefi ai on`).
              </span>
            </>
          )}
        </section>
      </div>

      <section className={styles.card}>
        <div className={styles.titleBlock}>
          <span className={styles.cardTitle}>Manual mode · the platform runs without AI</span>
          <span className={styles.muted}>
            When Lefi AI is stopped or its node is unreachable, Lefi Brain keeps operating without
            it.
          </span>
        </div>
        <div className={styles.twoCols}>
          <div className={styles.list}>
            <span className={styles.eyebrow} style={{ color: 'var(--lefi-ok-fg)' }}>
              Keeps working
            </span>
            {[
              'Live sensor readings, charts and dashboards',
              'Alerts from the ranges people set',
              ...keeps.map((p) => p.name),
              'Cameras moved by people',
            ].map((k) => (
              <div key={k} className={styles.listItem}>
                <Icon name="check_circle" size={17} color="var(--lefi-green-500)" />
                {k}
              </div>
            ))}
          </div>
          <div className={styles.list}>
            <span className={styles.eyebrow} style={{ color: 'var(--lefi-warn-fg)' }}>
              Paused until AI is back
            </span>
            {paused.map((p) => (
              <div key={p.name} className={styles.listItem}>
                <Icon name="pause_circle" size={17} color="var(--lefi-warn-dot)" />
                {p.name}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.rowBetween}>
          <span className={styles.cardTitle}>Running automated actions</span>
          <span className={styles.muted}>0 running</span>
        </div>
        <div className={styles.auto}>
          <span className={styles.autoIcon}>
            <Icon name="block" size={19} />
          </span>
          <div className={styles.autoText}>
            <b>Nothing runs automatically</b>
            <span className={styles.faint}>
              Lefi Brain has no actuator permission: no irrigation, dosing, fans, vents or heating
              is driven by it (ADR-004). Lefi AI acts only on cameras a person allowed, when asked.
            </span>
          </div>
        </div>
        {allowedCams.length > 0 && (
          <div className={styles.auto}>
            <span className={styles.autoIcon}>
              <Icon name="photo_camera" size={19} />
            </span>
            <div className={styles.autoText}>
              <b>Cameras Lefi AI may use</b>
              <span className={styles.faint}>
                {allowedCams.join(', ')} · change it in Devices &amp; Health → Cameras
              </span>
            </div>
            <span className={styles.kind} data-ai>
              AI
            </span>
          </div>
        )}
      </section>

      <section className={styles.card}>
        <div className={styles.titleBlock}>
          <span className={styles.cardTitle}>AI autonomy policy</span>
          <span className={styles.muted}>
            What Lefi AI may do. Lefi AI never acts on its own: only when a person asks, through the
            validator, and every command is audited. Anything not listed as allowed does not exist
            in Lefi Brain.
          </span>
        </div>
        <div className={styles.tableWrap}>
          <div className={styles.table} role="table" aria-label="AI autonomy policy">
            <div role="row" className={styles.tHead}>
              <span>Decision / action</span>
              <span>Area</span>
              <span />
              <span>Mode</span>
              <span />
            </div>
            {c.actions.map((a) => (
              <div role="row" key={a.name} className={styles.tRow}>
                <div className={styles.titleBlock}>
                  <b>{a.name}</b>
                  <span className={styles.faint}>{a.detail}</span>
                </div>
                <span>{a.area}</span>
                <span />
                <span
                  className={styles.risk}
                  style={
                    a.mode === 'allowed_per_camera'
                      ? { background: 'var(--lefi-ok-bg)', color: 'var(--lefi-ok-fg)' }
                      : { background: 'var(--lefi-off-bg)', color: 'var(--lefi-off-fg)' }
                  }
                >
                  {a.mode === 'allowed_per_camera' ? 'Allowed per camera' : 'Not available'}
                </span>
                <span />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.titleBlock}>
          <span className={styles.cardTitle}>AI settings</span>
          <span className={styles.muted}>
            As configured on Lefi Brain (`lefi ai`); read-only here.
          </span>
        </div>
        <div className={styles.twoCols}>
          <div className={styles.list}>
            {c.settings.map((s) => (
              <div key={s.name} className={styles.service}>
                <span className={styles.grow}>{s.name}</span>
                <span className={styles.serviceState}>{s.value}</span>
              </div>
            ))}
          </div>
          <div className={styles.list}>
            <span className={styles.eyebrow}>What Lefi AI may read for you</span>
            <span className={styles.faint}>
              {c.tools.length ? c.tools.join(' · ') : 'Nothing: your role is offered no tool.'}
            </span>
          </div>
        </div>
      </section>
    </>
  );
}
