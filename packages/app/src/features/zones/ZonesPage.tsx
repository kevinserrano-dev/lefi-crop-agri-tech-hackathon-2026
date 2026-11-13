import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { queries } from '@lefi/api';
import { toneVars } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { ActionButton, Icon, Skeleton, useToast } from '../../shared/ui';
import { NewZoneForm } from './NewZoneForm';
import { ZoneDetail } from './ZoneDetail';
import styles from './zones.module.css';

/** Zones & Inventory (design): zone list with counters, zone detail, create zone. */
export function ZonesPage() {
  const q = useQuery(queries.zoneInventoryList(usePlatform()));
  const toast = useToast((s) => s.show);
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const search = useSearch({ strict: false }) as { zone?: string };
  const [seen, setSeen] = useState(search.zone);
  if (search.zone !== seen) {
    setSeen(search.zone);
    if (search.zone) setSelected(search.zone);
  }
  if (q.isPending) return <Skeleton height={500} />;
  if (q.isError) return <span className={styles.faint}>{describeError(q.error)}</span>;
  const l = q.data;
  const want = selected ?? search.zone;
  const current =
    (want && l.items.find((z) => z.id === want)?.id) ??
    l.items.find((z) => z.id === 'GH1-Z2')?.id ??
    l.items[0]?.id;
  return (
    <>
      <div className={styles.head}>
        <div className={styles.titleBlock}>
          <h2 className={styles.h2}>Zones &amp; inventory</h2>
          <span className={styles.muted}>{l.summary}</span>
        </div>
        <ActionButton
          label="New zone"
          icon="add"
          variant="solid"
          availability={l.can_create}
          onClick={() =>
            l.can_create.allowed
              ? setCreating(true)
              : toast(l.can_create.reason ?? 'Not allowed.', 'bad')
          }
        />
      </div>
      {creating && (
        <NewZoneForm
          onDone={(id) => {
            setCreating(false);
            if (id) setSelected(id);
          }}
        />
      )}
      <div className={styles.layout}>
        <div className={styles.list} role="list" aria-label="Zones">
          {l.items.map((z) => {
            const t = toneVars(z.tone);
            return (
              <button
                key={z.id}
                type="button"
                role="listitem"
                className={styles.zoneItem}
                aria-current={z.id === current}
                onClick={() => setSelected(z.id)}
              >
                <div className={styles.itemHead}>
                  <span className={styles.itemTitle}>
                    <i style={{ background: t.dot }} />
                    <b className={styles.mono}>{z.id}</b>
                    <span className={styles.ellipsis}>{z.name}</span>
                  </span>
                  {z.service_due > 0 && (
                    <span className={styles.due}>{z.service_due} service due</span>
                  )}
                </div>
                <span className={styles.faint}>
                  {z.greenhouse_name} · {z.crop}
                </span>
                <div className={styles.counts}>
                  <span title="Sensors live / installed">
                    <Icon name="sensors" size={15} /> {z.sensors_live}/{z.sensors_total} live
                  </span>
                  <span title="Cameras">
                    <Icon name="videocam" size={15} /> {z.cameras}
                  </span>
                  <span title="Robots & drones">
                    <Icon name="smart_toy" size={15} /> {z.robots}
                  </span>
                  <span title="Crew">
                    <Icon name="groups" size={15} /> {z.crew}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
        {current && <ZoneDetail key={current} id={current} />}
      </div>
    </>
  );
}
