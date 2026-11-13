import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { queries, INCIDENT_STEPS, type IncidentDetail as Detail } from '@lefi/api';
import { mascots } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { stamp } from '../../shared/lib/time';
import { ActionButton, Badge, Card, Icon, Skeleton, Stepper, TextArea } from '../../shared/ui';
import { SeverityPill, StatusPill } from './IncidentList';
import { useIncidentActions } from './useIncidentActions';
import styles from './incidents.module.css';

export function IncidentDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const platform = usePlatform();
  const q = useQuery(queries.incident(platform, id));

  return (
    <>
      <button type="button" className={styles.back} onClick={onBack}>
        <Icon name="arrow_back" size={18} />
        All incidents
      </button>
      {q.isPending && <Skeleton height={320} />}
      {q.isError && <span className={styles.muted}>{describeError(q.error)}</span>}
      {q.data && <DetailBody inc={q.data} />}
    </>
  );
}

function DetailBody({ inc }: { inc: Detail }) {
  const { transition, assign } = useIncidentActions(inc.id);
  const people = useQuery(queries.people(usePlatform()));
  const busy = transition.isPending || assign.isPending;
  const step = INCIDENT_STEPS.indexOf(inc.status);

  return (
    <>
      <Card className={styles.headCard}>
        <div className={styles.headRow}>
          <div className={styles.headText}>
            <span className={styles.headMeta}>
              {inc.id} · detected {stamp(inc.detected_at)} · {inc.source.label}
            </span>
            <h2 className={styles.headTitle}>{inc.title}</h2>
            <span className={styles.headSub}>
              {inc.area} · {inc.zone_label} · plant {inc.plant_id ?? '—'}
            </span>
          </div>
          <div className={styles.headPills}>
            {inc.origin === 'SIMULATED' && (
              <Badge tone="sim" variant="tag">
                Simulated
              </Badge>
            )}
            <SeverityPill severity={inc.severity} large />
            <StatusPill status={inc.status} large />
          </div>
        </div>
        <Stepper steps={INCIDENT_STEPS} current={step} />
        <div className={styles.actionsRow}>
          <ActionButton
            label="Acknowledge"
            icon="done"
            availability={inc.actions.acknowledge}
            busy={busy}
            onClick={() => transition.mutate({ action: 'acknowledge' })}
          />
          <ActionButton
            label="Start investigating"
            icon="search_insights"
            availability={inc.actions.investigate}
            busy={busy}
            onClick={() => transition.mutate({ action: 'investigate' })}
          />
          <ActionButton
            label="Close incident"
            icon="archive"
            availability={inc.actions.close}
            busy={busy}
            onClick={() => transition.mutate({ action: 'close' })}
          />
          <div className={styles.grow} />
          <label
            className={styles.owner}
            title={
              inc.actions.assign.allowed ? undefined : (inc.actions.assign.reason ?? undefined)
            }
          >
            Owner
            <select
              value={inc.assignee ?? ''}
              disabled={busy}
              data-locked={!inc.actions.assign.allowed}
              onChange={(e) => assign.mutate(e.target.value)}
            >
              {!inc.assignee && <option value="">Unassigned</option>}
              {people.data?.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <div className={styles.detailGrid}>
        <div className={styles.column}>
          <Card title="Sensor & visual evidence">
            {inc.evidence.map((e) => (
              <div key={e} className={styles.evidence}>
                <Icon name="check_small" size={17} color="var(--lefi-green-400)" />
                {e}
              </div>
            ))}
            {inc.ai_confidence !== null ? (
              <div className={styles.confidence}>
                <span>AI confidence</span>
                <div className={styles.confTrack}>
                  <div style={{ width: `${inc.ai_confidence}%` }} />
                </div>
                <b>{inc.ai_confidence} %</b>
              </div>
            ) : (
              <span className={styles.muted}>
                AI confidence: n/a · {inc.source.kind === 'manual' ? 'manual report' : 'rule-based'}
              </span>
            )}
          </Card>

          {inc.recommendation && (
            <div className={styles.recommendation}>
              <img src={mascots.thinking} alt="" />
              <div>
                <span className={styles.recLabel}>
                  AI recommendation{' '}
                  {inc.recommendation.simulated && (
                    <Badge tone="sim" variant="tag">
                      Simulated
                    </Badge>
                  )}
                </span>
                <span className={styles.recText}>{inc.recommendation.text}</span>
                <span className={styles.recNote}>
                  A recommendation is not an action: nothing runs until someone approves it and the
                  validator authorises it.
                </span>
              </div>
            </div>
          )}

          <Card title="Incident timeline · actions performed">
            {inc.timeline.map((t, i) => (
              <div key={i} className={styles.timeRow}>
                <span className={styles.mono}>{t.time}</span>
                <span>{t.text}</span>
              </div>
            ))}
          </Card>

          <ResolutionCard
            inc={inc}
            busy={busy}
            onResolve={(note) => transition.mutate({ action: 'resolve', note })}
          />
        </div>

        <div className={styles.column}>
          <Card title="Ownership" className={styles.sideCard}>
            <div className={styles.factGrid}>
              <div>
                <span>Responsible</span>
                <b>{inc.assignee ?? 'Unassigned'}</b>
              </div>
              <div>
                <span>Time to acknowledge</span>
                <b>{inc.ack_minutes === null ? '—' : `${inc.ack_minutes} min`}</b>
              </div>
            </div>
          </Card>
          <Card title="Escalation history" className={styles.sideCard}>
            {inc.escalation.length === 0 && (
              <span className={styles.muted}>No escalation recorded.</span>
            )}
            {inc.escalation.map((e, i) => (
              <div key={i} className={styles.sideRow}>
                <span className={styles.mono}>{e.time}</span>
                <div>
                  <b>{e.what}</b>
                  <span className={styles.muted}>{e.state}</span>
                </div>
              </div>
            ))}
          </Card>
          <Card title="Notification delivery log" className={styles.sideCard}>
            {inc.notifications.length === 0 && (
              <span className={styles.muted}>No notifications sent.</span>
            )}
            {inc.notifications.map((n, i) => (
              <div key={i} className={styles.sideRow}>
                <span className={styles.mono}>{n.time}</span>
                <div>
                  <span>
                    <b>{n.channel}</b> → {n.recipient}
                  </span>
                  <b style={{ color: n.ok ? 'var(--lefi-ok-fg)' : 'var(--lefi-warn-fg)' }}>
                    {n.status}
                  </b>
                </div>
              </div>
            ))}
          </Card>
          <MissionsCard missions={inc.missions} />
        </div>
      </div>
    </>
  );
}

function ResolutionCard({
  inc,
  busy,
  onResolve,
}: {
  inc: Detail;
  busy: boolean;
  onResolve: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  const open = !['Resolved', 'Closed'].includes(inc.status);
  return (
    <Card title="Resolution evidence">
      {inc.resolution && (
        <div className={styles.resolved}>
          <Icon name="task_alt" size={19} />
          {inc.resolution}
        </div>
      )}
      {open && (
        <>
          <TextArea
            aria-label="Resolution evidence"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Describe the fix and attach evidence (readings, photos, work order)"
          />
          <ActionButton
            label="Mark resolved"
            icon="task_alt"
            variant="solid"
            availability={inc.actions.resolve}
            busy={busy}
            onClick={() => onResolve(note.trim())}
          />
        </>
      )}
    </Card>
  );
}

function MissionsCard({ missions }: { missions: string[] }) {
  const navigate = useNavigate();
  return (
    <Card title="Related robot missions" className={styles.sideCard}>
      {missions.length === 0 && <span className={styles.muted}>No robot missions linked.</span>}
      {missions.map((m) => (
        <button
          key={m}
          type="button"
          className={styles.mission}
          onClick={() => void navigate({ to: '/robots', search: { tab: 'history', mission: m } })}
        >
          <Icon name="smart_toy" size={18} />
          {m} · open in Mission Center
          <span className={styles.grow} />
          <Icon name="chevron_right" size={18} />
        </button>
      ))}
    </Card>
  );
}
