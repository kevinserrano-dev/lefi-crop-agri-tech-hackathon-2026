import { useState } from 'react';
import { live, type GreenhouseItem, type ZoneItem } from '@lefi/api';
import { toneVars } from '@lefi/ui';
import { usePlatform } from '../../../platform/PlatformContext';
import { Badge, Button, Dialog, EmptyState, FormField, Icon } from '../../../shared/ui';
import { Fact, PhotoPlaceholder } from '../../crops/parts';
import { useLiveMutation } from '../common';
import { PURPOSE, STATUS, SYSTEM } from '../places';
import { cropNames, fmtNum, zoneTitle, type GhData, type Go } from './model';
import crops from '../../crops/crops.module.css';
import styles from './greenhouses.module.css';

/** Counts Lefi Brain gives per zone, added up for a set of zones. */
function totals(zones: ZoneItem[], d: GhData) {
  const ids = new Set(zones.map((z) => z.id));
  return {
    plants: zones.reduce((n, z) => n + (z.summary?.plants ?? 0), 0),
    crops: zones.reduce((n, z) => n + (z.summary?.active_crops ?? 0), 0),
    locations: d.places.containers.filter((c) => ids.has(c.zone_id)).length,
    inBatches: zones.reduce((n, z) => n + (z.summary?.batch_plants ?? 0), 0),
  };
}

const zoneDot = (z: ZoneItem) => toneVars(STATUS[z.status].tone).dot;

/** All greenhouses: one card each, its zones as chips coloured by their status. */
export function GreenhouseCards({ d, go }: { d: GhData; go: Go }) {
  if (d.places.greenhouses.length === 0) {
    return (
      <EmptyState mascot="curious" title="No greenhouses yet">
        Create the first greenhouse with “New greenhouse”, then add its zones.
      </EmptyState>
    );
  }
  return (
    <div className={crops.ghGrid}>
      {d.places.greenhouses.map((g) => {
        const zones = d.places.zones.filter((z) => z.greenhouse_id === g.id);
        const t = totals(zones, d);
        return (
          <button
            key={g.id}
            type="button"
            className={crops.ghCard}
            onClick={() => go({ level: 'gh', gh: g.id })}
          >
            <PhotoPlaceholder label={`greenhouse photo · ${g.name}`} height={150} />
            <div className={crops.ghBody}>
              <div className={crops.rowBetween}>
                <div className={crops.titleBlock}>
                  <span className={crops.ghName}>{g.name}</span>
                  <span className={crops.faint}>
                    {systemsOf(zones) || 'Growing systems not set'}
                  </span>
                </div>
                <Icon name="arrow_forward" size={22} color="var(--lefi-text-faint)" />
              </div>
              <div className={crops.stats4}>
                <Fact label="Zones">{zones.length}</Fact>
                <Fact label="Plants">{fmtNum(t.plants)}</Fact>
                <Fact label="Active crops">{t.crops}</Fact>
                <Fact label="Locations">{t.locations}</Fact>
              </div>
              <div className={crops.dots}>
                {zones.map((z) => (
                  <span key={z.id} className={crops.dotChip} title={STATUS[z.status].label}>
                    <i style={{ background: zoneDot(z) }} />
                    {z.code ?? z.name}
                  </span>
                ))}
                {zones.length === 0 && <span className={crops.faint}>No zones yet</span>}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function systemsOf(zones: ZoneItem[]): string {
  const all = new Set(
    zones.flatMap((z) => z.growing_systems).filter((s) => s !== 'not_configured'),
  );
  return [...all].map((s) => SYSTEM[s]).join(' · ');
}

/** One greenhouse: what Lefi Brain knows about it, and its zones. */
export function GreenhouseView({
  gh,
  d,
  go,
  onAddZone,
}: {
  gh: GreenhouseItem;
  d: GhData;
  go: Go;
  onAddZone?: () => void;
}) {
  const zones = d.places.zones.filter((z) => z.greenhouse_id === gh.id);
  const t = totals(zones, d);
  const area = zones.reduce((n, z) => n + (z.area_m2 ?? 0), 0);
  const names = cropNames(d);
  return (
    <div className={crops.ghLayout}>
      <section className={crops.cardFlush}>
        <PhotoPlaceholder label={`aerial photo · ${gh.name}`} height={180} />
        <div className={crops.pad}>
          <span className={crops.bigTitle}>{gh.name}</span>
          <div className={crops.facts2}>
            <Fact label="Growing area">{area > 0 ? `${fmtNum(area)} m²` : 'Not set'}</Fact>
            <Fact label="System">{systemsOf(zones) || 'Not set'}</Fact>
            <Fact label="Zones">{zones.length}</Fact>
            <Fact label="Growing locations">{t.locations}</Fact>
            <Fact label="Plants">{fmtNum(t.plants)}</Fact>
            <Fact label="In crop batches">{fmtNum(t.inBatches)}</Fact>
            <Fact label="Created">{gh.created_at.slice(0, 10)}</Fact>
            <Fact label="AI health score">
              <span className={crops.faint}>Not available</span>
            </Fact>
          </div>
        </div>
      </section>
      <section className={crops.card}>
        <div className={crops.rowBetween}>
          <span className={crops.cardTitle}>Zones</span>
          <span className={styles.headActions}>
            <span className={crops.faint}>Select a zone to see its sensors and batches</span>
            {onAddZone && (
              <Button size="sm" icon="add" onClick={onAddZone}>
                Add zone
              </Button>
            )}
          </span>
        </div>
        {zones.length === 0 ? (
          <p className={crops.muted}>This greenhouse has no zones yet.</p>
        ) : (
          <div className={crops.zoneGrid}>
            {zones.map((z) => {
              const zoneCrops = d.crops.filter((c) => c.zone_id === z.id);
              const kinds = [...new Set(zoneCrops.map((c) => names.get(c.crop_type_id)))]
                .filter(Boolean)
                .join(', ');
              const purpose = z.purpose
                ? z.purpose === 'other'
                  ? (z.purpose_other ?? PURPOSE.other)
                  : PURPOSE[z.purpose]
                : undefined;
              return (
                <button
                  key={z.id}
                  type="button"
                  className={crops.zoneCard}
                  onClick={() => go({ level: 'zone', gh: gh.id, zone: z.id })}
                >
                  <div className={crops.rowBetween}>
                    <div className={crops.titleBlock}>
                      <span className={crops.zoneId}>{zoneTitle(z)}</span>
                      <span className={crops.faint}>
                        {[purpose, kinds || 'No active crop'].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                    <Badge tone={STATUS[z.status].tone} dot>
                      {STATUS[z.status].label}
                    </Badge>
                  </div>
                  <div className={crops.stats3}>
                    <Fact label="Plants">{fmtNum(z.summary?.plants ?? 0)}</Fact>
                    <Fact label="Crops">{z.summary?.active_crops ?? 0}</Fact>
                    <Fact label="Area">{z.area_m2 ? `${fmtNum(z.area_m2)} m²` : '—'}</Fact>
                  </div>
                  <span className={crops.faint}>
                    {z.growing_systems
                      .filter((s) => s !== 'not_configured')
                      .map((s) => SYSTEM[s])
                      .join(' · ') || 'Growing system not set'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

/** A greenhouse is only a name in Lefi Brain; everything else hangs from its zones. */
export function NewGreenhouseDialog({ onClose }: { onClose: () => void }) {
  const platform = usePlatform();
  const [name, setName] = useState('');
  const add = useLiveMutation(
    (n: string) => live.addGreenhouse(platform, n),
    (g) => `${g.name} created`,
  );
  return (
    <Dialog open onClose={onClose} labelledBy="new-gh-title" width={460}>
      <form
        className={crops.form}
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate(name.trim(), { onSuccess: onClose });
        }}
      >
        <div className={crops.dialogHead}>
          <h2 id="new-gh-title" className={crops.dialogTitle}>
            New greenhouse
          </h2>
          <button type="button" className={crops.close} aria-label="Close" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </div>
        <FormField label="Name">
          <input
            required
            autoFocus
            maxLength={64}
            placeholder="e.g. North Range"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
        <div className={crops.dialogFoot}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" icon="add" disabled={!name.trim() || add.isPending}>
            Create
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
