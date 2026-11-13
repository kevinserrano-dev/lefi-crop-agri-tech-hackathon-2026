import type { AiControl, AutonomyMode } from '@lefi/api';
import { toneVars, type Tone } from '@lefi/ui';
import { CommitNumber, Icon, Switch, useToast } from '../../shared/ui';
import { useAiControlActions } from './useAiControlActions';
import styles from './aiControl.module.css';

const RISK: Record<string, Tone> = { Low: 'ok', Medium: 'info', High: 'warn', Critical: 'crit' };
const MODE_LABEL: Record<AutonomyMode, string> = {
  off: 'Off · manual',
  ask: 'Ask approval',
  auto: 'Autonomous',
};

/**
 * AI autonomy policy (design). The Brain decides which modes each action may take (allowlist,
 * risk) and who may edit; the UI renders its answer and sends each change.
 */
export function AutonomyCard({ c }: { c: AiControl }) {
  const { autonomy } = useAiControlActions();
  const toast = useToast((s) => s.show);
  const a = c.autonomy;
  const count = (m: AutonomyMode) => a.rows.filter((r) => r.mode === m).length;
  const locked = !a.can_edit.allowed;
  const blocked = (reason: string | null) => toast(reason ?? 'Not allowed.', 'bad');

  return (
    <section className={styles.card}>
      <div className={styles.rowBetween}>
        <div className={styles.titleBlock}>
          <span className={styles.cardTitle}>AI autonomy policy</span>
          <span className={styles.muted}>
            Decide, per action, whether Lefi AI may act on its own, must ask an approver, or may not
            suggest it at all. <b>Default for every action: Ask approval</b> — nothing runs
            autonomously until a System Administrator allows it, and the validator authorises every
            run. Actions that would drive actuators are not in the allowlist.{' '}
            {locked ? a.can_edit.reason : ''}
          </span>
        </div>
        <div className={styles.summary}>
          <span style={{ background: 'var(--lefi-warn-bg)', color: 'var(--lefi-warn-fg)' }}>
            {count('auto')} autonomous
          </span>
          <span style={{ background: 'var(--lefi-green-50)', color: 'var(--lefi-forest-800)' }}>
            {count('ask')} ask approval
          </span>
          <span style={{ background: 'var(--lefi-off-bg)', color: 'var(--lefi-off-fg)' }}>
            {count('off')} off
          </span>
        </div>
      </div>

      <div className={styles.tableWrap}>
        <div className={styles.table} role="table" aria-label="AI autonomy policy">
          <div role="row" className={styles.tHead}>
            <span>Decision / action</span>
            <span>Area</span>
            <span>Risk</span>
            <span>Mode</span>
            <span>Approver</span>
          </div>
          {a.rows.map((r) => {
            const rt = toneVars(RISK[r.risk] ?? 'off');
            return (
              <div role="row" key={r.key} className={styles.tRow}>
                <div className={styles.autoText}>
                  <b>{r.label}</b>
                  <span className={styles.faint}>{r.note}</span>
                </div>
                <span className={styles.muted}>{r.area}</span>
                <span className={styles.risk} style={{ background: rt.bg, color: rt.fg }}>
                  {r.risk}
                </span>
                <div className={styles.modeSeg} role="group" aria-label={`Mode for ${r.label}`}>
                  {(['off', 'ask', 'auto'] as const).map((m) => {
                    const av = r.modes[m];
                    const sel = r.mode === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={sel}
                        data-mode={m}
                        data-locked={!av.allowed && !sel}
                        title={!av.allowed ? (av.reason ?? undefined) : MODE_LABEL[m]}
                        onClick={() =>
                          sel
                            ? undefined
                            : av.allowed
                              ? autonomy.mutate({ row: { key: r.key, mode: m } })
                              : blocked(av.reason)
                        }
                      >
                        {!av.allowed && !sel && <Icon name="lock" size={12} />}
                        {MODE_LABEL[m]}
                      </button>
                    );
                  })}
                </div>
                {r.mode === 'ask' ? (
                  <select
                    className={styles.approver}
                    value={r.approver}
                    aria-label={`Approver for ${r.label}`}
                    disabled={locked}
                    onChange={(e) =>
                      autonomy.mutate({ row: { key: r.key, approver: e.target.value } })
                    }
                  >
                    {a.approvers.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className={styles.faint}>—</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.guards}>
        {a.guardrails.map((g) => (
          <div key={g.key} className={styles.guard}>
            <div className={styles.autoText}>
              <b>{g.label}</b>
              <span className={styles.faint}>{g.description}</span>
            </div>
            <Switch
              on={g.on}
              label={g.label}
              disabled={locked}
              title={locked ? (a.can_edit.reason ?? undefined) : undefined}
              onChange={() =>
                locked
                  ? blocked(a.can_edit.reason)
                  : autonomy.mutate({ guardrail: { key: g.key, on: !g.on } })
              }
            />
          </div>
        ))}
        <label className={styles.guard}>
          <b>Max autonomous actions per hour</b>
          <CommitNumber
            className={styles.num}
            value={a.max_per_hour}
            disabled={locked}
            aria-label="Max autonomous actions per hour"
            onCommit={(v) => autonomy.mutateAsync({ max_per_hour: v })}
          />
        </label>
      </div>
    </section>
  );
}
