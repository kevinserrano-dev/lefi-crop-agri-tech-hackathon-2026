import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { endpoints, queries, queryKeys, type SystemConfig } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { Button, Icon, ProvenanceBadge, Skeleton, Switch, useToast } from '../../shared/ui';
import styles from './admin.module.css';

type Field = SystemConfig['sections'][number]['fields'][number];

/**
 * System configuration. Edits stay a local draft until "Save configuration"; the Brain
 * validates each value. Settings owned by the installer, firmware or an ADR are read-only
 * and say who owns them.
 */
export function ConfigTab() {
  const platform = usePlatform();
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const navigate = useNavigate();
  const q = useQuery(queries.systemConfig(platform));
  const [draft, setDraft] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => endpoints.saveConfig(platform, draft),
    onSuccess: (r) => {
      qc.setQueryData(queryKeys.systemConfig, r.item);
      void qc.invalidateQueries({ queryKey: queryKeys.admin }); // audit trail
      setDraft({});
      toast(r.message, 'ok');
    },
    onError: (e) => toast(describeError(e), 'bad'),
  });
  if (q.isPending) return <Skeleton height={500} />;
  if (q.isError) return <span className={styles.faint}>{describeError(q.error)}</span>;
  const c = q.data;
  const dirty = Object.keys(draft).length > 0;
  const set = (f: Field, v: string) =>
    setDraft((d) => {
      const next = { ...d, [f.key]: v };
      if (v === f.value) delete next[f.key];
      return next;
    });
  return (
    <>
      <div className={styles.toolbar}>
        <span className={styles.text}>
          {c.can_edit.allowed
            ? 'Changes are validated and audited by Lefi Brain when you save.'
            : c.can_edit.reason}{' '}
          <ProvenanceBadge origin={c.origin} />
        </span>
        <div className={styles.toolbarRight}>
          {dirty && (
            <Button variant="secondary" onClick={() => setDraft({})}>
              Discard
            </Button>
          )}
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            Save configuration
          </Button>
        </div>
      </div>
      <div className={styles.configGrid}>
        {c.sections.map((s) => (
          <section key={s.title} className={styles.card} aria-label={s.title}>
            <span className={styles.cardTitle}>{s.title}</span>
            <div className={styles.fields}>
              {s.fields.map((f) => {
                const value = draft[f.key] ?? f.value;
                const ro = !f.editable.allowed;
                return f.kind === 'toggle' ? (
                  <div key={f.key} className={styles.toggleField}>
                    <div className={styles.permText}>
                      <b>{f.label}</b>
                      <span className={styles.faint}>{ro ? f.editable.reason : f.hint}</span>
                    </div>
                    <Switch
                      label={f.label}
                      on={value === 'on'}
                      disabled={ro}
                      title={f.editable.reason ?? undefined}
                      onChange={() =>
                        ro
                          ? toast(f.editable.reason ?? 'Not allowed.', 'bad')
                          : set(f, value === 'on' ? 'off' : 'on')
                      }
                    />
                  </div>
                ) : (
                  <label key={f.key} className={styles.field} data-wide={f.kind === 'text'}>
                    <span className={styles.fieldLabel}>
                      {f.label}
                      {ro && <Icon name="lock" size={13} />}
                    </span>
                    <span className={styles.inputWrap} data-ro={ro} data-dirty={f.key in draft}>
                      <input
                        value={value}
                        readOnly={ro}
                        inputMode={f.kind === 'number' ? 'decimal' : undefined}
                        placeholder={f.hint ?? undefined}
                        title={f.editable.reason ?? undefined}
                        onChange={(e) => set(f, e.target.value)}
                      />
                      {f.unit && <span className={styles.unit}>{f.unit}</span>}
                    </span>
                    <span className={styles.faint}>{ro ? f.editable.reason : f.hint}</span>
                  </label>
                );
              })}
            </div>
          </section>
        ))}
        <section className={`${styles.card} ${styles.aiCard}`}>
          <span className={styles.cardTitle}>
            <Icon name="shield" size={22} /> AI &amp; autonomy settings
          </span>
          <span className={styles.prose}>
            What Lefi AI may decide on its own, who approves each decision, research depth,
            confidence thresholds and the emergency stop are managed in{' '}
            <b>AI Control &amp; Safety</b>. By default no AI action is autonomous.
          </span>
          <div>
            <Button onClick={() => void navigate({ to: '/ai-control' })}>
              Open AI Control &amp; Safety
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
