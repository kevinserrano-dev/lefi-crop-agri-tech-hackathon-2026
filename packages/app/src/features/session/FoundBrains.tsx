import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FoundBrain } from '@lefi/platform';
import { usePlatform } from '../../platform/PlatformContext';
import { Badge, Button, Icon } from '../../shared/ui';
import styles from './session.module.css';

const SEARCH_EVERY_MS = 10_000;

const STATE: Record<FoundBrain['state'], { label: string; tone: 'ok' | 'warn' | 'crit' | 'off' }> =
  {
    on: { label: 'On', tone: 'ok' },
    brain_down: { label: 'Service stopped', tone: 'crit' },
    not_answering: { label: 'Not answering', tone: 'off' },
    not_a_brain: { label: 'Not a Lefi Brain', tone: 'warn' },
  };

/**
 * What answers as Lefi Brain on this network (ADR-047). Shown while this PC is not paired.
 * Untrusted by design: it only says whether something is there and on; pairing decides trust.
 */
export function FoundBrains({ onPair }: { onPair: (url: string) => void }) {
  const platform = usePlatform();
  const found = useQuery({
    queryKey: ['platform', 'find-brains'],
    queryFn: () => platform.findBrains(),
    refetchInterval: SEARCH_EVERY_MS,
    retry: false,
  });

  // mDNS answers come and go: keep the last list until two searches in a row find nothing, so the
  // page does not jump between "found" and "not found" every few seconds.
  const [kept, setKept] = useState<{ list: FoundBrain[]; misses: number; at: number }>({
    list: [],
    misses: 0,
    at: 0,
  });
  const at = found.dataUpdatedAt;
  if (found.data && at !== kept.at) {
    const misses = found.data.length > 0 ? 0 : kept.misses + 1;
    const list = found.data.length > 0 ? found.data : misses >= 2 ? [] : kept.list;
    setKept({ list, misses, at });
  }
  const firstOn = kept.list.find((b) => b.state === 'on')?.url ?? '';
  // Last resort for a Lefi Desktop that is not part of the installation (copied by hand).
  const advanced = (
    <Button variant="link" size="sm" type="button" onClick={() => onPair(firstOn)}>
      Advanced: pair with a code from Lefi Crop Helper
    </Button>
  );
  if (found.isPending) {
    return (
      <div className={styles.found} role="status">
        <Icon name="travel_explore" size={18} /> Looking for Lefi Brain on this network…
      </div>
    );
  }
  const list = kept.list;
  if (list.length === 0) {
    return (
      <div className={styles.found} role="status">
        <strong>No Lefi Brain found on this network.</strong>
        <ul>
          <li>This PC is on the same network (Wi-Fi) as the main PC.</li>
          <li>The main PC is on, and Lefi Crop Helper finished its setup with Lefi Gateway.</li>
        </ul>
        <span className={styles.foundNote}>Searching again every few seconds.</span>
        {advanced}
      </div>
    );
  }
  return (
    <div className={styles.found} role="status">
      <strong>Found on this network</strong>
      <ul>
        {list.map((b) => (
          <li key={b.url}>
            <Badge tone={STATE[b.state].tone}>{STATE[b.state].label}</Badge> Lefi Brain
            {b.version ? ` ${b.version}` : ''} ·{' '}
            <span className={styles.brainUrl}>{b.url}</span>{' '}
          </li>
        ))}
      </ul>
      <span className={styles.foundNote}>
        Waiting for Lefi Crop Helper to connect this PC. Nothing is trusted until then: any computer
        could use this name.
      </span>
      {advanced}
    </div>
  );
}
