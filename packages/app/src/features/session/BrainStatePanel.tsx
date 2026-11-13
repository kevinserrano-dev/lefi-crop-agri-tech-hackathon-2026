import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePlatform } from '../../platform/PlatformContext';
import { Button, Icon } from '../../shared/ui';
import type { BrainGate } from './brainGate';
import { FoundBrains } from './FoundBrains';
import styles from './session.module.css';

type Blocked = Exclude<BrainGate['kind'], 'ready' | 'checking'>;

interface Copy {
  title: string;
  body: string;
  stepsTitle: string;
  steps: ReactNode[];
}

const SERVICES_CHECK = (
  <>
    The Lefi Crop services are running on the main PC. Technicians: <code>lefi status</code>.
  </>
);

const COPY: Record<Blocked, Copy> = {
  not_set_up: {
    title: 'Connecting this PC to Lefi Brain',
    body: 'When this PC is part of your installation, Lefi Crop Helper connects it to Lefi Brain by itself. Then you only sign in with your username and password.',
    stepsTitle: 'If it does not connect within a minute',
    steps: [
      <>
        On the main PC, <b>Lefi Crop Helper → Nodes</b> lists this PC, and Lefi Desktop was
        installed from there (or on the main PC itself).
      </>,
      'The main PC is on, and this PC is on the same network.',
    ],
  },
  unreachable: {
    title: 'Lefi Brain is not answering',
    body: 'You can sign in as soon as it answers. Nothing on this PC needs to change.',
    stepsTitle: 'What to check',
    steps: [
      'The main PC is turned on and not asleep.',
      'This PC is on the same network as the main PC.',
      SERVICES_CHECK,
    ],
  },
  brain_down: {
    title: 'Lefi Brain service is not running',
    body: 'The main PC answers, but Lefi Brain behind it does not. You can sign in as soon as it is running again.',
    stepsTitle: 'What to do on the main PC',
    steps: [
      SERVICES_CHECK,
      <>
        Technicians: <code>lefi start brain</code>, then <code>lefi logs brain</code> if it stops
        again.
      </>,
    ],
  },
  not_allowed: {
    title: 'This PC is not allowed to connect',
    body: 'Lefi Brain refused this PC. It may not be paired yet, or it was removed by an administrator.',
    stepsTitle: 'What to do',
    steps: ['Ask your Lefi Crop administrator to allow this PC.'],
  },
  not_a_brain: {
    title: 'That address is not a Lefi Brain',
    body: 'Something answers at this address, but it is not Lefi Brain.',
    stepsTitle: 'What to do',
    steps: ['Ask your Lefi Crop administrator for the address of the main PC.'],
  },
};

/** Shown instead of the sign-in form while this PC cannot reach a working Brain. */
export function BrainStatePanel({
  kind,
  url,
  checking,
  onRetry,
  onPair,
}: {
  kind: Blocked;
  url: string | undefined;
  checking: boolean;
  onRetry: () => void;
  onPair: (url: string) => void;
}) {
  const c = COPY[kind];
  return (
    <section className={styles.brainState} aria-labelledby="brain-state-title">
      <div className={styles.heading}>
        <h2 id="brain-state-title">{c.title}</h2>
        <p>{c.body}</p>
      </div>
      {kind === 'not_set_up' && <PairingAttempt />}
      {kind === 'not_set_up' && <FoundBrains onPair={onPair} />}
      <div className={styles.brainSteps}>
        <h3>{c.stepsTitle}</h3>
        <ol>
          {c.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </div>
      {import.meta.env.DEV && (
        <p className={styles.brainDevHint}>
          Development: start the mock Brain with <code>pnpm --filter @lefi/mock-brain start</code>.
        </p>
      )}
      <div className={styles.brainActions} role="status">
        <Button
          variant="secondary"
          type="button"
          onClick={onRetry}
          disabled={checking}
          aria-busy={checking}
        >
          <Icon name="refresh" size={18} /> Check now
        </Button>
        <span>Checking by itself every few seconds. Sign-in appears when Lefi Brain answers.</span>
      </div>
      {url && <div className={styles.brainUrl}>Lefi Brain address: {url}</div>}
    </section>
  );
}

/** What the automatic pairing is doing on this PC, so nobody waits without knowing (ADR-055). */
export function PairingAttempt() {
  const platform = usePlatform();
  const q = useQuery({
    queryKey: ['platform', 'pairing-status'],
    queryFn: () => platform.pairingStatus(),
    refetchInterval: 3_000,
  });
  const st = q.data?.status;
  if (!q.data || (!st && !q.data.offer_waiting)) return null;
  const state = st?.state ?? 'pairing';
  const title =
    state === 'retrying'
      ? 'Lefi Brain did not answer yet — trying again by itself'
      : state === 'failed'
        ? 'The last pairing attempt failed'
        : state === 'paired'
          ? 'Paired with Lefi Brain'
          : 'Pairing this PC with Lefi Brain…';
  return (
    <div className={styles.brainUrl} role="status" data-state={state}>
      <b>{title}</b>
      {st && state !== 'pairing' && state !== 'paired' ? (
        <div>
          {new Date(st.at * 1000).toLocaleTimeString()}: {st.message}
        </div>
      ) : null}
      {state === 'failed' ? (
        <div>
          Lefi Crop Helper sends a new pairing by itself; on the main PC, Apps → Connect again does
          it now.
        </div>
      ) : null}
    </div>
  );
}
