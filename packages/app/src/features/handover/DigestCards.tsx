import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { queries, type Handover, type HandoverHighlight, type Incident } from '@lefi/api';
import { toneVars, type Tone } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { SEVERITY, STATUS_TONE as INCIDENT_TONE } from '../incidents/tones';
import { stateTone } from '../robots/presentation';
import { STATUS_TONE as TASK_TONE } from '../tasks/presentation';
import { Icon, Skeleton } from '../../shared/ui';
import styles from './handover.module.css';

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const t = toneVars(tone);
  return (
    <span className={styles.pill} style={{ background: t.bg, color: t.fg }}>
      {children}
    </span>
  );
}

function DigestCard({
  title,
  empty,
  children,
}: {
  title: string;
  empty?: string | false;
  children: ReactNode;
}) {
  return (
    <section className={styles.card}>
      <span className={styles.cardTitle}>{title}</span>
      {empty ? <span className={styles.faint}>{empty}</span> : children}
    </section>
  );
}

function Highlights({ title, rows }: { title: string; rows: HandoverHighlight[] }) {
  return (
    <DigestCard title={title} empty={rows.length === 0 && 'Nothing recorded this shift.'}>
      {rows.map((r) => (
        <div key={r.label} className={styles.kv}>
          <span className={styles.kvLabel}>{r.label}</span>
          <b style={{ color: toneVars(r.tone).fg }}>{r.value}</b>
        </div>
      ))}
    </DigestCard>
  );
}

function IncidentRows({ rows, dot }: { rows: Incident[]; dot?: boolean }) {
  const navigate = useNavigate();
  return rows.map((i) => (
    <button
      key={i.id}
      type="button"
      className={styles.row}
      onClick={() => void navigate({ to: '/alerts', search: { incident: i.id } })}
    >
      {dot && (
        <span
          className={styles.dot}
          style={{ background: toneVars(SEVERITY[i.severity].tone).dot }}
        />
      )}
      <span className={styles.mono}>{i.id}</span>
      <span className={styles.rowTitle}>{i.title}</span>
      <Pill tone={INCIDENT_TONE[i.status]}>{i.status}</Pill>
    </button>
  ));
}

/**
 * The handover's evidence. Incidents, tasks and inspections are the live lists from their own
 * endpoints (so they match those screens); highlights and missions come with the handover.
 */
export function DigestCards({ h }: { h: Handover }) {
  const platform = usePlatform();
  const incidents = useQuery(queries.incidents(platform, {}));
  const tasks = useQuery(queries.tasks(platform, 'pending'));
  const inspections = useQuery(queries.detections(platform, 'awaiting'));
  const active = incidents.data?.filter((i) => i.status !== 'Resolved' && i.status !== 'Closed');
  const resolved = incidents.data?.filter((i) => i.status === 'Resolved' || i.status === 'Closed');
  const loading = <Skeleton height={120} />;
  return (
    <div className={styles.cards}>
      <Highlights title="Environmental highlights" rows={h.environment} />
      <Highlights title="Plant health changes" rows={h.plants} />
      <DigestCard title="Active incidents" empty={active?.length === 0 && 'No open incidents.'}>
        {active ? <IncidentRows rows={active} dot /> : loading}
      </DigestCard>
      <DigestCard title="Resolved incidents" empty={resolved?.length === 0 && 'None this shift.'}>
        {resolved ? <IncidentRows rows={resolved} /> : loading}
      </DigestCard>
      <DigestCard
        title="Robot missions performed"
        empty={h.missions.length === 0 && 'No missions this shift.'}
      >
        {h.missions.map((m) => (
          <div key={m.id} className={styles.mission}>
            <div className={styles.missionHead}>
              <span className={styles.mono}>{m.id}</span>
              <b className={styles.rowTitle}>{m.title}</b>
              <Pill tone={stateTone(m.state)}>{m.state}</Pill>
            </div>
            <span className={styles.missionText}>{m.summary}</span>
          </div>
        ))}
      </DigestCard>
      <DigestCard
        title={`Outstanding tasks${tasks.data ? ` · ${tasks.data.length}` : ''}`}
        empty={tasks.data?.length === 0 && 'No outstanding tasks.'}
      >
        {tasks.data
          ? tasks.data.map((t) => (
              <div key={t.id} className={styles.row}>
                <span className={styles.mono}>{t.id}</span>
                <span className={styles.rowTitle}>{t.title}</span>
                <Pill tone={TASK_TONE[t.status]}>{t.status}</Pill>
              </div>
            ))
          : loading}
      </DigestCard>
      <DigestCard
        title="Pending inspections"
        empty={inspections.data?.length === 0 && 'No AI detections awaiting review.'}
      >
        {inspections.data
          ? inspections.data.map((d) => (
              <div
                key={d.id}
                className={styles.row}
                title={d.simulated ? 'Simulated detection' : undefined}
              >
                <Icon name="psychiatry" size={17} className={styles.warn} />
                <span className={styles.rowTitle}>
                  {d.finding} · {d.zone_id}
                </span>
                <span className={styles.mono}>{d.confidence} %</span>
              </div>
            ))
          : loading}
      </DigestCard>
    </div>
  );
}
