import type { Handover, ShiftParty } from '@lefi/api';
import { roleColor } from '../../shared/lib/roles';
import { ActionButton, Avatar, Icon } from '../../shared/ui';
import { useHandoverActions } from './useHandoverActions';
import styles from './handover.module.css';

function Party({ p }: { p: ShiftParty }) {
  return (
    <div className={styles.party}>
      <Avatar name={p.name} size={38} color={roleColor(p.role_id)} />
      <div className={styles.partyText}>
        <span className={styles.partyName}>{p.name}</span>
        <span className={styles.faint}>{p.shift}</span>
      </div>
    </div>
  );
}

/** Outgoing → incoming, with the two recorded human acts (sign, then acknowledge). */
export function HandoverHeader({ h }: { h: Handover }) {
  const act = useHandoverActions();
  return (
    <div className={styles.header}>
      <Party p={h.outgoing} />
      <Icon name="arrow_forward" size={24} className={styles.arrow} />
      <Party p={h.incoming} />
      <div className={styles.grow} />
      {h.signed ? (
        <span className={styles.signed} title={`Signed by ${h.signed.by} at ${h.signed.at}`}>
          <Icon name="verified" size={18} />
          Signed by {h.signed.by} · {h.signed.at}
        </span>
      ) : (
        <ActionButton
          label="Sign & hand over"
          icon="draw"
          variant="solid"
          availability={h.actions.sign}
          busy={act.sign.isPending}
          onClick={() => act.sign.mutate()}
        />
      )}
      {h.acknowledged ? (
        <span className={styles.acked}>
          ✓ Received by {h.acknowledged.by} · {h.acknowledged.at}
        </span>
      ) : (
        <ActionButton
          label="Incoming: acknowledge"
          icon="how_to_reg"
          availability={h.actions.acknowledge}
          busy={act.acknowledge.isPending}
          onClick={() => act.acknowledge.mutate()}
        />
      )}
    </div>
  );
}
