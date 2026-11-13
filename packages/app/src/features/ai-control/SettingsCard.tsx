import type { AiControl, AiSettingsUpdate } from '@lefi/api';
import { CommitNumber, Icon, Switch, useToast } from '../../shared/ui';
import { useAiControlActions } from './useAiControlActions';
import styles from './aiControl.module.css';

const DEPTH_NOTE = {
  Fast: 'Single-model check · lowest load on the AI node.',
  Standard: 'Cross-checks sensors, imagery and zone history.',
  'Deep research':
    'Also consults the enabled sources and similar past cases, then explains its reasoning · slower.',
} as const;

/** AI intelligence settings (design). Sources needing the internet are unavailable: LEFI CROP runs offline. */
export function SettingsCard({ c }: { c: AiControl }) {
  const { settings } = useAiControlActions();
  const toast = useToast((s) => s.show);
  const s = c.settings;
  const locked = !s.can_edit.allowed;
  const send = (b: AiSettingsUpdate) =>
    locked ? toast(s.can_edit.reason ?? 'Not allowed.', 'bad') : settings.mutate(b);
  const commit = (b: AiSettingsUpdate) => settings.mutateAsync(b);

  return (
    <section className={styles.card}>
      <div className={styles.titleBlock}>
        <span className={styles.cardTitle}>AI intelligence settings</span>
        <span className={styles.muted}>
          How deeply Lefi AI investigates before it raises an alert or suggests an action.{' '}
          {locked ? s.can_edit.reason : ''}
        </span>
      </div>
      <div className={styles.field}>
        <span className={styles.eyebrow}>Analysis depth</span>
        <div className={styles.depth} role="group" aria-label="Analysis depth">
          {(['Fast', 'Standard', 'Deep research'] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={s.depth === d}
              onClick={() => s.depth !== d && send({ depth: d })}
            >
              {d}
            </button>
          ))}
        </div>
        <span className={styles.muted}>{DEPTH_NOTE[s.depth]}</span>
      </div>
      <div className={styles.field}>
        <span className={styles.eyebrow}>Research sources</span>
        <div className={styles.sources}>
          {s.sources.map((src) => (
            <button
              key={src.key}
              type="button"
              aria-pressed={src.on}
              data-locked={!src.available.allowed}
              title={src.available.reason ?? undefined}
              onClick={() =>
                src.available.allowed
                  ? send({ source: src.key })
                  : toast(src.available.reason ?? 'Not available.', 'bad')
              }
            >
              <Icon
                name={!src.available.allowed ? 'cloud_off' : src.on ? 'check' : 'add'}
                size={16}
              />
              {src.label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.inputs}>
        <label>
          Min. confidence to raise an alert (%)
          <CommitNumber
            value={s.min_confidence}
            disabled={locked}
            onCommit={(v) => commit({ min_confidence: v })}
          />
        </label>
        <label>
          Corroborating signals required
          <CommitNumber
            value={s.corroborating}
            disabled={locked}
            onCommit={(v) => commit({ corroborating: v })}
          />
        </label>
        <label>
          Re-scan flagged plants every
          <select
            value={s.rescan}
            disabled={locked}
            onChange={(e) => send({ rescan: e.target.value })}
          >
            {['6 h', '12 h', '24 h', '48 h'].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
      </div>
      <div>
        {s.toggles.map((t) => (
          <div key={t.key} className={styles.guard}>
            <div className={styles.autoText}>
              <b>{t.label}</b>
              <span className={styles.faint}>
                {t.description}
                {!t.available.allowed && ` · ${t.available.reason}`}
              </span>
            </div>
            <Switch
              on={t.on}
              label={t.label}
              disabled={locked || !t.available.allowed}
              title={t.available.reason ?? undefined}
              onChange={() =>
                t.available.allowed
                  ? send({ toggle: t.key })
                  : toast(t.available.reason ?? 'Not available.', 'bad')
              }
            />
          </div>
        ))}
      </div>
    </section>
  );
}
