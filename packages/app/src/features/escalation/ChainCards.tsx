import type { EscalationConfig } from '@lefi/api';
import { mascots } from '@lefi/ui';
import { Switch } from '../../shared/ui';
import { useEscalationActions } from './useEscalationActions';
import styles from './escalation.module.css';

/** Fixed chain: used in fixed mode and whenever Lefi AI is stopped or offline. */
export function FallbackChainCard({ c }: { c: EscalationConfig }) {
  const { update, guarded } = useEscalationActions();
  const q = c.quiet_hours;
  return (
    <section className={styles.card}>
      <div className={styles.titleBlock}>
        <span className={styles.cardTitle}>Fixed fallback chain</span>
        <span className={styles.faint}>
          Used in fixed mode, and automatically whenever Lefi AI is offline or stopped
        </span>
      </div>
      <div className={styles.list}>
        {c.chain.map((l) => (
          <div key={l.level} className={styles.step}>
            <span className={styles.level}>L{l.level}</span>
            <div className={styles.stepText}>
              <b>{l.role}</b>
              <span className={styles.faint}>{l.who}</span>
            </div>
            <span className={styles.mono}>{l.when}</span>
          </div>
        ))}
        <div className={styles.toggleRow}>
          <div className={styles.stepText}>
            <b>{q.label}</b>
            <span className={styles.faint}>{q.description}</span>
          </div>
          <Switch
            label={q.label}
            on={q.on}
            disabled={!c.can_edit.allowed}
            title={c.can_edit.reason ?? undefined}
            onChange={guarded(c.can_edit, () => update.mutate({ quiet_hours: !q.on }))}
          />
        </div>
      </div>
    </section>
  );
}

/** Escalations in progress, as the Brain reports them (timers and attempts). */
export function LiveEscalationCard({ c }: { c: EscalationConfig }) {
  return (
    <section className={styles.card}>
      <span className={styles.cardTitle}>Live escalation</span>
      {c.live.length === 0 ? (
        <div className={styles.idle}>
          <img src={mascots.calm} alt="" className={styles.idleMascot} />
          <span className={styles.text}>
            No escalation running. Acknowledgement timers and delivery attempts appear here while an
            alert escalates.
          </span>
        </div>
      ) : (
        c.live.map((l) => (
          <div key={l.incident_id} className={styles.list}>
            <div className={styles.rowBetween}>
              <b>
                {l.incident_id} · {l.title}
              </b>
              {l.next && <span className={styles.countdown}>{l.next}</span>}
            </div>
            {l.attempts.map((x) => (
              <div key={`${x.time}-${x.who}`} className={styles.toggleRow}>
                <span className={styles.mono}>{x.time}</span>
                <b className={styles.grow}>
                  {x.channel} · {x.who}
                </b>
                <span className={styles.attempt}>{x.state}</span>
              </div>
            ))}
          </div>
        ))
      )}
    </section>
  );
}
