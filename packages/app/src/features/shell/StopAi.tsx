import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  endpoints,
  operations,
  queries,
  queryKeys,
  type HaltScope,
  type SystemStatus,
} from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { Button, Dialog, Icon, useToast } from '../../shared/ui';
import { useCan } from '../session';
import { useBrainKind } from './useBrainKind';
import styles from './shell.module.css';

const SCOPES: Array<{ id: HaltScope; title: string; body: string }> = [
  {
    id: 'ai',
    title: 'Stop Lefi AI only',
    body: 'AI decisions, AI-run actions, AI robot dispatch and natural-language commands stop. Rule-based monitoring and alerts keep running.',
  },
  {
    id: 'all',
    title: 'Stop AI + all automations',
    body: 'Everything automated goes to safe-hold: simulated robots safe-stop and dock. Sensors and alarms stay on. (No irrigation or dosing is automated in LEFI CROP.)',
  },
];

/** Emergency-stop dialog (design). The Brain performs and audits the stop. */
export function HaltDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const platform = usePlatform();
  const qc = useQueryClient();
  const [scope, setScope] = useState<HaltScope>('ai');
  const toast = useToast((t) => t.show);
  const [reason, setReason] = useState('');
  // The real Lefi Brain has one stop: its kill switch (no automation exists to stop, ADR-085).
  const real = !useBrainKind().mock;
  const halt = useMutation({
    mutationFn: async () => {
      if (!real) return endpoints.haltAi(platform, { scope, reason: reason.trim() });
      await operations.stopAi(platform, reason.trim() || 'Emergency stop from the top bar');
      return undefined;
    },
    onSuccess: (status) => {
      if (status) qc.setQueryData(queryKeys.systemStatus, status);
      void qc.invalidateQueries();
      toast(
        scope === 'all'
          ? 'Emergency stop: Lefi AI and all automations stopped. Recorded in the audit trail.'
          : 'Emergency stop: Lefi AI stopped. Rules, sensors and alerts keep running.',
        'bad',
      );
      setReason('');
      setScope('ai');
      onClose();
    },
  });

  return (
    <Dialog open={open} onClose={onClose} labelledBy="estop-title">
      <div className={styles.dialogHead}>
        <Icon name="emergency_home" size={30} color="var(--lefi-crit-dot)" />
        <span id="estop-title" className={styles.dialogTitle}>
          Emergency stop
        </span>
      </div>
      <span className={styles.dialogText}>
        Choose what to stop. It takes effect immediately and is recorded in the audit trail.
      </span>
      {real && (
        <span className={styles.dialogText}>
          Lefi AI stops answering and stops using cameras until a person resumes it. Rules, sensors,
          alerts and notifications keep running. No pump, valve or other automation exists to stop.
        </span>
      )}
      {!real &&
        SCOPES.map((o) => (
          <button
            key={o.id}
            type="button"
            className={styles.scope}
            data-selected={scope === o.id}
            onClick={() => setScope(o.id)}
          >
            <span className={styles.radio}>
              <span />
            </span>
            <span className={styles.scopeText}>
              <b>{o.title}</b>
              <span>{o.body}</span>
            </span>
          </button>
        ))}
      <label className={styles.reason}>
        Reason (optional)
        <textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. AI opened vents during frost warning"
        />
      </label>
      {halt.isError && <span className={styles.dialogError}>{describeError(halt.error)}</span>}
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <button
          type="button"
          className={styles.stopNow}
          disabled={halt.isPending}
          onClick={() => halt.mutate()}
        >
          <Icon name="front_hand" size={18} />
          Stop now
        </button>
      </div>
    </Dialog>
  );
}

/**
 * Top-bar emergency stop (design: "STOP AI"). When stopped it links to AI Control & Safety,
 * where resuming happens (its own permission) — or `lefi ai on`.
 */
export function StopAiButton({ ai, wide }: { ai: SystemStatus['ai'] | undefined; wide: boolean }) {
  const allowed = useCan('ai.halt');
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const kind = useBrainKind();
  const real = kind.known && !kind.mock;
  // Against the real Lefi Brain the kill switch is read from Lefi AI's own status.
  const assistant = useQuery({
    ...queries.assistantStatus(usePlatform()),
    enabled: allowed && real,
  });
  if (!allowed) return null;
  const halted = Boolean(real ? assistant.data?.kill_switch : ai?.kill_switch);
  return (
    <>
      <button
        type="button"
        className={styles.estop}
        data-halted={halted}
        title="Emergency stop · Lefi AI and automated actions"
        onClick={() => (halted ? void navigate({ to: '/ai-control' }) : setOpen(true))}
      >
        <Icon name={halted ? 'front_hand' : 'emergency_home'} size={19} />
        {wide && (halted ? 'AI STOPPED' : 'STOP AI')}
      </button>
      <HaltDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
