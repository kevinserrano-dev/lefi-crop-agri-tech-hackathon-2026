import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { endpoints, queries, queryKeys, type OperatingRanges } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { ActionButton, Badge, Button, useToast } from '../../shared/ui';
import styles from './environment.module.css';

type Draft = Record<string, { min: string; max: string }>;
const toDraft = (r: OperatingRanges): Draft =>
  Object.fromEntries(r.rows.map((x) => [x.variable, { min: String(x.min), max: String(x.max) }]));

/**
 * Operating ranges (design). The Brain validates (min < max), applies and audits; the values
 * stay a placeholder profile until an agronomist confirms them.
 */
export function OperatingRangesCard() {
  const platform = usePlatform();
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const q = useQuery(queries.operatingRanges(platform));
  const [draft, setDraft] = useState<Draft | null>(null);
  const save = useMutation({
    mutationFn: (d: Draft) =>
      endpoints.saveOperatingRanges(platform, {
        rows: Object.entries(d).map(([variable, v]) => ({
          variable,
          min: Number(v.min),
          max: Number(v.max),
        })),
      }),
    onSuccess: (r) => {
      qc.setQueryData(queryKeys.operatingRanges, r.item);
      void qc.invalidateQueries({ queryKey: ['zones'] });
      setDraft(null);
      toast(r.message, 'ok');
    },
    onError: (e) => toast(describeError(e), 'bad'),
  });

  const r = q.data;
  const editing = draft !== null;
  const set = (variable: string, k: 'min' | 'max', v: string) =>
    setDraft((d) => (d ? { ...d, [variable]: { ...d[variable]!, [k]: v } } : d));

  return (
    <section className={styles.ranges}>
      <div className={styles.rangesHead}>
        <div className={styles.rangesTitle}>
          <span>
            Operating ranges{' '}
            {r?.profile.is_placeholder && (
              <Badge tone="warn" variant="tag">
                Placeholder profile
              </Badge>
            )}
          </span>
          <span className={styles.muted}>
            Crop profile · {r?.profile.name ?? '…'} · alerts trigger outside these limits
          </span>
        </div>
        {r && !editing && (
          <ActionButton
            label="Configure ranges"
            icon="tune"
            availability={r.can_edit}
            onClick={() =>
              r.can_edit.allowed
                ? setDraft(toDraft(r))
                : toast(r.can_edit.reason ?? 'Not allowed.', 'bad')
            }
          />
        )}
        {editing && (
          <div className={styles.rowGap}>
            <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(draft)}>
              Save &amp; apply
            </Button>
          </div>
        )}
      </div>
      <div className={styles.rangesGrid} role="table" aria-label="Operating ranges">
        <div role="row" className={styles.rangesHeader}>
          <span>Measurement</span>
          <span>Minimum</span>
          <span>Maximum</span>
          <span>Unit</span>
        </div>
        {r?.rows.map((x) => (
          <div role="row" key={x.variable} className={styles.rangesRow}>
            <span className={styles.strong}>{x.label}</span>
            {(['min', 'max'] as const).map((k) =>
              editing ? (
                <input
                  key={k}
                  type="number"
                  step={x.step}
                  aria-label={`${x.label} ${k}`}
                  className={styles.rangeInput}
                  value={draft[x.variable]?.[k] ?? ''}
                  onChange={(e) => set(x.variable, k, e.target.value)}
                />
              ) : (
                <span key={k} className={styles.mono}>
                  {x[k]}
                </span>
              ),
            )}
            <span className={styles.muted}>{x.unit}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
