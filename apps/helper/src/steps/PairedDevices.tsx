import { useCallback, useEffect, useState } from 'react';
import { asSetupError, type SetupError } from '../api';
import {
  devicesApi,
  type PairedDevice,
  type PairedDevices as Devices,
  type PairingCode,
} from '../console';
import { Badge, Banner, ErrorBox, Icon } from '../ui';
import { AdminFields, useAdminAuth } from './AdminFields';
import { localState, isThisPc, LOCAL_TEXT } from './pairing';

/**
 * Lefi Desktop PCs paired with Lefi Brain (ADR-048, ADR-055). Pairing is automatic on every PC of
 * the installation: this card says how it went, offers one "Connect again", and lists the other
 * PCs (one entry per PC) with Revoke. A code is only for a PC that never joined (Advanced).
 */
export function PairedDevices() {
  const admin = useAdminAuth();
  const [data, setData] = useState<Devices | null>(null);
  const [code, setCode] = useState<PairingCode | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [error, setErrorState] = useState<SetupError | null>(null);
  const setError = (e: unknown) => setErrorState(asSetupError(e));

  const refresh = useCallback(() => {
    devicesApi.list().then(setData, setError);
  }, []);
  useEffect(refresh, [refresh]);

  const state = data ? localState(data) : 'not_installed';
  // While this PC's Lefi Desktop is connecting, follow it.
  useEffect(() => {
    if (state !== 'connecting' && state !== 'retrying') return;
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [state, refresh]);

  if (!data || !data.available) return null;
  const mine = (d: PairedDevice) => isThisPc(d, data);
  const active = data.devices.filter((d) => d.status === 'active');
  const others = active.filter((d) => !mine(d));
  const removed = data.devices.filter((d) => d.status !== 'active' && !mine(d));
  // Revoking the pairing this PC uses needs the administrator; replacing a broken one does not.
  const needsAdmin = active.some(mine);
  const local = LOCAL_TEXT[state];

  const reconnect = () => {
    setBusy(true);
    setErrorState(null);
    devicesApi
      .resetLocal(needsAdmin ? admin.auth : null)
      .then((r) => {
        admin.clear();
        setReconnecting(false);
        setNote(
          r.offered
            ? 'Lefi Desktop on this PC connects again by itself within a few seconds.'
            : 'Lefi Desktop is not installed on this PC.',
        );
        refresh();
      }, setError)
      .finally(() => setBusy(false));
  };

  return (
    <div className="card">
      <h2 className="card-title">
        <Icon name="devices" /> Lefi Desktop connections
      </h2>
      {error ? <ErrorBox error={error} title="Not done" /> : null}
      {!data.gateway_requires_device ? (
        <Banner tone="info" icon="info">
          Lefi Gateway does not ask for device certificates yet. Run “Change what this PC runs” with
          Lefi Gateway over HTTPS.
        </Banner>
      ) : null}

      <div className="pair-local">
        <div>
          <strong>This PC</strong> <Badge tone={local.tone}>{local.label}</Badge>
          <p className="muted">{local.text}</p>
          {data.local_status && (state === 'retrying' || state === 'failed') ? (
            <p className="muted">
              Last attempt {new Date(data.local_status.at * 1000).toLocaleTimeString()}:{' '}
              {data.local_status.message}
            </p>
          ) : null}
        </div>
        {state !== 'not_installed' && state !== 'connecting' ? (
          <button type="button" className="btn" onClick={() => setReconnecting(true)}>
            <Icon name="sync" /> Connect again
          </button>
        ) : null}
      </div>
      {reconnecting ? (
        <div className="confirm" role="alertdialog">
          <p>
            <strong>Connect Lefi Desktop on this PC again?</strong> Its current pairing is replaced
            and a new one is made by itself within a few seconds. People signed in on this PC sign
            in again.
          </p>
          {needsAdmin ? <AdminFields a={admin} /> : null}
          <div className="row-end">
            <button type="button" className="btn" onClick={() => setReconnecting(false)}>
              Back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || (needsAdmin && !admin.ready)}
              onClick={reconnect}
            >
              Connect again
            </button>
          </div>
        </div>
      ) : null}
      {note ? <p className="muted">{note}</p> : null}

      <h3 className="details-title">Other PCs</h3>
      {others.length ? (
        <ul className="list">
          {others.map((d) => (
            <li key={d.id} className="list-row">
              <div>
                <strong>{d.name}</strong> <Badge tone="ok">Connected</Badge>
                <div className="muted">
                  last seen {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : 'never'}
                </div>
              </div>
              {revoking === d.id ? (
                <div className="confirm" role="alertdialog">
                  <p>
                    <strong>Revoke {d.name}?</strong> That PC can no longer reach Lefi Brain until
                    it is connected again.
                  </p>
                  <AdminFields a={admin} />
                  <div className="row-end">
                    <button type="button" className="btn" onClick={() => setRevoking(null)}>
                      Back
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={!admin.ready}
                      onClick={() =>
                        devicesApi.revoke(d.id, admin.auth).then(() => {
                          admin.clear();
                          setRevoking(null);
                          refresh();
                        }, setError)
                      }
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn" onClick={() => setRevoking(d.id)}>
                  <Icon name="block" /> Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          No other PC is connected. A PC that joins in Nodes and has Lefi Desktop connects by
          itself.
        </p>
      )}
      {showRemoved && removed.length ? (
        <ul className="list">
          {removed.map((d) => (
            <li key={d.id} className="list-row">
              <div>
                <strong>{d.name}</strong> <Badge tone="off">Revoked</Badge>
                <div className="muted">{d.revoked_reason ?? ''}</div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="row-end">
        {removed.length ? (
          <button type="button" className="btn" onClick={() => setShowRemoved((v) => !v)}>
            {showRemoved ? 'Hide revoked' : `Show ${removed.length} revoked`}
          </button>
        ) : null}
        <button type="button" className="btn" onClick={() => setAdvanced((v) => !v)}>
          <Icon name="key" /> Advanced: a PC outside the installation
        </button>
      </div>
      {advanced ? (
        <div className="confirm">
          <p className="muted">
            Only for a Lefi Desktop copied to a PC that never joined in Nodes: create a code and
            type it there under “Advanced: pair with a code”. It works once, for 10 minutes.
          </p>
          {code ? (
            <Banner tone="ok" icon="key">
              <strong className="mono">{code.code}</strong> — until{' '}
              {new Date(code.expires_at).toLocaleTimeString()}
              {code.url ? <p className="muted">Main PC address: {code.url}</p> : null}
            </Banner>
          ) : null}
          <div className="row-end">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => devicesApi.newCode().then(setCode, setError)}
            >
              Create a pairing code
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
