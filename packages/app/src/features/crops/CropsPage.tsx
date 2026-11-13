import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { queries } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { ActionButton, Icon, Skeleton, useToast } from '../../shared/ui';
import { BatchDialog } from './BatchDialog';
import { BatchView } from './BatchView';
import { GreenhouseCards, GreenhouseView } from './GreenhouseViews';
import type { CropPath } from './nav';
import { PlantView } from './PlantView';
import { ZoneView } from './ZoneView';
import styles from './crops.module.css';

/** Greenhouses & Crops (design): drill down Greenhouse → Zone → Crop batch → Plant. */
export function CropsPage() {
  const list = useQuery(queries.greenhouses(usePlatform()));
  const toast = useToast((s) => s.show);
  const search = useSearch({ strict: false }) as Partial<
    Record<'gh' | 'zone' | 'batch' | 'plant', string>
  >;
  const [path, go] = useState<CropPath>(() => fromSearch(search));
  // A new deep link (e.g. from the global search) while this screen is open moves there.
  const key = JSON.stringify(search);
  const [seen, setSeen] = useState(key);
  if (key !== seen) {
    setSeen(key);
    go(fromSearch(search));
  }
  const [creating, setCreating] = useState(false);
  if (list.isPending) return <Skeleton height={500} />;
  if (list.isError) return <span className={styles.faint}>{describeError(list.error)}</span>;
  const l = list.data;
  const gh = 'gh' in path ? l.items.find((g) => g.id === path.gh) : undefined;

  const crumbs: Array<{ label: string; to: CropPath }> = [
    { label: 'All greenhouses', to: { level: 'list' } },
  ];
  if ('gh' in path)
    crumbs.push({ label: `${path.gh} · ${gh?.name ?? ''}`, to: { level: 'gh', gh: path.gh } });
  if ('zone' in path)
    crumbs.push({ label: path.zone, to: { level: 'zone', gh: path.gh, zone: path.zone } });
  if ('batch' in path)
    crumbs.push({
      label: path.batch,
      to: { level: 'batch', gh: path.gh, zone: path.zone, batch: path.batch },
    });
  if ('plant' in path) crumbs.push({ label: path.plant, to: path });

  return (
    <>
      <div className={styles.toolbar}>
        <nav className={styles.crumbs} aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={c.label} className={styles.crumb}>
              {i > 0 && <Icon name="chevron_right" size={18} color="var(--lefi-text-faint)" />}
              <button
                type="button"
                aria-current={i === crumbs.length - 1 ? 'page' : undefined}
                onClick={() => go(c.to)}
              >
                {c.label}
              </button>
            </span>
          ))}
        </nav>
        <ActionButton
          label="New crop batch"
          icon="add"
          variant="solid"
          availability={l.can_create_batch}
          onClick={() =>
            l.can_create_batch.allowed
              ? setCreating(true)
              : toast(l.can_create_batch.reason ?? 'Not allowed.', 'bad')
          }
        />
      </div>
      {l.scope_note && (
        <div className={styles.scope}>
          <Icon name="shield_person" size={19} />
          {l.scope_note}
        </div>
      )}
      <div className={styles.simNote}>
        <Icon name="science" size={17} />
        Fictional demo operation. Health scores, heights and leaf counts are simulated — no vision
        model is connected and there are no photos yet.
      </div>
      {path.level === 'list' && <GreenhouseCards list={l} go={go} />}
      {path.level === 'gh' && <GreenhouseView id={path.gh} go={go} />}
      {path.level === 'zone' && <ZoneView gh={path.gh} id={path.zone} go={go} />}
      {path.level === 'batch' && (
        <BatchView gh={path.gh} zone={path.zone} id={path.batch} go={go} />
      )}
      {path.level === 'plant' && <PlantView id={path.plant} />}
      <BatchDialog
        key={creating ? 'new' : 'closed'}
        open={creating}
        onClose={() => setCreating(false)}
        {...('zone' in path && { zoneId: path.zone })}
      />
    </>
  );
}

/** `?gh=&zone=&batch=&plant=` → the deepest level given. */
function fromSearch(s: Partial<Record<'gh' | 'zone' | 'batch' | 'plant', string>>): CropPath {
  if (s.gh && s.zone && s.batch && s.plant)
    return { level: 'plant', gh: s.gh, zone: s.zone, batch: s.batch, plant: s.plant };
  if (s.gh && s.zone && s.batch) return { level: 'batch', gh: s.gh, zone: s.zone, batch: s.batch };
  if (s.gh && s.zone) return { level: 'zone', gh: s.gh, zone: s.zone };
  if (s.gh) return { level: 'gh', gh: s.gh };
  return { level: 'list' };
}
