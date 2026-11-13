import { useNavigate } from '@tanstack/react-router';
import type { AiSummary, SystemStatus } from '@lefi/api';
import { mascots } from '@lefi/ui';
import { clock } from '../../shared/lib/time';
import { Badge, Button, Card, RichText } from '../../shared/ui';
import styles from './dashboard.module.css';

/**
 * Lefi operational summary. Shows only text the Brain returns; a fixture is tagged SIMULATED
 * instead of AI-GENERATED, and with AI off or unavailable it says so (never invented text).
 */
export function LefiSummaryCard({
  summary,
  ai,
  focusZone,
}: {
  summary: AiSummary | undefined;
  ai: SystemStatus['ai'] | undefined;
  /** Zone that needs attention first; the sensors button opens it. */
  focusZone?: string | undefined;
}) {
  const navigate = useNavigate();
  const off = ai?.kill_switch;
  const available = !off && summary?.state === 'available' && summary.text;
  return (
    <Card variant="accent" className={styles.lefiCard}>
      <img
        src={available ? mascots.thinking : mascots.sleeping}
        alt="Lefi"
        className={styles.lefiMascot}
      />
      <div className={styles.lefiBody}>
        <div className={styles.lefiHead}>
          <span className={styles.lefiTitle}>Lefi operational summary</span>
          {available && summary.generated_at && (
            <Badge tone={summary.simulated ? 'sim' : 'ok'} variant="tag">
              {summary.simulated ? 'Simulated' : 'AI-generated'} · {clock(summary.generated_at)}
            </Badge>
          )}
        </div>
        {available ? (
          <>
            <p className={styles.lefiText}>
              <RichText text={summary.text ?? ''} />
            </p>
            <div className={styles.lefiActions}>
              <Button
                size="sm"
                onClick={() =>
                  void navigate({
                    to: '/environment',
                    search: focusZone ? { zone: focusZone } : {},
                  })
                }
              >
                {focusZone ? `Open ${focusZone} sensors` : 'Open environment sensors'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void navigate({ to: '/plant-health' })}
              >
                Review AI detections
              </Button>
            </div>
            <span className={styles.lefiNote}>
              {summary.basis ? `${summary.basis}. ` : ''}Verify before acting.
            </span>
          </>
        ) : (
          <p className={styles.lefiText}>
            {off
              ? 'Lefi AI is stopped. Monitoring and alerts keep running on the rules engine.'
              : `AI reasoning unavailable${ai?.reason ? ` — ${ai.reason.replace(/\.$/, '')}` : ''}. Monitoring and alerts keep running on the rules engine.`}
          </p>
        )}
      </div>
    </Card>
  );
}
