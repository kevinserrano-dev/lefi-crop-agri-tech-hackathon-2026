import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  live,
  liveQueries,
  operationsQueries,
  type ContainerItem,
  type PlantItem,
  type Places,
  type ZoneItem,
} from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  FormField,
  Icon,
  Select,
  Skeleton,
} from '../../shared/ui';
import { useCan } from '../session';
import { useBrainNow, useLiveMutation, usePlaces } from './common';
import { CropDialog } from './CropDialog';
import { BatchView } from './greenhouses/BatchView';
import {
  GreenhouseCards,
  GreenhouseView,
  NewGreenhouseDialog,
} from './greenhouses/GreenhouseViews';
import { cropNames, cropOfPlant, zoneTitle, type GhData, type GhPath } from './greenhouses/model';
import { PlantView } from './greenhouses/PlantView';
import { ZoneView } from './greenhouses/ZoneView';
import { LocationDialog } from './LocationDialog';
import { locationName } from './places';
import { ZoneDialog } from './ZoneDialog';
import crops from '../crops/crops.module.css';
import gh from './greenhouses/greenhouses.module.css';
import styles from './live.module.css';

type DialogKind = 'greenhouse' | 'zone' | 'location' | 'batch' | 'plant';

/**
 * Greenhouses & Crops against the real Lefi Brain, in the design's drill-down: all greenhouses →
 * greenhouse → zone → crop batch (a crop assignment, ADR-066) → tracked plant. Only what Lefi
 * Brain has is shown; photos, AI health scores and heights need AI vision and say so (ADR-049).
 */
export function PlantsLive() {
  const platform = usePlatform();
  const now = useBrainNow();
  const canPlants = useCan('batch.edit');
  const canPlaces = useCan('zone.manage');
  const canHealth = useCan('nav.plantHealth');
  const places = usePlaces();
  const plants = useQuery(liveQueries.plants(platform));
  const active = useQuery(liveQueries.crops(platform));
  const healthPage = useQuery({ ...operationsQueries.plantHealth(platform), enabled: canHealth });
  const [path, go] = useState<GhPath>({ level: 'list' });
  const [dialog, setDialog] = useState<DialogKind>();

  const failed = places.error ?? plants.error ?? active.error;
  if (failed) {
    return (
      <EmptyState mascot="sad" title="Could not load greenhouses and crops">
        {describeError(failed)}
      </EmptyState>
    );
  }
  if (!places.data || !plants.data || !active.data) return <Skeleton height={420} />;

  const d: GhData = {
    places: places.data,
    plants: plants.data,
    crops: active.data,
    ...(healthPage.data && {
      health: new Map(healthPage.data.plants.map((r) => [r.plant_id, r])),
    }),
    ...(now ? { now } : {}),
  };
  const p = d.places;

  // Resolve the path against what Lefi Brain has now; anything removed meanwhile falls back up.
  const house = 'gh' in path ? p.greenhouses.find((g) => g.id === path.gh) : undefined;
  const zone = 'zone' in path ? p.zones.find((z) => z.id === path.zone) : undefined;
  const batch =
    'batch' in path && path.batch ? d.crops.find((c) => c.id === path.batch) : undefined;
  const plant = path.level === 'plant' ? d.plants.find((x) => x.id === path.plant) : undefined;
  const level: GhPath['level'] =
    path.level === 'plant' && plant && zone
      ? 'plant'
      : (path.level === 'batch' || path.level === 'plant') && batch && zone
        ? 'batch'
        : path.level !== 'list' && zone && house
          ? 'zone'
          : path.level !== 'list' && house
            ? 'gh'
            : 'list';

  const crumbs: Array<{ label: string; to: GhPath }> = [
    { label: 'All greenhouses', to: { level: 'list' } },
  ];
  if (house && level !== 'list')
    crumbs.push({ label: house.name, to: { level: 'gh', gh: house.id } });
  if (house && zone && level !== 'list' && level !== 'gh')
    crumbs.push({ label: zoneTitle(zone), to: { level: 'zone', gh: house.id, zone: zone.id } });
  if (house && zone && batch && (level === 'batch' || level === 'plant'))
    crumbs.push({
      label: `${batch.batch_code ?? 'Batch'} · ${cropNames(d).get(batch.crop_type_id) ?? ''}`,
      to: { level: 'batch', gh: house.id, zone: zone.id, batch: batch.id },
    });
  if (plant && level === 'plant') crumbs.push({ label: plant.code, to: path });

  // Locations a new batch may go to: the zone, the greenhouse, or anywhere.
  const scopeZones =
    level === 'list'
      ? p.zones
      : zone && level !== 'gh'
        ? [zone]
        : p.zones.filter((z) => z.greenhouse_id === house?.id);
  const batchLocations = p.containers.filter(
    (c) => c.status === 'active' && scopeZones.some((z) => z.id === c.zone_id),
  );
  const plantPreset = {
    ...(zone && level !== 'gh' && { zone: zone.id }),
    ...(batch && level === 'batch' && { container: batch.location_id, crop: batch.crop_type_id }),
  };

  return (
    <>
      <div className={crops.toolbar}>
        <nav className={crops.crumbs} aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={`${i}-${c.label}`} className={crops.crumb}>
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
        <div className={gh.toolbarActions}>
          {canPlaces && level === 'list' && (
            <Button variant="secondary" icon="add" onClick={() => setDialog('greenhouse')}>
              New greenhouse
            </Button>
          )}
          {canPlaces && level === 'zone' && (
            <Button variant="secondary" icon="add" onClick={() => setDialog('location')}>
              Add growing location
            </Button>
          )}
          {canPlants && (
            <Button
              variant="secondary"
              icon="add"
              onClick={() => setDialog('plant')}
              disabled={p.zones.length === 0 || p.cropTypes.length === 0}
              title={
                p.zones.length === 0
                  ? 'Add a zone first'
                  : p.cropTypes.length === 0
                    ? 'Add a crop type first'
                    : undefined
              }
            >
              New plant
            </Button>
          )}
          {canPlants && (
            <Button
              icon="add"
              onClick={() => setDialog('batch')}
              disabled={batchLocations.length === 0 || p.cropTypes.length === 0}
              title={
                p.cropTypes.length === 0
                  ? 'Add a crop type first'
                  : batchLocations.length === 0
                    ? 'Add a growing location first'
                    : undefined
              }
            >
              New crop batch
            </Button>
          )}
        </div>
      </div>
      <p className={gh.note}>
        <Icon name="visibility_off" size={17} />
        Photos, AI health scores and plant heights need AI vision, which Lefi Brain does not have
        yet: they are shown as not available. Plant health here is what people recorded.
      </p>

      {level === 'list' && (
        <>
          <GreenhouseCards d={d} go={go} />
          <CropTypesCard places={p} canAdd={canPlants} />
        </>
      )}
      {level === 'gh' && house && (
        <GreenhouseView
          gh={house}
          d={d}
          go={go}
          {...(canPlaces && { onAddZone: () => setDialog('zone') })}
        />
      )}
      {level === 'zone' && zone && <ZoneView zone={zone} d={d} go={go} />}
      {level === 'batch' && batch && <BatchView batch={batch} d={d} go={go} />}
      {level === 'plant' && plant && (
        <PlantView
          plant={plant}
          d={d}
          go={go}
          {...(healthPage.data && { healthPage: healthPage.data })}
        />
      )}

      {dialog === 'greenhouse' && <NewGreenhouseDialog onClose={() => setDialog(undefined)} />}
      {dialog === 'zone' && (
        <ZoneDialog
          places={p}
          {...(house && { greenhouseId: house.id })}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog === 'location' && zone && (
        <LocationDialog zone={zone} places={p} onClose={() => setDialog(undefined)} />
      )}
      {dialog === 'batch' && (
        <NewBatchDialog
          places={p}
          zones={scopeZones}
          locations={batchLocations}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog === 'plant' && (
        <NewPlantDialog
          open
          places={p}
          preset={plantPreset}
          onClose={() => setDialog(undefined)}
          onAdded={(made) => {
            setDialog(undefined);
            const home = p.zones.find((z) => z.id === made.zone_id);
            const inBatch = cropOfPlant(made, d);
            if (home)
              go({
                level: 'plant',
                gh: home.greenhouse_id,
                zone: home.id,
                ...(inBatch && { batch: inBatch.id }),
                plant: made.id,
              });
          }}
        />
      )}
    </>
  );
}

/** Step 1 picks the growing location; step 2 is the crop form of Zones & Inventory (ADR-066). */
function NewBatchDialog({
  places,
  zones,
  locations,
  onClose,
}: {
  places: Places;
  zones: ZoneItem[];
  locations: ContainerItem[];
  onClose: () => void;
}) {
  const [pick, setPick] = useState(locations[0]?.id ?? '');
  const [chosen, setChosen] = useState<ContainerItem>();
  if (chosen) return <CropDialog location={chosen} places={places} onClose={onClose} />;
  const zoneOf = new Map(zones.map((z) => [z.id, z]));
  return (
    <Dialog open onClose={onClose} labelledBy="new-batch-title" width={520}>
      <form
        className={crops.form}
        onSubmit={(e) => {
          e.preventDefault();
          setChosen(locations.find((c) => c.id === pick));
        }}
      >
        <div className={crops.dialogHead}>
          <h2 id="new-batch-title" className={crops.dialogTitle}>
            New crop batch
          </h2>
          <button type="button" className={crops.close} aria-label="Close" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </div>
        <FormField label="Growing location">
          <Select value={pick} onChange={(e) => setPick(e.target.value)}>
            {locations.map((c) => {
              const z = zoneOf.get(c.zone_id);
              return (
                <option key={c.id} value={c.id}>
                  {locationName(c)} ({c.code}){z ? ` · ${zoneTitle(z)}` : ''}
                </option>
              );
            })}
          </Select>
        </FormField>
        <p className={crops.muted}>
          A batch is a crop placed in one growing location, with its plant quantity, start date and
          stage. Locations are set up in Zones &amp; Inventory.
        </p>
        <div className={crops.dialogFoot}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" icon="arrow_forward" disabled={!pick}>
            Continue
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Crop types are placeholders: no thresholds until an agronomist provides them. */
function CropTypesCard({ places, canAdd }: { places: Places; canAdd: boolean }) {
  const platform = usePlatform();
  const [f, setF] = useState({ name: '', variety: '' });
  const addCrop = useLiveMutation(
    () => live.addCropType(platform, { name: f.name.trim(), variety: f.variety.trim() || null }),
    (t) => `${t.name} added`,
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    addCrop.mutate(undefined, { onSuccess: () => setF({ name: '', variety: '' }) });
  };
  return (
    <Card
      title="Crop types"
      subtitle="Placeholders: no thresholds exist until an agronomist provides them"
      className={gh.cropTypes}
    >
      <ul className={styles.placeList}>
        {places.cropTypes.map((t) => (
          <li key={t.id}>
            <span>
              {t.name}
              {t.variety ? ` · ${t.variety}` : ''}
            </span>
            {t.is_placeholder && (
              <Badge
                tone="warn"
                variant="tag"
                title="No thresholds until an agronomist provides them"
              >
                Placeholder
              </Badge>
            )}
          </li>
        ))}
        {places.cropTypes.length === 0 && <li className={styles.muted}>None yet.</li>}
      </ul>
      {canAdd && (
        <form className={styles.inline} onSubmit={submit}>
          <input
            aria-label="Crop name"
            placeholder="Crop, e.g. Lettuce"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
          <input
            aria-label="Variety"
            placeholder="Variety (optional)"
            value={f.variety}
            onChange={(e) => setF({ ...f, variety: e.target.value })}
          />
          <Button size="sm" type="submit" disabled={!f.name.trim() || addCrop.isPending}>
            Add
          </Button>
        </form>
      )}
    </Card>
  );
}

function NewPlantDialog({
  open,
  places,
  preset,
  onClose,
  onAdded,
}: {
  open: boolean;
  places: Places;
  /** Where the person is: the zone, location and crop the new plant most likely belongs to. */
  preset: { zone?: string; container?: string; crop?: string };
  onClose: () => void;
  onAdded: (p: PlantItem) => void;
}) {
  const platform = usePlatform();
  const empty = {
    code: '',
    crop: preset.crop ?? '',
    zone: preset.zone ?? '',
    container: preset.container ?? '',
    name: '',
    nfc: '',
    planted: '',
    notes: '',
  };
  const [f, setF] = useState(empty);
  const zone = f.zone || places.zones[0]?.id || '';
  const crop = f.crop || places.cropTypes[0]?.id || '';
  const add = useLiveMutation(
    () =>
      live.addPlant(platform, {
        code: f.code.trim(),
        crop_type_id: crop,
        zone_id: zone,
        container_id: f.container || null,
        name: f.name.trim() || null,
        nfc_uid: f.nfc.trim() || null,
        planted_on: f.planted || null,
        notes: f.notes.trim() || null,
      }),
    (p) => `Plant ${p.code} created`,
  );
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onClose={onClose} labelledBy="new-plant-title" width={680}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate(undefined, {
            onSuccess: (p) => {
              setF(empty);
              onAdded(p);
            },
          });
        }}
      >
        <div className={styles.dialogHead}>
          <h2 id="new-plant-title">New plant</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </div>
        <div className={styles.form}>
          <FormField label="Code (unique)">
            <input
              required
              maxLength={32}
              placeholder="P-001"
              value={f.code}
              onChange={set('code')}
            />
          </FormField>
          <FormField label="Name (optional)">
            <input maxLength={64} value={f.name} onChange={set('name')} />
          </FormField>
          <FormField label="Crop type">
            <Select value={crop} onChange={set('crop')}>
              {places.cropTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.variety ? ` · ${t.variety}` : ''}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Zone">
            <Select
              value={zone}
              onChange={(e) => setF({ ...f, zone: e.target.value, container: '' })}
            >
              {places.zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Growing location (optional)">
            <Select value={f.container} onChange={set('container')}>
              <option value="">None</option>
              {places.containers
                .filter((c) => c.zone_id === zone)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {locationName(c)} ({c.code}){c.spot ? ` · ${c.spot}` : ''}
                  </option>
                ))}
            </Select>
          </FormField>
          <FormField label="Planted on (optional)">
            <input type="date" value={f.planted} onChange={set('planted')} />
          </FormField>
          <FormField label="NFC tag UID (optional)" span={2}>
            <input placeholder="04:A2:2B:9C:5D:61:80" value={f.nfc} onChange={set('nfc')} />
          </FormField>
          <FormField label="Notes (optional)" span={2}>
            <input maxLength={500} value={f.notes} onChange={set('notes')} />
          </FormField>
        </div>
        <p className={styles.note}>
          The NFC tag carries only its own UID; reading tags with a phone comes with the mobile app.
          You can always pick a plant by hand.
        </p>
        <div className={styles.dialogFoot}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" icon="add" disabled={add.isPending || !f.code.trim()}>
            Create
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
