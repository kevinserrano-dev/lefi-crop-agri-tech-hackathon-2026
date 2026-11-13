import type { PlantItem } from '@lefi/api';
import { HealthBadge } from '../../operations/PlantHealthLive';
import { PhotoPlaceholder } from '../../crops/parts';
import { locationName } from '../places';
import type { GhData } from './model';
import crops from '../../crops/crops.module.css';
import styles from './greenhouses.module.css';

/** Tracked plants as cards. No photo exists yet, so each card says so instead of showing one. */
export function PlantCards({
  plants,
  d,
  onOpen,
  empty,
}: {
  plants: PlantItem[];
  d: GhData;
  onOpen: (p: PlantItem) => void;
  empty: string;
}) {
  if (plants.length === 0) return <p className={crops.muted}>{empty}</p>;
  const where = new Map(d.places.containers.map((c) => [c.id, c]));
  return (
    <div className={crops.plantGrid}>
      {plants.map((p) => {
        const c = p.container_id ? where.get(p.container_id) : undefined;
        const latest = d.health?.get(p.id)?.latest;
        return (
          <button
            key={p.id}
            type="button"
            className={crops.plantCard}
            onClick={() => onOpen(p)}
            aria-label={`Plant ${p.code}`}
          >
            <div className={styles.plantPhoto}>
              <PhotoPlaceholder label="photo" height={86} />
              {d.health && (
                <span className={styles.plantBadge}>
                  <HealthBadge health={latest?.health} />
                </span>
              )}
            </div>
            <div className={crops.plantText}>
              <span className={crops.monoStrong}>{p.code}</span>
              <span className={crops.faint}>
                {[p.name, c ? `${locationName(c)}${c.spot ? ` · ${c.spot}` : ''}` : undefined]
                  .filter(Boolean)
                  .join(' · ') || 'No growing location'}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
