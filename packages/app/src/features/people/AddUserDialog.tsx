import { useState, type FormEvent } from 'react';
import { people, type BrainRole, type BrainUser, type NewBrainUser } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { Button, Dialog, FormField, Icon } from '../../shared/ui';
import { usePeopleMutation } from './common';
import styles from './people.module.css';

const EMPTY = { username: '', display_name: '', email: '', role: 'worker', password: '' };

/**
 * Add a person who can sign in. Offline-first: no email is sent. Lefi Brain makes a temporary
 * password (or takes the one typed here); the person changes it at their first sign-in. Lefi Brain
 * validates every field and says why it refuses one.
 */
export function AddUserDialog({
  open,
  roles,
  onClose,
  onCreated,
}: {
  open: boolean;
  roles: BrainRole[];
  onClose: () => void;
  onCreated: (user: BrainUser, temporaryPassword: string | null) => void;
}) {
  const platform = usePlatform();
  const [f, setF] = useState(EMPTY);
  const [typed, setTyped] = useState(false);
  const create = usePeopleMutation(
    () =>
      people.createUser(platform, {
        username: f.username.trim(),
        display_name: f.display_name,
        email: f.email.trim() || null,
        role: f.role as NewBrainUser['role'],
        password: typed ? f.password : null,
      }),
    (r) => `${r.user.display_name} can now sign in as ${r.user.username}.`,
  );
  const close = () => {
    setF(EMPTY);
    setTyped(false);
    create.reset();
    onClose();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(undefined, {
      onSuccess: (r) => {
        close();
        onCreated(r.user, r.temporary_password);
      },
    });
  };
  const set = (k: keyof typeof EMPTY) => (v: string) => setF({ ...f, [k]: v });
  return (
    <Dialog open={open} onClose={close} labelledBy="add-user-title" width={540}>
      <form onSubmit={submit} className={styles.form}>
        <div className={styles.dialogHead}>
          <span id="add-user-title" className={styles.dialogTitle}>
            Add user
          </span>
          <button type="button" className={styles.close} aria-label="Close" onClick={close}>
            <Icon name="close" size={22} />
          </button>
        </div>
        <div className={styles.grid2}>
          <FormField label="Full name">
            <input
              value={f.display_name}
              maxLength={128}
              onChange={(e) => set('display_name')(e.target.value)}
              placeholder="e.g. María López"
            />
          </FormField>
          <FormField label="Username (to sign in)">
            <input
              value={f.username}
              required
              maxLength={64}
              autoCapitalize="none"
              spellCheck={false}
              onChange={(e) => set('username')(e.target.value.toLowerCase())}
              placeholder="e.g. maria.lopez"
            />
          </FormField>
          <FormField label="Email (optional)">
            <input
              type="email"
              value={f.email}
              maxLength={255}
              onChange={(e) => set('email')(e.target.value)}
            />
          </FormField>
          <FormField label="Role">
            <select value={f.role} onChange={(e) => set('role')(e.target.value)}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <span className={styles.muted}>
          Username: 2–64 characters, lower-case letters, digits, “.”, “_” or “-”. The role decides
          what this person sees and may do (Administration → Roles &amp; permissions).
        </span>
        <fieldset className={styles.choice}>
          <legend>First password</legend>
          <label>
            <input type="radio" checked={!typed} onChange={() => setTyped(false)} /> Lefi Brain
            makes a temporary password and shows it once
          </label>
          <label>
            <input type="radio" checked={typed} onChange={() => setTyped(true)} /> I type a
            temporary password
          </label>
          {typed && (
            <input
              type="password"
              aria-label="Temporary password"
              autoComplete="new-password"
              minLength={10}
              required
              value={f.password}
              onChange={(e) => set('password')(e.target.value)}
              placeholder="At least 10 characters"
            />
          )}
        </fieldset>
        <span className={styles.muted}>
          No email is sent. The person must choose their own password at their first sign-in.
        </span>
        <div className={styles.dialogFoot}>
          <Button variant="secondary" type="button" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" icon="person_add" disabled={create.isPending}>
            Add user
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
