import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { live, liveKeys, type BoardLogLine } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { Button, Select } from '../../shared/ui';
import styles from './live.module.css';

const LEVELS: BoardLogLine['level'][] = ['debug', 'info', 'warn', 'error'];

function uptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * What the board prints on its Serial Monitor, sent to Lefi Brain (ADR-060). Last 500 lines Lefi
 * Brain received since it started; refreshed every 3 s while open. For looking inside a board, not
 * a record: nothing decides anything from these lines.
 */
export function BoardLog({ id }: { id: string }) {
  const platform = usePlatform();
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<BoardLogLine['level']>('info');
  const box = useRef<HTMLPreElement>(null);
  const logs = useQuery({
    queryKey: liveKeys.deviceLogs(id, level),
    queryFn: () => live.deviceLogs(platform, id, level),
    enabled: open,
    refetchInterval: open ? 3000 : false,
  });
  const lines = logs.data ?? [];
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines.length]);
  return (
    <div>
      <div className={styles.sectionHead}>
        <h3>Board log</h3>
        <span className={styles.assign}>
          {open && (
            <Select
              aria-label="Lowest level shown"
              value={level}
              onChange={(e) => setLevel(e.target.value as BoardLogLine['level'])}
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l} and above
                </option>
              ))}
            </Select>
          )}
          <Button size="sm" variant="secondary" icon="terminal" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide' : 'Show board log'}
          </Button>
        </span>
      </div>
      {open &&
        (lines.length === 0 ? (
          <p className={styles.muted}>
            {logs.isPending
              ? 'Loading…'
              : 'Nothing received. The board sends its log only if its firmware has remote logging on; otherwise use the Serial Monitor (115200).'}
          </p>
        ) : (
          <pre ref={box} className={styles.boardLog} aria-label="Board log">
            {lines.map((l) => (
              <div key={l.id} data-level={l.level}>
                {l.dropped_before > 0 && (
                  <span className={styles.muted}>
                    … {l.dropped_before} line(s) lost …{'\n'}
                  </span>
                )}
                [{uptime(l.uptime_ms)}] {l.level.toUpperCase().padEnd(5)}{' '}
                {l.tag ? `${l.tag}: ` : ''}
                {l.msg}
              </div>
            ))}
          </pre>
        ))}
    </div>
  );
}
