import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queries } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { Button, Dialog, FormField, Icon } from '../../shared/ui';
import { useWorkforceActions } from './useWorkforceActions';
import styles from './workforce.module.css';

/**
 * Invite a user. Offline-first: no email is sent; the Brain records an "Invited" account that
 * the person activates by signing in on the local network. The Brain validates every field.
 */
export function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const roles = useQuery(queries.roles(usePlatform()));
  const { invite } = useWorkforceActions();
  const [f, setF] = useState({ name: '', email: '', role: 'worker' });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    invite.mutate(f, {
      onSuccess: () => {
        setF({ name: '', email: '', role: 'worker' });
        onClose();
      },
    });
  };
  return (
    <Dialog open={open} onClose={onClose} labelledBy="invite-title" width={520}>
      <form onSubmit={submit} className={styles.form}>
        <div className={styles.dialogHead}>
          <span id="invite-title" className={styles.dialogTitle}>
            Invite user
          </span>
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </div>
        <FormField label="Full name">
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </FormField>
        <FormField label="Email (used as the sign-in name)">
          <input
            type="email"
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
          />
        </FormField>
        <FormField label="Role">
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            {roles.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </FormField>
        <span className={styles.faint}>
          No email is sent. The account stays “Invited” until the person signs in on the local
          network.
        </span>
        <div className={styles.dialogFoot}>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={invite.isPending}>
            Invite
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
