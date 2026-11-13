import type { AiControl } from '@lefi/api';
import { ActionButton, Icon, ProvenanceBadge } from '../../shared/ui';
import { useAiControlActions } from './useAiControlActions';
import styles from './aiControl.module.css';

export function AutomationsCard({ c }: { c: AiControl }) {
  const { automation } = useAiControlActions();
  const running = c.automations.filter((a) => a.running).length;
  return (
    <section className={styles.card}>
      <div className={styles.rowBetween}>
        <span className={styles.cardTitle}>Running automated actions</span>
        <span className={styles.muted}>
          {running} running · {c.automations.length - running} stopped
        </span>
      </div>
      {c.automations.map((a) => (
        <div key={a.id} className={styles.auto}>
          <span className={styles.autoIcon}>
            <Icon name={a.icon} size={19} />
          </span>
          <div className={styles.autoText}>
            <b>{a.title}</b>
            <span className={styles.faint}>
              {a.target} · {a.by} · since {a.since}
            </span>
          </div>
          {a.origin === 'SIMULATED' && <ProvenanceBadge origin={a.origin} />}
          <span className={styles.kind} data-ai={a.source === 'ai'}>
            {a.source === 'ai' ? 'AI' : 'Rules'}
          </span>
          <span
            className={styles.autoState}
            style={{ color: a.running ? 'var(--lefi-ok-fg)' : 'var(--lefi-crit-fg)' }}
          >
            {a.running ? 'Running' : 'Stopped'}
          </span>
          {a.running ? (
            <ActionButton
              label="Stop"
              icon="stop_circle"
              availability={a.actions.stop}
              busy={automation.isPending}
              onClick={() => automation.mutate({ id: a.id, op: 'stop' })}
            />
          ) : (
            <ActionButton
              label="Restart"
              icon="replay"
              availability={a.actions.restart}
              busy={automation.isPending}
              onClick={() => automation.mutate({ id: a.id, op: 'restart' })}
            />
          )}
        </div>
      ))}
      {c.automations_note && (
        <span className={styles.note}>
          <Icon name="lock" size={15} /> {c.automations_note}
        </span>
      )}
    </section>
  );
}
