import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queries, type EscalationConfig, type EscalationMode } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { Badge, Icon, Segmented, Select, Skeleton, Switch } from '../../shared/ui';
import { useEscalationActions } from './useEscalationActions';
import styles from './escalation.module.css';

const MODES: Array<{ value: EscalationMode; label: string }> = [
  { value: 'dynamic', label: 'Dynamic' },
  { value: 'fixed', label: 'Fixed chain' },
];

/** Who receives an alert: mode, a live preview resolved by the Brain, and routing rules. */
export function RoutingCard({ c }: { c: EscalationConfig }) {
  const platform = usePlatform();
  const { update, guarded } = useEscalationActions();
  const [type, setType] = useState(c.incident_types[0]?.id ?? 'env');
  const [slot, setSlot] = useState(c.slots[0]?.id ?? 'day');
  const preview = useQuery(queries.escalationPreview(platform, type, slot));
  return (
    <section className={styles.card}>
      <div className={styles.rowBetween}>
        <div className={styles.titleBlock}>
          <span className={styles.cardTitle}>Who receives the alert · dynamic escalation</span>
          <span className={styles.faint}>
            Configured here · resolved from Workforce shifts and the on-call roster
          </span>
        </div>
        <Segmented
          label="Escalation mode"
          options={MODES}
          value={c.mode}
          onChange={(m) => {
            if (m !== c.mode) guarded(c.can_edit, () => update.mutate({ mode: m }))();
          }}
        />
      </div>
      <span className={styles.text}>{c.description}</span>
      {c.fallback_notice && (
        <div className={styles.notice}>
          <Icon name="cloud_off" size={18} />
          {c.fallback_notice}
        </div>
      )}
      <div className={styles.previewBar}>
        <span className={styles.eyebrow}>Preview · critical alert in GH1-Z2</span>
        <Select aria-label="Incident type" value={type} onChange={(e) => setType(e.target.value)}>
          {c.incident_types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </Select>
        <Segmented
          label="Time of the alert"
          options={c.slots.map((s) => ({ value: s.id, label: s.label }))}
          value={slot}
          onChange={setSlot}
        />
      </div>
      {preview.isPending ? (
        <Skeleton height={150} />
      ) : preview.isError ? (
        <span className={styles.faint}>{describeError(preview.error)}</span>
      ) : (
        <>
          <div className={styles.list} aria-label="Escalation preview">
            {preview.data.steps.map((st) => (
              <div key={st.level} className={styles.step}>
                <span className={styles.level}>L{st.level}</span>
                <div className={styles.stepText}>
                  <b>
                    {st.who} <span className={styles.role}>· {st.role}</span>
                  </b>
                  <span className={styles.faint}>{st.why}</span>
                </div>
                <div className={styles.stepWhen}>
                  <span className={styles.channel}>{st.channels}</span>
                  <span className={styles.mono}>{st.when}</span>
                </div>
              </div>
            ))}
          </div>
          {preview.data.skipped.length > 0 && (
            <div className={styles.skipped}>
              <span className={styles.eyebrow}>Skipped</span>
              {preview.data.skipped.map((k) => (
                <span key={k}>• {k}</span>
              ))}
            </div>
          )}
          <div className={styles.resolver}>
            <Badge tone="sim" variant="tag">
              Resolved by: {preview.data.resolver}
            </Badge>
          </div>
        </>
      )}
      <div className={styles.list}>
        {c.rules.map((r) => (
          <div key={r.key} className={styles.toggleRow}>
            <div className={styles.stepText}>
              <b>{r.label}</b>
              <span className={styles.faint}>{r.description}</span>
            </div>
            <Switch
              label={r.label}
              on={r.on}
              disabled={!c.can_edit.allowed}
              title={c.can_edit.reason ?? undefined}
              onChange={guarded(c.can_edit, () =>
                update.mutate({ rule: { key: r.key, on: !r.on } }),
              )}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
