import { useState, type FormEvent } from 'react';
import { describeError } from '../../shared/lib/errors';
import { Button, Icon, TextField } from '../../shared/ui';
import { useChangePassword, useLogout } from './useSession';
import styles from './session.module.css';

/**
 * Shown when the Lefi Brain says this account must change its password before anything else
 * (first sign-in of the installer's administrator, or after a reset). The Brain enforces it:
 * every other request answers `PASSWORD_CHANGE_REQUIRED` until the change is done. The password
 * rules are the Brain's; this form only checks that the two new passwords match.
 */
export function ChangePasswordForm({ currentPassword }: { currentPassword: string }) {
  const change = useChangePassword();
  const logout = useLogout();
  const [current, setCurrent] = useState(currentPassword);
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const mismatch = again.length > 0 && next !== again;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== again) return;
    change.mutate({ current_password: current, new_password: next });
  }

  return (
    <>
      <div className={styles.heading}>
        <h2>Choose a new password</h2>
        <p>This account has a temporary password. Choose your own before you continue.</p>
      </div>
      <form className={styles.fields} onSubmit={submit}>
        {!currentPassword && (
          <TextField
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        )}
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
        <TextField
          label="New password again"
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          required
        />
        {mismatch && (
          <div className={styles.error} role="alert">
            <Icon name="error" size={18} />
            The two new passwords are different.
          </div>
        )}
        {change.isError && (
          <div className={styles.error} role="alert">
            <Icon name="error" size={18} />
            {describeError(change.error)}
          </div>
        )}
        <Button type="submit" size="lg" block disabled={change.isPending || mismatch}>
          {change.isPending ? 'Saving…' : 'Save and continue'}
        </Button>
        <Button type="button" variant="ghost" block onClick={() => logout.mutate()}>
          Sign out
        </Button>
      </form>
    </>
  );
}
