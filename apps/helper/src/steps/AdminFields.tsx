import { useEffect, useState } from 'react';
import { consoleApi } from '../console';
import type { AdminAuth } from '../console';

/** Who may take something away (ADR-043). `null`: this PC has no administrator yet. */
export function useAdminAuth() {
  const [required, setRequired] = useState(false);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  useEffect(() => {
    consoleApi.state().then(
      (s) => {
        setRequired(s.admin_required);
        setUsername(s.admin_username);
      },
      () => setRequired(true),
    );
  }, []);
  const auth: AdminAuth | null = required ? { username, password } : null;
  return {
    required,
    username,
    setUsername,
    password,
    setPassword,
    auth,
    ready: !required || password.length > 0,
    clear: () => setPassword(''),
  };
}

export function AdminFields({ a }: { a: ReturnType<typeof useAdminAuth> }) {
  if (!a.required) return null;
  return (
    <div className="admin-fields">
      <label className="field">
        <span className="field-label">Administrator</span>
        <input
          className="input"
          autoComplete="off"
          value={a.username}
          onChange={(e) => a.setUsername(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label">Password</span>
        <input
          className="input"
          type="password"
          autoComplete="off"
          value={a.password}
          onChange={(e) => a.setPassword(e.target.value)}
        />
      </label>
    </div>
  );
}
