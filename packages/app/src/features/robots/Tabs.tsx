import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queries, type RobotLive } from '@lefi/api';
import { mascots, toneVars } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { Badge, DataTable, Icon, Skeleton, type Column } from '../../shared/ui';
import { CameraCard } from './LiveCards';
import { stateTone } from './presentation';
import styles from './robots.module.css';

const Pill = ({ state }: { state: string }) => {
  const t = toneVars(stateTone(state));
  return (
    <span className={styles.pill} style={{ background: t.bg, color: t.fg }}>
      {state}
    </span>
  );
};

export function HistoryTab({ initial }: { initial?: string | undefined }) {
  const platform = usePlatform();
  const list = useQuery(queries.missions(platform));
  const [sel, setSel] = useState<string | undefined>(initial);
  const current = sel ?? list.data?.[0]?.id;
  return (
    <div className={styles.historyLayout}>
      <div className={styles.historyList}>
        {list.isPending && <Skeleton height={300} />}
        {list.data?.map((m) => (
          <button
            key={m.id}
            type="button"
            className={styles.historyItem}
            aria-pressed={m.id === current}
            onClick={() => setSel(m.id)}
          >
            <div className={styles.rowBetween}>
              <span className={styles.mono}>
                {m.id} · {m.start}
              </span>
              <Pill state={m.state} />
            </div>
            <b>{m.title}</b>
            <span className={styles.faint}>{m.origin}</span>
          </button>
        ))}
      </div>
      {current && <MissionDetailView key={current} id={current} />}
    </div>
  );
}

function MissionDetailView({ id }: { id: string }) {
  const q = useQuery(queries.mission(usePlatform(), id));
  if (q.isPending) return <Skeleton height={400} />;
  if (q.isError) return <span className={styles.muted}>{describeError(q.error)}</span>;
  const m = q.data;
  return (
    <div className={styles.detail}>
      <section className={styles.detailHead}>
        <div className={styles.stack}>
          <span className={styles.mono}>
            {m.id} · {m.origin}
          </span>
          <span className={styles.detailTitle}>{m.title}</span>
          <span className={styles.muted}>
            Target {m.target} · {m.start} → {m.end}
          </span>
        </div>
        <Pill state={m.state} />
      </section>
      <div className={styles.facts}>
        <div>
          <span>Distance travelled</span>
          <b>{m.distance}</b>
        </div>
        <div>
          <span>Photos captured</span>
          <b>{m.photos.toLocaleString('en-CA')}</b>
        </div>
        <div>
          <span>Robot</span>
          <b>{m.robot}</b>
        </div>
        <div className={styles.adapter}>
          <span>Execution adapter</span>
          <b>{m.adapter}</b>
        </div>
      </div>
      <div className={styles.twoCards}>
        <section className={styles.card}>
          <span className={styles.cardTitle}>State transitions</span>
          {m.log.map((l, i) => (
            <div key={i} className={styles.logRow}>
              <span className={styles.mono}>{l.time}</span>
              <Pill state={l.state} />
              <span>{l.note}</span>
            </div>
          ))}
        </section>
        <div className={styles.stack16}>
          <section className={styles.card}>
            <span className={styles.cardTitle}>Authorisation &amp; mission policy</span>
            {m.checks.map((c) => (
              <span key={c.label} className={styles.check}>
                <Icon
                  name={c.passed ? 'check_circle' : 'cancel'}
                  size={17}
                  color={c.passed ? 'var(--lefi-green-500)' : 'var(--lefi-crit-fg)'}
                />
                {c.label}
              </span>
            ))}
          </section>
          <section className={`${styles.card} ${styles.summaryPlain}`}>
            <span className={styles.eyebrow} style={{ color: 'var(--lefi-forest-600)' }}>
              AI mission summary{' '}
              {m.summary.simulated && (
                <Badge tone="sim" variant="tag">
                  Simulated
                </Badge>
              )}
            </span>
            <span className={styles.body}>{m.summary.text}</span>
          </section>
          {m.photo_labels.length > 0 && (
            <section className={styles.card}>
              <div className={styles.photoGrid}>
                {m.photo_labels.map((p) => (
                  <div key={p} className={styles.photoLight}>
                    <span>{p}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export function ViewerTab({ live }: { live: RobotLive }) {
  return (
    <div className={styles.viewer}>
      <CameraCard live={live} large />
      <section className={`${styles.card} ${styles.summary}`}>
        <img src={mascots.curious} alt="" />
        <span className={styles.body}>
          Simulated camera: there is no real video or image. Frames and photos are placeholders from
          the sim-mh3 driver; a hardware adapter would replace them without changing this screen.
        </span>
      </section>
    </div>
  );
}

type Cmd = RobotLive['commands'][number];
const COLS: Column<Cmd>[] = [
  {
    key: 't',
    header: 'Time',
    width: '70px',
    render: (c) => <span className={styles.mono}>{c.time}</span>,
  },
  {
    key: 'cmd',
    header: 'User command',
    width: '1.4fr',
    render: (c) => (
      <div className={styles.stack}>
        <b>“{c.text}”</b>
        <span className={styles.faint}>
          {c.who} · {c.via}
        </span>
      </div>
    ),
  },
  {
    key: 'int',
    header: 'Interpretation',
    width: '1.2fr',
    render: (c) => (
      <div className={styles.stack}>
        <span className={styles.mono}>{c.intent}</span>
        <span className={styles.faint}>{c.parser}</span>
      </div>
    ),
  },
  { key: 'act', header: 'Intended action', width: '1.1fr', render: (c) => c.label },
  {
    key: 'auth',
    header: 'Authorisation',
    width: '1fr',
    render: (c) => (
      <b
        style={{
          color:
            c.auth === 'denied'
              ? 'var(--lefi-crit-fg)'
              : c.auth === 'allowed'
                ? 'var(--lefi-ok-fg)'
                : 'var(--lefi-text-muted)',
        }}
      >
        {c.auth === 'n/a' ? '—' : c.auth === 'allowed' ? 'Authorised' : 'Denied'}
      </b>
    ),
  },
  {
    key: 'exec',
    header: 'Execution',
    width: '1fr',
    render: (c) => (
      <Pill
        state={c.exec === 'Executed' ? 'Completed' : c.exec === 'Paused' ? 'Paused' : 'Failed'}
      />
    ),
  },
  { key: 'res', header: 'Result', width: '1.8fr', render: (c) => c.result },
];

export function LogTab({ live }: { live: RobotLive }) {
  return (
    <DataTable
      label="Command log"
      columns={COLS}
      rows={live.commands}
      rowKey={(c) => String(c.id)}
      minWidth={1000}
    >
      {live.commands.length === 0 && (
        <div className={styles.none}>
          No commands yet. Use “Talk to LEFI-R1” or the supervisor controls on Live operations.
        </div>
      )}
    </DataTable>
  );
}
