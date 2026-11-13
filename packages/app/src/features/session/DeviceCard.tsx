import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiError } from '@lefi/platform';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { Badge, Button, Icon } from '../../shared/ui';
import styles from './session.module.css';

/** This PC's pairing with Lefi Brain (Tauri only). Pairing itself happens before sign-in. */
export function DeviceCard() {
  const platform = usePlatform();
  const device = useQuery({ queryKey: ['platform', 'device'], queryFn: () => platform.device() });
  if (!device.data) return null;
  return (
    <div className={styles.device}>
      <Icon name="verified_user" size={20} color="var(--lefi-ok-fg)" />
      <div className={styles.deviceText}>
        <b>This PC is paired with Lefi Brain</b>
        <span className={styles.mono}>{device.data.deviceId}</span>
      </div>
      <Badge tone="ok" variant="tag">
        mTLS
      </Badge>
    </div>
  );
}

/** Why Lefi Brain refused this PC, from `error.details.reason` (ADR-056). */
export type RefusalReason =
  | 'revoked'
  | 'replaced'
  | 'expired'
  | 'no_certificate'
  | 'unknown_certificate'
  | 'not_through_gateway'
  | 'unknown';

function refusalReason(error: ApiError): RefusalReason {
  const r = error.details.reason;
  switch (r) {
    case 'revoked':
    case 'replaced':
    case 'expired':
    case 'no_certificate':
    case 'unknown_certificate':
    case 'not_through_gateway':
      return r;
    default:
      return 'unknown';
  }
}

interface RefusalCopy {
  title: string;
  body: ReactNode;
  steps: ReactNode[];
  /** Forgetting the pairing fixes it (the PC pairs again by itself). */
  forget: boolean;
}

function formatWhen(iso: unknown): string | null {
  if (typeof iso !== 'string') return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}

function refusalCopy(reason: RefusalReason, error: ApiError, paired: boolean): RefusalCopy {
  const when = formatWhen(error.details.revoked_at);
  const ended = formatWhen(error.details.expires_at);
  const why = typeof error.details.revoked_reason === 'string' ? error.details.revoked_reason : '';
  switch (reason) {
    case 'revoked':
      return {
        title: 'An administrator removed this PC from Lefi Brain',
        body: (
          <>
            Its pairing was revoked{when ? ` on ${when}` : ''}
            {why ? ` (“${why}”)` : ''}.
          </>
        ),
        steps: [
          'Forget this pairing. When this PC is part of your installation, Lefi Crop Helper connects it again by itself.',
          'If it was removed on purpose, ask your Lefi Crop administrator before connecting it again.',
        ],
        forget: true,
      };
    case 'replaced':
      return {
        title: 'This PC was paired again',
        body: (
          <>
            Lefi Brain now uses a newer pairing of this same PC
            {when ? ` (since ${when})` : ''}, and Lefi Desktop still holds the older one. Nobody
            removed this PC.
          </>
        ),
        steps: [
          'Forget this pairing: Lefi Desktop then uses the new one, or pairs again by itself.',
        ],
        forget: true,
      };
    case 'expired':
      return {
        title: "This PC's certificate has ended",
        body: <>Its certificate was valid until {ended ?? 'a date that has passed'}.</>,
        steps: ['Forget this pairing. Lefi Crop Helper connects this PC again with a new one.'],
        forget: true,
      };
    case 'no_certificate':
      return paired
        ? {
            title: 'Lefi Gateway did not ask this PC for its certificate',
            body: 'This PC is paired, but its certificate did not reach Lefi Brain. Nobody removed this PC, and forgetting the pairing will not fix this.',
            steps: [
              <>
                This usually means Lefi Gateway on the main PC was set up by Lefi Crop Helper 0.5.0
                or older, which asked for the certificate only by name, not by address. On the main
                PC, open <b>Lefi Crop Helper → Change what this PC runs</b> and run setup again.
              </>,
              <>
                Technicians, on the main PC:{' '}
                <code>grep -n &apos;:8443&apos; ~/.lefi-crop/caddy/Caddyfile</code> must list{' '}
                <code>https://:8443</code>.
              </>,
            ],
            forget: false,
          }
        : {
            title: 'This PC is not paired with Lefi Brain',
            body: 'Lefi Brain only accepts PCs that are paired.',
            steps: [
              'When this PC is part of your installation, Lefi Crop Helper connects it by itself within a minute.',
            ],
            forget: false,
          };
    case 'unknown_certificate':
      return {
        title: 'Lefi Brain does not know this PC',
        body: 'This PC sent its certificate, but Lefi Brain has no record of it. Lefi Brain was probably installed again or its database replaced, or this address is another installation.',
        steps: [
          'Forget this pairing. When this PC is part of your installation, Lefi Crop Helper connects it again by itself.',
        ],
        forget: true,
      };
    case 'not_through_gateway':
      return {
        title: 'This PC reached Lefi Brain without Lefi Gateway',
        body: 'Lefi Brain only accepts other PCs through Lefi Gateway (HTTPS, port 8443). The address this PC uses goes to Lefi Brain directly.',
        steps: [
          'Forget this pairing so this PC uses the address Lefi Crop Helper gives it.',
          'Technicians: LEFI_BRAIN_URL on this PC, if set, must be the gateway address.',
        ],
        forget: true,
      };
    default:
      return {
        title: 'Lefi Brain refused this PC',
        body: 'An administrator may have removed this PC, its certificate may have ended, or Lefi Gateway did not send it. This Lefi Brain is too old to say which.',
        steps: [
          'Forget this pairing. When this PC is part of your installation, Lefi Crop Helper connects it again by itself.',
        ],
        forget: true,
      };
  }
}

/**
 * Lefi Brain refused this PC itself (not the person). Says exactly why, from Lefi Brain's answer,
 * and what fixes it. Nothing is sent until it is fixed.
 */
export function DeviceRevokedPanel({
  error,
  url,
  onRecovered,
}: {
  error: ApiError;
  url?: string | undefined;
  onRecovered?: () => void;
}) {
  const platform = usePlatform();
  const qc = useQueryClient();
  // Lefi Crop Helper's "Reset pairing on this PC" gives this PC a new pairing by itself: as soon as
  // it is a different one, go back to sign-in without asking anyone to click.
  const device = useQuery({
    queryKey: ['platform', 'device', 'watch'],
    queryFn: () => platform.device(),
    refetchInterval: 5_000,
  });
  const [first, setFirst] = useState<string | null | undefined>(undefined);
  const current = device.isSuccess ? (device.data?.deviceId ?? null) : undefined;
  if (first === undefined && current !== undefined) setFirst(current);
  const renewed =
    first !== undefined && current !== undefined && current !== null && current !== first;
  useEffect(() => {
    if (renewed) {
      onRecovered?.();
      void qc.resetQueries();
    }
  }, [renewed, onRecovered, qc]);
  const forget = useMutation({
    mutationFn: () => platform.forgetPairing(),
    onSuccess: () => qc.resetQueries(),
  });
  const reason = refusalReason(error);
  const c = refusalCopy(reason, error, current != null);
  const deviceId =
    typeof error.details.device_id === 'string' ? error.details.device_id : (current ?? null);
  return (
    <section className={styles.brainState} aria-labelledby="device-revoked-title">
      <div className={styles.heading}>
        <h2 id="device-revoked-title">{c.title}</h2>
        <p>{c.body}</p>
      </div>
      <div className={styles.brainSteps}>
        <h3>What to do</h3>
        <ol>
          {c.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </div>
      {forget.isError && (
        <div className={styles.error} role="alert">
          <Icon name="error" size={18} />
          {describeError(forget.error)}
        </div>
      )}
      {c.forget ? (
        <Button onClick={() => forget.mutate()} disabled={forget.isPending}>
          Forget this pairing
        </Button>
      ) : (
        <Button
          variant="secondary"
          onClick={() => {
            onRecovered?.();
            void qc.resetQueries();
          }}
        >
          <Icon name="refresh" size={18} /> Check again
        </Button>
      )}
      <div className={styles.brainUrl} data-testid="refusal-details">
        Lefi Brain answered {error.code ?? error.status}
        {reason !== 'unknown' ? ` · ${reason}` : ''}
        {deviceId ? ` · device ${deviceId}` : ''}
        {url ? ` · ${url}` : ''}
      </div>
    </section>
  );
}
