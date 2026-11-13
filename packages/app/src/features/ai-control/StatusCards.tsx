import { useState } from 'react';
import type { AiControl, ServiceRunState } from '@lefi/api';
import { ActionButton, Icon } from '../../shared/ui';
import { HaltDialog } from '../shell/StopAi';
import { useAiControlActions } from './useAiControlActions';
import styles from './aiControl.module.css';

const SERVICE: Record<ServiceRunState, { label: string; color: string }> = {
  online: { label: 'Online', color: 'var(--lefi-ok-fg)' },
  stopped: { label: 'Stopped', color: 'var(--lefi-crit-fg)' },
  unreachable: { label: 'Unreachable', color: 'var(--lefi-warn-fg)' },
  safe_hold: { label: 'Safe-hold', color: 'var(--lefi-warn-fg)' },
  not_connected: { label: 'Not connected', color: 'var(--lefi-off-fg)' },
};

const STATUS = {
  online: { icon: 'psychiatry', bg: 'var(--lefi-ok-bg)', fg: 'var(--lefi-ok-fg)' },
  halted: { icon: 'front_hand', bg: 'var(--lefi-crit-bg)', fg: 'var(--lefi-crit-fg)' },
  unavailable: { icon: 'cloud_off', bg: 'var(--lefi-warn-bg)', fg: 'var(--lefi-warn-fg)' },
} as const;

export function AiStatusCard({ c }: { c: AiControl }) {
  const st = STATUS[c.status.state];
  return (
    <section className={styles.card}>
      <div className={styles.statusHead}>
        <span className={styles.statusIcon} style={{ background: st.bg, color: st.fg }}>
          <Icon name={st.icon} size={26} />
        </span>
        <div className={styles.statusText}>
          <span className={styles.eyebrow}>Lefi AI status</span>
          <span className={styles.statusLabel} style={{ color: st.fg }}>
            {c.status.label}
          </span>
        </div>
      </div>
      <span className={styles.muted}>{c.status.detail}</span>
      <div>
        {c.services.map((s) => (
          <div key={s.name} className={styles.service}>
            <span className={styles.grow}>{s.name}</span>
            <span className={styles.kind} data-ai={s.kind === 'ai'}>
              {s.kind === 'ai' ? 'AI' : 'Runs without AI'}
            </span>
            <span className={styles.serviceState} style={{ color: SERVICE[s.state].color }}>
              {SERVICE[s.state].label}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function EmergencyCard({ c }: { c: AiControl }) {
  const [open, setOpen] = useState(false);
  const { resume } = useAiControlActions();
  const halted = c.status.state === 'halted';
  return (
    <section className={`${styles.card} ${styles.danger}`}>
      <div className={styles.dangerHead}>
        <Icon name="emergency_home" size={28} color="var(--lefi-crit-dot)" />
        <span className={styles.cardTitle}>Emergency stop</span>
      </div>
      <span className={styles.body}>
        Stops Lefi AI immediately if it makes a mistake or starts actions that could harm the
        greenhouse. The simulated robot performs a safe stop and returns to dock. You choose whether
        rule-based automations stop too. Every stop is logged.
      </span>
      {!halted ? (
        <>
          <button
            type="button"
            className={styles.bigStop}
            disabled={!c.actions.halt.allowed}
            title={c.actions.halt.reason ?? undefined}
            onClick={() => setOpen(true)}
          >
            <Icon name="front_hand" size={24} />
            STOP AI &amp; AUTOMATED ACTIONS
          </button>
          <span className={styles.faint}>
            Available to Sys Admin, Manager, Grower, Supervisor and Maintenance — also from the red
            button in the top bar, or `lefi ai off` on the core node.
          </span>
        </>
      ) : (
        <>
          <div className={styles.haltedBox}>
            <b>{c.status.label}</b>
            <span>{c.status.detail}</span>
          </div>
          <ActionButton
            label="Resume Lefi AI"
            icon="play_circle"
            variant="solid"
            availability={c.actions.resume}
            busy={resume.isPending}
            onClick={() => resume.mutate()}
          />
          <span className={styles.faint}>
            Resume requires Manager or System Administrator. Stopped missions and automations are
            not restarted automatically.
          </span>
        </>
      )}
      <HaltDialog open={open} onClose={() => setOpen(false)} />
    </section>
  );
}

export function ManualModeCard({ c }: { c: AiControl }) {
  return (
    <section className={styles.card}>
      <div className={styles.titleBlock}>
        <span className={styles.cardTitle}>Manual mode · the platform runs without AI</span>
        <span className={styles.muted}>
          If the AI node goes down, loses connection or is stopped, LEFI CROP switches to manual
          mode automatically and keeps operating on its on-premise rules engine.
        </span>
      </div>
      <div className={styles.twoCols}>
        <div className={styles.list}>
          <span className={styles.eyebrow} style={{ color: 'var(--lefi-ok-fg)' }}>
            Keeps working
          </span>
          {c.manual_mode.keeps.map((k) => (
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
          {c.manual_mode.paused.map((k) => (
            <div key={k} className={styles.listItem}>
              <Icon name="pause_circle" size={17} color="var(--lefi-warn-dot)" />
              {k}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
