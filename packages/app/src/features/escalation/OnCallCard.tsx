import type { EscalationConfig } from '@lefi/api';
import { roleColor } from '../../shared/lib/roles';
import { Avatar, Switch } from '../../shared/ui';
import { useEscalationActions } from './useEscalationActions';
import styles from './escalation.module.css';

/** 24/7 on-call roster and this week's primary rotation. */
export function OnCallCard({ c }: { c: EscalationConfig }) {
  const { oncall, guarded } = useEscalationActions();
  const av = c.can_edit_oncall;
  return (
    <section className={styles.card}>
      <span className={styles.cardTitle}>24/7 on-call roster</span>
      <span className={styles.text}>
        People who agreed to receive critical alerts outside their shift. Today’s primary is
        notified first, then the backups.
      </span>
      <div className={styles.list}>
        {c.oncall.map((p) => (
          <div key={p.id} className={styles.toggleRow}>
            <Avatar name={p.name} size={32} color={roleColor(p.role_id)} />
            <div className={styles.stepText}>
              <b className={styles.nameLine}>
                {p.name}
                {p.primary && <span className={styles.primary}>Primary today</span>}
              </b>
              <span className={styles.faint}>
                {p.role_label} · {p.phone}
              </span>
            </div>
            <Switch
              label={`${p.name} on the 24/7 roster`}
              on={p.on}
              disabled={!av.allowed}
              title={av.reason ?? undefined}
              onChange={guarded(av, () => oncall.mutate({ id: p.id, on: !p.on }))}
            />
          </div>
        ))}
      </div>
      <span className={styles.eyebrowRule}>This week · primary on-call</span>
      <div className={styles.week}>
        {c.rotation.map((d) => (
          <div key={d.day} className={styles.day} data-today={d.today}>
            <b>{d.day}</b>
            <span>{d.who}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
