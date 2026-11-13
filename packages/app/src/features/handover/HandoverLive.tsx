import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  handoverApi,
  handoverKeys,
  handoverQueries,
  type BrainHandover,
  type HandoverIncident,
  type HandoverSlot,
  type HandoverView,
} from '@lefi/api';
import { mascots, toneVars, type Tone } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { roleColor } from '../../shared/lib/roles';
import { stamp, timeAgo } from '../../shared/lib/time';
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  EmptyState,
  Icon,
  ProvenanceBadge,
  Skeleton,
  TextArea,
  useToast,
} from '../../shared/ui';
import styles from './handover.module.css';

const hm = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const SEVERITY_TONE: Record<string, Tone> = { critical: 'crit', warning: 'warn', info: 'info' };
const STATE_TONE: Record<string, Tone> = {
  'in range': 'ok',
  'no range set': 'off',
  "above the species' range": 'warn',
  "below the species' range": 'warn',
};

function useHandoverMutation<A>(fn: (a: A) => Promise<unknown>, ok: string) {
  const qc = useQueryClient();
  const toast = useToast((t) => t.show);
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: handoverKeys.all });
      toast(ok, 'ok');
    },
    onError: (e) => toast(describeError(e), 'bad'),
  });
}

/**
 * Shift Handover against the real Lefi Brain (ADR-095), in the design's layout: outgoing →
 * incoming from the roster (ADR-094), Lefi AI's summary (review before signing), and the shift's
 * facts as Lefi Brain recorded them. The outgoing lead signs; the incoming lead acknowledges.
 */
export function HandoverLive() {
  const q = useQuery(handoverQueries.current(usePlatform()));
  if (q.isError)
    return (
      <EmptyState mascot="sad" title="Could not load the handover">
        {describeError(q.error)}
      </EmptyState>
    );
  if (!q.data) return <Skeleton height={520} />;
  const v = q.data;
  if (v.state === 'no_shifts' || !v.handover || !v.outgoing)
    return (
      <EmptyState mascot="curious" title="No shift to hand over yet">
        {v.reason ?? 'Nobody has worked a shift yet.'}
        {v.incoming && (
          <div>
            Next: {v.incoming.name} at {stamp(v.incoming.start)}.
          </div>
        )}
      </EmptyState>
    );
  return (
    <>
      <Header v={v} h={v.handover} out={v.outgoing} />
      <SummaryCard h={v.handover} canAsk={v.can_sign} />
      <Digest h={v.handover} now={v.brain_time} />
    </>
  );
}

function lead(s: HandoverSlot | null | undefined) {
  if (!s) return undefined;
  return s.people.find((p) => p.lead) ?? s.people[0];
}

function Party({ s, dir }: { s: HandoverSlot | null | undefined; dir: string }) {
  const p = lead(s);
  if (!s)
    return (
      <div className={styles.party}>
        <Avatar name="?" size={38} />
        <div className={styles.partyText}>
          <span className={styles.partyName}>No next shift on the roster</span>
          <span className={styles.faint}>{dir}</span>
        </div>
      </div>
    );
  const others = s.people.length - 1;
  return (
    <div className={styles.party}>
      <Avatar name={p?.name ?? '?'} size={38} color={p ? roleColor(p.role) : undefined} />
      <div className={styles.partyText}>
        <span className={styles.partyName}>
          {p?.name ?? 'Nobody on the roster'}
          {others > 0 ? ` +${others}` : ''}
        </span>
        <span className={styles.faint}>
          {dir} · {s.name} {hm(s.start)}–{hm(s.end)}
        </span>
      </div>
    </div>
  );
}

function Header({ v, h, out }: { v: HandoverView; h: BrainHandover; out: HandoverSlot }) {
  const platform = usePlatform();
  const [asking, setAsking] = useState<'sign' | 'ack'>();
  const [note, setNote] = useState('');
  const sign = useHandoverMutation(() => handoverApi.sign(platform, h.id, note), 'Handed over');
  const ack = useHandoverMutation(
    () => handoverApi.acknowledge(platform, h.id, note),
    'Handover acknowledged',
  );
  const close = () => {
    setAsking(undefined);
    setNote('');
  };
  return (
    <div className={styles.header}>
      <Party s={out} dir="Outgoing" />
      <Icon name="arrow_forward" size={24} className={styles.arrow} />
      <Party s={v.incoming} dir="Incoming" />
      <div className={styles.grow} />
      {h.signed_by ? (
        <span className={styles.signed} title={h.sign_note ?? undefined}>
          <Icon name="verified" size={18} />
          Signed by {h.signed_by} · {h.signed_at ? hm(h.signed_at) : ''}
        </span>
      ) : (
        v.can_sign && (
          <Button icon="draw" onClick={() => setAsking('sign')}>
            Sign &amp; hand over
          </Button>
        )
      )}
      {h.acknowledged_by ? (
        <span className={styles.acked}>
          ✓ Received by {h.acknowledged_by} · {h.acknowledged_at ? hm(h.acknowledged_at) : ''}
        </span>
      ) : (
        v.can_acknowledge && (
          <Button
            variant="secondary"
            icon="how_to_reg"
            disabled={h.status !== 'signed'}
            title={h.status !== 'signed' ? 'The outgoing lead signs first' : undefined}
            onClick={() => setAsking('ack')}
          >
            Incoming: acknowledge
          </Button>
        )
      )}
      {asking && (
        <Dialog open onClose={close} labelledBy="handover-note-title" width={520}>
          <form
            className={styles.noteForm}
            onSubmit={(e) => {
              e.preventDefault();
              (asking === 'sign' ? sign : ack).mutate(undefined, { onSuccess: close });
            }}
          >
            <h2 id="handover-note-title">
              {asking === 'sign' ? 'Sign and hand over' : 'Acknowledge the handover'}
            </h2>
            <p className={styles.faint}>
              {asking === 'sign'
                ? 'You confirm you reviewed Lefi’s summary and the facts below. They are frozen as they are now and the incoming shift is told.'
                : 'You confirm the incoming shift received this handover.'}
            </p>
            <TextArea
              aria-label="Note"
              rows={3}
              maxLength={1000}
              value={note}
              placeholder="Note (optional)"
              onChange={(e) => setNote(e.target.value)}
            />
            <div className={styles.noteButtons}>
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={sign.isPending || ack.isPending}>
                {asking === 'sign' ? 'Sign & hand over' : 'Acknowledge'}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}

function SummaryCard({ h, canAsk }: { h: BrainHandover; canAsk: boolean }) {
  const platform = usePlatform();
  const again = useHandoverMutation(
    () => handoverApi.rewrite(platform, h.id),
    'Lefi is writing the summary again',
  );
  const s = h.summary;
  const done = s.status === 'done';
  return (
    <section className={styles.summary}>
      <img src={done ? mascots.thinking : mascots.sleeping} alt="Lefi" className={styles.mascot} />
      <div className={styles.summaryBody}>
        <div className={styles.summaryHead}>
          <span className={styles.summaryTitle}>Lefi’s shift summary</span>
          {done && (
            <Badge tone="ok" variant="tag">
              AI-generated · review before signing
            </Badge>
          )}
          {s.model && <span className={styles.faint}>{s.model}</span>}
          <div className={styles.grow} />
          {canAsk && (
            <Button
              size="sm"
              variant="ghost"
              icon="refresh"
              disabled={again.isPending || s.status === 'pending'}
              onClick={() => again.mutate(undefined)}
            >
              Write again
            </Button>
          )}
        </div>
        {done ? (
          <div className={styles.summaryGrid}>
            <Block label="What happened">
              <span className={styles.prose}>{s.happened}</span>
            </Block>
            <Block label="Why it happened">
              <span className={styles.prose}>{s.why || 'Not known from the facts.'}</span>
            </Block>
            <Block label="What was done">
              {s.done.length === 0 && <span className={styles.faint}>Nothing recorded.</span>}
              {s.done.map((d) => (
                <Line key={d} icon="check" tone="ok" text={d} />
              ))}
            </Block>
            <Block label="Needs attention next" warn>
              {s.attention.map((d) => (
                <Line key={d} icon="arrow_right" tone="warn" text={d} />
              ))}
            </Block>
          </div>
        ) : (
          <p className={styles.prose}>
            {s.status === 'pending'
              ? 'Lefi is writing the shift summary…'
              : `Lefi’s summary is not available${s.status === 'invalid' ? ' (its answer did not fit and is not shown)' : ''}${s.error ? `: ${s.error}` : ''}. The cards below come from Lefi Brain’s records.`}
          </p>
        )}
      </div>
    </section>
  );
}

function Block({ label, warn, children }: { label: string; warn?: boolean; children: ReactNode }) {
  return (
    <div className={styles.block}>
      <span className={styles.blockLabel} data-warn={warn}>
        {label}
      </span>
      {children}
    </div>
  );
}

function Line({ icon, tone, text }: { icon: string; tone: 'ok' | 'warn'; text: string }) {
  return (
    <span className={styles.line}>
      <Icon name={icon} size={16} className={styles[tone]} />
      {text}
    </span>
  );
}

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const t = toneVars(tone);
  return (
    <span className={styles.pill} style={{ background: t.bg, color: t.fg }}>
      {children}
    </span>
  );
}

function Card({
  title,
  empty,
  children,
}: {
  title: string;
  empty?: string | false;
  children?: ReactNode;
}) {
  return (
    <section className={styles.card}>
      <span className={styles.cardTitle}>{title}</span>
      {empty ? <span className={styles.faint}>{empty}</span> : children}
    </section>
  );
}

function Incidents({ rows, dot }: { rows: HandoverIncident[]; dot?: boolean }) {
  return rows.map((i, n) => (
    <a key={`${i.number ?? n}`} className={styles.row} href="#/alerts">
      {dot && (
        <span
          className={styles.dot}
          style={{ background: toneVars(SEVERITY_TONE[i.severity] ?? 'info').dot }}
        />
      )}
      <span className={styles.mono}>{i.number ?? '—'}</span>
      <span className={styles.rowTitle}>{i.title}</span>
      <Pill tone={i.status === 'resolved' ? 'ok' : i.status === 'acknowledged' ? 'info' : 'warn'}>
        {i.status}
      </Pill>
    </a>
  ));
}

function Digest({ h, now }: { h: BrainHandover; now: string }) {
  const ph = h.plant_health;
  const states = Object.entries(ph.by_state);
  return (
    <>
      <span className={styles.faint}>
        Facts of the shift {hm(h.start)}–{hm(h.end)} ·{' '}
        {h.status === 'open'
          ? `updated ${timeAgo(h.refreshed_at, now)}`
          : `frozen when signed ${h.signed_at ? stamp(h.signed_at) : ''}`}{' '}
        {h.origins.map((o) => (
          <ProvenanceBadge key={o} origin={o as 'LIVE' | 'SIMULATED'} />
        ))}
      </span>
      <div className={styles.cards}>
        <Card
          title="Environmental highlights"
          empty={h.environment.length === 0 && 'No readings during this shift.'}
        >
          {h.environment.map((r) => (
            <div key={r.zone + r.measurement} className={styles.kv}>
              <span className={styles.kvLabel}>
                {r.zone} · {r.measurement}
              </span>
              <b style={{ color: toneVars(STATE_TONE[r.state] ?? 'info').fg }}>
                {r.first === r.last ? r.avg : `${r.first} → ${r.last}`}
                {r.unit ? ` ${r.unit}` : ''} · {r.state}
              </b>
            </div>
          ))}
        </Card>
        <Card
          title="Plant health changes"
          empty={ph.records === 0 && 'Nobody recorded plant health during this shift.'}
        >
          <div className={styles.kv}>
            <span className={styles.kvLabel}>Records by people</span>
            <b>{ph.records}</b>
          </div>
          {states.map(([k, n]) => (
            <div key={k} className={styles.kv}>
              <span className={styles.kvLabel}>{k}</span>
              <b>{n}</b>
            </div>
          ))}
          {Object.entries(ph.issues).map(([k, n]) => (
            <div key={k} className={styles.kv}>
              <span className={styles.kvLabel}>Issue · {k}</span>
              <b>{n}</b>
            </div>
          ))}
        </Card>
        <Card
          title="Active incidents"
          empty={h.incidents_active.length === 0 && 'No open incidents.'}
        >
          <Incidents rows={h.incidents_active} dot />
        </Card>
        <Card
          title="Resolved incidents"
          empty={h.incidents_resolved.length === 0 && 'None this shift.'}
        >
          <Incidents rows={h.incidents_resolved} />
        </Card>
        <Card title="Robot missions performed" empty={h.robot_missions} />
        <Card
          title={`Outstanding tasks · ${h.tasks_outstanding.count}`}
          empty={h.tasks_outstanding.count === 0 && 'No outstanding tasks.'}
        >
          {h.tasks_outstanding.items.map((t, n) => (
            <a key={`${t.number ?? n}`} className={styles.row} href="#/tasks">
              <span className={styles.mono}>{t.number ?? '—'}</span>
              <span className={styles.rowTitle}>
                {t.title}
                {t.waiting_for_a_person ? ' · waiting for a person' : ''}
              </span>
              <Pill
                tone={t.priority === 'urgent' ? 'crit' : t.priority === 'high' ? 'warn' : 'info'}
              >
                {t.status.replace('_', ' ')}
              </Pill>
            </a>
          ))}
        </Card>
        <Card title="Tasks done this shift" empty={h.tasks_done.length === 0 && 'None this shift.'}>
          {h.tasks_done.map((t, n) => (
            <div key={`${t.number ?? n}`} className={styles.row}>
              <span className={styles.mono}>{t.number ?? '—'}</span>
              <span className={styles.rowTitle}>{t.title}</span>
              <Pill tone="ok">{t.status}</Pill>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
