import { useLogin, useSession } from '../session';
import styles from './shell.module.css';

/** Mock Brain demo accounts (design "VIEW AS"). Development builds only. */
const DEMO_ROLES = [
  { username: 'admin', name: 'System Administrator' },
  { username: 'manager', name: 'Greenhouse Manager' },
  { username: 'grower', name: 'Grower / Crop Manager' },
  { username: 'supervisor', name: 'Greenhouse Supervisor' },
  { username: 'scout', name: 'Crop Scout / Plant Health Technician' },
  { username: 'maint', name: 'Irrigation / Maintenance Technician' },
  { username: 'worker', name: 'Greenhouse Worker' },
];

/** Switches the mock session to another demo role, so RBAC can be checked like in the prototype. */
export function ViewAs({ wide }: { wide: boolean }) {
  const { data: session } = useSession();
  const login = useLogin();
  if (!session) return null;
  return (
    <label className={styles.viewAs} title="Development only: sign in as another mock role">
      {wide && <span className={styles.viewAsLabel}>VIEW AS</span>}
      <select
        value={session.user.username}
        onChange={(e) => login.mutate({ username: e.target.value, password: 'demo' })}
        aria-label="View as role"
      >
        {DEMO_ROLES.map((r) => (
          <option key={r.username} value={r.username}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
  );
}
