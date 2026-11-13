import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { Button, Icon, TextField } from '../../shared/ui';
import styles from './session.module.css';

/**
 * Pairs this PC with Lefi Brain using a one-time code created in Lefi Crop Helper (ADR-048).
 * The code is checked by Lefi Brain; this form only collects it. With `url` unset (Advanced), the
 * person types the main PC's address.
 */
export function PairForm({ url, onCancel }: { url?: string; onCancel?: () => void }) {
  // The address can always be corrected here (Advanced).
  const platform = usePlatform();
  const qc = useQueryClient();
  const [address, setAddress] = useState(url ?? '');
  const [code, setCode] = useState('');
  const pair = useMutation({
    mutationFn: () => platform.pair(address.trim(), code.trim()),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['platform'] });
      await qc.invalidateQueries({ queryKey: ['brain'] });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    pair.mutate();
  }

  return (
    <form className={styles.pairForm} onSubmit={submit} aria-label="Pair this PC">
      <strong>Pair this PC with a code</strong>
      <span className={styles.foundNote}>
        Only for a Lefi Desktop that is not part of the installation. On the main PC: Lefi Crop
        Helper → Apps → “Pairing code for another PC”. It works once, for 10 minutes.
      </span>
      <TextField
        label="Main PC address"
        placeholder="https://lefi-main.local:8443"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        required
      />
      <TextField
        label="Pairing code"
        placeholder="XXXX-XXXX-XXXX"
        autoComplete="off"
        spellCheck={false}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        required
      />
      {pair.isError && (
        <div className={styles.error} role="alert">
          <Icon name="error" size={18} />
          {describeError(pair.error)}
        </div>
      )}
      <div className={styles.pairRow}>
        <Button type="submit" disabled={pair.isPending || !code.trim() || !address.trim()}>
          {pair.isPending ? 'Pairing…' : 'Pair this PC'}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
