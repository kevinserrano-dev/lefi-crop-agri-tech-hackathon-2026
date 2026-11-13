import type { ReactNode } from 'react';
import type { AiBriefing } from '@lefi/api';
import { mascots } from '@lefi/ui';
import { Badge, Icon } from '../../shared/ui';
import styles from './handover.module.css';

/**
 * Lefi's shift summary. Only text the Brain returns is shown; a fixture is tagged SIMULATED
 * (never AI-generated), and with AI stopped or unavailable the card says so.
 */
export function ShiftSummaryCard({ s }: { s: AiBriefing }) {
  const available = s.state === 'available';
  return (
    <section className={styles.summary}>
      <img
        src={available ? mascots.thinking : mascots.sleeping}
        alt="Lefi"
        className={styles.mascot}
      />
      <div className={styles.summaryBody}>
        <div className={styles.summaryHead}>
          <span className={styles.summaryTitle}>Lefi’s shift summary</span>
          {available && (
            <Badge tone={s.simulated ? 'sim' : 'ok'} variant="tag">
              {s.simulated ? 'Simulated' : 'AI-generated'} · review before signing
            </Badge>
          )}
        </div>
        {available ? (
          <div className={styles.summaryGrid}>
            <Block label="What happened">
              <span className={styles.prose}>{s.happened}</span>
            </Block>
            <Block label="Why it happened">
              <span className={styles.prose}>{s.why}</span>
            </Block>
            <Block label="What was done">
              {s.done.map((d) => (
                <Line key={d} icon="check" tone="ok" text={d} />
              ))}
            </Block>
            <Block label="Needs attention next" warn>
              {s.next.map((d) => (
                <Line key={d} icon="arrow_right" tone="warn" text={d} />
              ))}
            </Block>
          </div>
        ) : (
          <p className={styles.prose}>
            {s.state === 'disabled'
              ? 'Lefi AI is stopped, so no shift summary is generated. Review the cards below before signing.'
              : 'AI reasoning unavailable — no shift summary. The cards below come from Lefi Brain’s records.'}
          </p>
        )}
      </div>
    </section>
  );
}

function Block({ label, warn, children }: { label: string; warn?: boolean; children: ReactNode }) {
  return (
    <div className={styles.block}>
      <span className={styles.blockLabel} data-warn={warn}>
        {label}
      </span>
      {children}
    </div>
  );
}

function Line({ icon, tone, text }: { icon: string; tone: 'ok' | 'warn'; text: string }) {
  return (
    <span className={styles.line}>
      <Icon name={icon} size={16} className={styles[tone]} />
      {text}
    </span>
  );
}
