import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { peopleKeys, type BrainUser } from '@lefi/api';
import { describeError } from '../../shared/lib/errors';
import { Badge, Button, Dialog, Icon, useToast } from '../../shared/ui';
import styles from './people.module.css';

/** A change sent to Lefi Brain: its own answer decides; errors are shown as Lefi Brain said them. */
export function usePeopleMutation<A, R>(fn: (a: A) => Promise<R>, ok?: (r: R) => string) {
  const qc = useQueryClient();
  const toast = useToast((t) => t.show);
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: peopleKeys.all });
      if (ok) toast(ok(r), 'ok');
    },
    onError: (e) => {
      toast(describeError(e), 'bad');
      void qc.invalidateQueries({ queryKey: peopleKeys.all });
    },
  });
}

/** Locked by failed sign-ins, judged by Lefi Brain's clock (ADR-008). */
export function isLocked(user: BrainUser, brainNow: string | undefined): boolean {
  if (user.locked_until === null) return false;
  return !brainNow || Date.parse(user.locked_until) > Date.parse(brainNow);
}

/** Active / deactivated, plus what the administrator should know (temporary password, lock). */
export function UserBadges({ user, brainNow }: { user: BrainUser; brainNow?: string }) {
  const locked = isLocked(user, brainNow);
  return (
    <span className={styles.badges}>
      {user.status === 'active' ? (
        <Badge tone="ok" dot>
          Active
        </Badge>
      ) : (
        <Badge tone="crit" dot>
          Deactivated
        </Badge>
      )}
      {user.must_change_password && user.status === 'active' && (
        <Badge tone="info" title="Signs in with a temporary password, then chooses their own">
          Temporary password
        </Badge>
      )}
      {locked && (
        <Badge tone="warn" icon="lock" title="Too many failed sign-ins">
          Locked
        </Badge>
      )}
    </span>
  );
}

/**
 * A temporary password Lefi Brain made. It is shown here once and never again: Lefi Brain keeps
 * only its hash. The person must choose their own password at their first sign-in.
 */
export function TemporaryPasswordDialog({
  shown,
  onClose,
}: {
  shown: { username: string; password: string; title: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!shown) return null;
  const copy = () => {
    void navigator.clipboard?.writeText(shown.password).then(() => setCopied(true));
  };
  return (
    <Dialog open onClose={onClose} labelledBy="temp-pw-title" width={480}>
      <div className={styles.form}>
        <span id="temp-pw-title" className={styles.dialogTitle}>
          {shown.title}
        </span>
        <span>
          Give these to <b>{shown.username}</b>. They sign in in Lefi Desktop or the mobile app and
          choose their own password right away.
        </span>
        <div className={styles.secret}>
          <span className={styles.muted}>Username</span>
          <code>{shown.username}</code>
          <span className={styles.muted}>Temporary password</span>
          <code data-testid="temporary-password">{shown.password}</code>
        </div>
        <span className={styles.warn}>
          <Icon name="visibility_off" size={16} /> Shown only now. Lefi Brain keeps only its hash;
          if it is lost, reset the password again.
        </span>
        <div className={styles.dialogFoot}>
          <Button variant="secondary" icon="content_copy" onClick={copy}>
            {copied ? 'Copied' : 'Copy password'}
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Dialog>
  );
}

export function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className={styles.facts}>
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
