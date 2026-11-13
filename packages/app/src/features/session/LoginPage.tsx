import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { logos, mascots } from '@lefi/ui';
import { ApiError } from '@lefi/platform';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError, isUnauthorized } from '../../shared/lib/errors';
import { Button, Icon, TextField } from '../../shared/ui';
import { BrainStatePanel } from './BrainStatePanel';
import { ChangePasswordForm } from './ChangePasswordForm';
import { useBrainGate } from './brainGate';
import { DeviceCard, DeviceRevokedPanel } from './DeviceCard';
import { PairForm } from './PairForm';
import { useLogin, useSession } from './useSession';
import styles from './session.module.css';

/** Demo accounts exist only in the development mock Brain (`packages/mock-brain`). */
const DEV_ACCOUNTS = [
  { short: 'Sys Admin', user: 'Priya Raman' },
  { short: 'Manager', user: 'Daniel Tremblay' },
  { short: 'Grower', user: 'Sofia Marchetti' },
  { short: 'Supervisor', user: 'Marcus Okafor' },
  { short: 'Crop Scout', user: 'Hana Kim' },
  { short: 'Maintenance', user: 'Luis Ortega' },
  { short: 'Worker', user: 'Amrit Gill' },
].map((a) => ({ ...a, email: `${a.user.toLowerCase().replace(/\s+/g, '.')}@leficrop.ca` }));

export function LoginPage() {
  const platform = usePlatform();
  const navigate = useNavigate();
  const session = useSession();
  const login = useLogin();
  // Development: Sys Admin preselected, so the whole UI is visible without restrictions.
  const [username, setUsername] = useState(
    import.meta.env.DEV ? (DEV_ACCOUNTS[0]?.email ?? '') : '',
  );
  const [password, setPassword] = useState(import.meta.env.DEV ? 'demo' : '');
  const { gate, url, checking, retry } = useBrainGate();
  // Kept here, not in the panels below: the periodic re-checks never close an open pairing form or
  // clear what was typed in it. `''` = type the address (Advanced); a URL = pair with that one.
  const [pairing, setPairing] = useState<string | null>(null);
  const refetchSession = session.refetch;

  const mustChange = session.data?.must_change_password === true;
  // Lefi Brain refused this PC itself (not the person): it must be paired again.
  const refusal = [session.error, login.error].find(
    (e): e is ApiError =>
      e instanceof ApiError && (e.isDeviceRevoked || e.code === 'DEVICE_NOT_PAIRED'),
  );
  const revoked = refusal !== undefined;
  useEffect(() => {
    if (session.data && !mustChange) void navigate({ to: '/' });
  }, [session.data, mustChange, navigate]);

  // The Brain came back: a session that is still valid goes straight into the app.
  useEffect(() => {
    if (gate.kind === 'ready') void refetchSession();
  }, [gate.kind, refetchSession]);

  function submit(e: FormEvent) {
    e.preventDefault();
    login.mutate({ username: username.trim(), password });
  }

  return (
    <div className={styles.page}>
      <aside className={styles.hero}>
        <div className={styles.eyebrow}>
          <span className={styles.eyebrowDot} />
          Local greenhouse network · offline
        </div>
        <div className={styles.heroCopy}>
          <h1>AI-Powered Greenhouse Operations</h1>
          <p>
            Live sensor monitoring, alerts and AI recommendations — validated by the rules engine,
            on your own network.
          </p>
        </div>
        <img src={mascots.hero} alt="Lefi mascot" className={styles.heroMascot} />
        <div className={styles.heroFoot}>
          LEFI CROP AI · runs on the local network, no cloud services
        </div>
      </aside>

      <main className={styles.panel}>
        <div className={styles.form}>
          <img src={logos.full} alt="Lefi Crop" className={styles.logo} />
          {gate.kind === 'checking' && (
            <div className={styles.brainChecking} role="status">
              Looking for Lefi Brain…
            </div>
          )}
          {gate.kind !== 'ready' && pairing !== null && (
            <PairForm url={pairing || undefined} onCancel={() => setPairing(null)} />
          )}
          {gate.kind !== 'checking' && gate.kind !== 'ready' && pairing === null && (
            <BrainStatePanel
              kind={gate.kind}
              url={url}
              checking={checking}
              onRetry={retry}
              onPair={setPairing}
            />
          )}
          {gate.kind === 'ready' && refusal && (
            <DeviceRevokedPanel error={refusal} url={url} onRecovered={login.reset} />
          )}
          {gate.kind === 'ready' && !revoked && mustChange && (
            <ChangePasswordForm currentPassword={password} />
          )}
          {gate.kind === 'ready' && !revoked && !mustChange && (
            <>
              <div className={styles.heading}>
                <h2>Sign in to your operation</h2>
                <p>
                  Use your Lefi Crop work account.{' '}
                  {url && (
                    <span className={styles.brainUrl}>
                      Lefi Brain {gate.version} · {url}
                    </span>
                  )}
                </p>
              </div>

              {platform.kind === 'tauri' && <DeviceCard />}

              <form className={styles.fields} onSubmit={submit}>
                <TextField
                  label="Username"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
                <TextField
                  label="Password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                {login.isError && (
                  <div className={styles.error} role="alert">
                    <Icon name="error" size={18} />
                    {describeLoginError(login.error)}
                  </div>
                )}
                <Button type="submit" size="lg" block disabled={login.isPending}>
                  {login.isPending ? 'Signing in…' : 'Sign in'}
                </Button>
              </form>

              {import.meta.env.DEV && (
                <div className={styles.demo}>
                  <div className={styles.demoTitle}>Demo accounts · choose a role</div>
                  <div className={styles.demoGrid}>
                    {DEV_ACCOUNTS.map((a) => (
                      <button
                        key={a.email}
                        type="button"
                        className={styles.demoBtn}
                        data-selected={username === a.email}
                        onClick={() => {
                          setUsername(a.email);
                          setPassword('demo');
                        }}
                      >
                        <span className={styles.demoShort}>{a.short}</span>
                        <span className={styles.demoUser}>{a.user}</span>
                      </button>
                    ))}
                  </div>
                  <span className={styles.demoNote}>
                    Mock Brain only · fake data · password “demo”
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function describeLoginError(e: unknown): string {
  return isUnauthorized(e) ? 'Wrong username or password.' : describeError(e);
}
