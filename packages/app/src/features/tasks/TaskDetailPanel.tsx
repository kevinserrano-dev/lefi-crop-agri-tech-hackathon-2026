import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { queries, type TaskDetail } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { ActionButton, Icon, Skeleton, TextArea, useToast } from '../../shared/ui';
import { PRIORITY, STATUS_TONE } from './presentation';
import { OriginTag, Pill } from './TaskTable';
import { useTaskActions } from './useTaskActions';
import styles from './tasks.module.css';

export function TaskDetailPanel({ id }: { id: string }) {
  const q = useQuery(queries.task(usePlatform(), id));
  if (q.isPending) return <Skeleton height={420} />;
  if (q.isError) return <div className={styles.panel}>{describeError(q.error)}</div>;
  return <Panel t={q.data} />;
}

function Panel({ t }: { t: TaskDetail }) {
  const navigate = useNavigate();
  const { transition } = useTaskActions(t.id);
  const [notes, setNotes] = useState('');
  const toast = useToast((x) => x.show);
  const busy = transition.isPending;

  return (
    <aside className={styles.panel} aria-label={`Task ${t.id}`}>
      <div className={styles.panelHead}>
        <div className={styles.panelTitle}>
          <span className={styles.monoMuted}>
            {t.id} · {t.type}
          </span>
          <span className={styles.panelName}>{t.title}</span>
        </div>
        <Pill tone={STATUS_TONE[t.status]}>{t.status}</Pill>
      </div>

      <div className={styles.facts}>
        <div>
          <span>Origin</span>
          <OriginTag task={t} long />
        </div>
        <div>
          <span>Priority</span>
          <b style={{ color: `var(--lefi-${PRIORITY[t.priority].tone}-fg)` }}>
            {PRIORITY[t.priority].label}
          </b>
        </div>
        <div>
          <span>Assignee</span>
          <b>{t.assignee ?? 'Unassigned'}</b>
        </div>
        <div>
          <span>Due</span>
          <b>{t.due_label}</b>
        </div>
        <div className={styles.wide}>
          <span>Source</span>
          <span>{t.source}</span>
        </div>
      </div>

      {t.incident_id && (
        <button
          type="button"
          className={styles.incident}
          onClick={() => void navigate({ to: '/alerts', search: { incident: t.incident_id } })}
        >
          <Icon name="crisis_alert" size={18} />
          Related incident {t.incident_id}
          <span className={styles.grow} />
          <Icon name="chevron_right" size={18} />
        </button>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionLabel}>Photo evidence</span>
          <ActionButton
            label="Attach photo"
            icon="add_a_photo"
            availability={t.actions.attach_photo}
            onClick={() => toast(t.actions.attach_photo.reason ?? 'Not available.', 'bad')}
          />
        </div>
        {t.evidence.length === 0 && <span className={styles.faint}>No evidence attached yet.</span>}
        {t.evidence.length > 0 && (
          <div className={styles.evidence}>
            {t.evidence.map((e) => (
              <div
                key={e.label}
                className={styles.photo}
                title={e.image_url ? e.label : 'No image file — reference only'}
              >
                <span>{e.label}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {t.notes && (
        <section className={styles.section}>
          <span className={styles.sectionLabel}>Completion notes</span>
          <span className={styles.notes}>{t.notes}</span>
        </section>
      )}

      {t.status === 'Open' && (
        <ActionButton
          label="Start work"
          icon="play_arrow"
          variant="solid"
          availability={t.actions.start}
          busy={busy}
          onClick={() => transition.mutate({ step: 'start' })}
        />
      )}
      {t.status === 'In progress' && (
        <>
          <TextArea
            aria-label="Completion notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Completion notes — what was done, readings, parts used"
          />
          <ActionButton
            label="Submit for supervisor verification"
            icon="send"
            variant="solid"
            availability={t.actions.submit}
            busy={busy}
            onClick={() => transition.mutate({ step: 'submit', notes: notes.trim() })}
          />
        </>
      )}
      {t.status === 'Awaiting verification' && (
        <div className={styles.verifyRow}>
          <ActionButton
            label="Return to assignee"
            icon="undo"
            availability={t.actions.return}
            busy={busy}
            onClick={() => transition.mutate({ step: 'return' })}
          />
          <ActionButton
            label="Verify work"
            icon="verified"
            variant="solid"
            availability={t.actions.verify}
            busy={busy}
            onClick={() => transition.mutate({ step: 'verify' })}
          />
        </div>
      )}
      {t.status === 'Verified' && (
        <div className={styles.verified}>
          <Icon name="verified" size={19} />
          Verified by {t.verified_by ?? 'a supervisor'}
        </div>
      )}
    </aside>
  );
}
