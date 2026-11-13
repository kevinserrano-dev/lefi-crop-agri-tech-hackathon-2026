import type { EscalationConfig, NotifyChannel } from '@lefi/api';
import { toneVars } from '@lefi/ui';
import { SEVERITY } from '../incidents/tones';
import { CommitNumber, Icon } from '../../shared/ui';
import { useEscalationActions } from './useEscalationActions';
import styles from './escalation.module.css';

const LEVEL_LABEL = { info: 'Informational', warn: 'Warning', crit: 'Critical' } as const;

/**
 * One card per severity: channels and acknowledgement window. Channel availability comes
 * from the Brain (SMS / voice need a gateway that is not configured), so those stay locked.
 */
export function LevelCards({ c }: { c: EscalationConfig }) {
  const { update, guarded } = useEscalationActions();
  return (
    <div className={styles.levels}>
      {c.levels.map((l) => {
        const t = toneVars(SEVERITY[l.severity].tone);
        return (
          <section
            key={l.key}
            className={styles.card}
            style={{ borderTop: `4px solid ${t.dot}` }}
            aria-label={`${LEVEL_LABEL[l.key]} rule`}
          >
            <div className={styles.rowBetween}>
              <span className={styles.levelTitle} style={{ color: t.fg }}>
                {LEVEL_LABEL[l.key]}
              </span>
              <span className={styles.mono}>rule · {l.key}</span>
            </div>
            <span className={styles.text}>{l.description}</span>
            <span className={styles.eyebrow}>Channels</span>
            <div
              className={styles.chans}
              role="group"
              aria-label={`${LEVEL_LABEL[l.key]} channels`}
            >
              {c.channels.map((ch) => {
                const on = l.channels.includes(ch.key);
                const av = !c.can_edit.allowed ? c.can_edit : ch.available;
                return (
                  <button
                    key={ch.key}
                    type="button"
                    className={styles.chan}
                    aria-pressed={on}
                    data-locked={!av.allowed}
                    title={av.allowed ? ch.description : (av.reason ?? undefined)}
                    onClick={guarded(av, () =>
                      update.mutate({ level: { key: l.key, channel: ch.key as NotifyChannel } }),
                    )}
                  >
                    {!av.allowed && ch.key !== 'dashboard' && <Icon name="lock" size={14} />}
                    {ch.label}
                  </button>
                );
              })}
            </div>
            {l.timeout_min === null ? (
              <span className={styles.faint}>No escalation — shown on dashboards only.</span>
            ) : (
              <label className={styles.timeout}>
                Escalate if not acknowledged within
                <CommitNumber
                  min={1}
                  max={120}
                  value={l.timeout_min}
                  readOnly={!c.can_edit.allowed}
                  title={c.can_edit.reason ?? undefined}
                  onCommit={(v) =>
                    c.can_edit.allowed
                      ? update.mutateAsync({ level: { key: l.key, timeout_min: v } })
                      : Promise.reject(guarded(c.can_edit, () => undefined)())
                  }
                />
                min
              </label>
            )}
          </section>
        );
      })}
    </div>
  );
}
