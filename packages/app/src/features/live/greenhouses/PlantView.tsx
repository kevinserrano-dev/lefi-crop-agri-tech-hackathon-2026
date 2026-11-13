import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { live, liveQueries, type PlantHealthPage, type PlantItem } from '@lefi/api';
import { usePlatform } from '../../../platform/PlatformContext';
import { stamp } from '../../../shared/lib/time';
import { Button, Dialog, Icon, ProvenanceBadge, Skeleton } from '../../../shared/ui';
import { PhotoPlaceholder } from '../../crops/parts';
import { HealthBadge, ObservationHistory, ObserveForm } from '../../operations/PlantHealthLive';
import { useCan } from '../../session';
import { ConfirmButton, DataStateBadge, LatestValues, useLiveMutation } from '../common';
import { STAGE, locationName } from '../places';
import { Readings } from '../SensorCard';
import { cropNames, cropOfPlant, daysSince, type GhData, type Go } from './model';
import crops from '../../crops/crops.module.css';
import liveStyles from '../live.module.css';
import styles from './greenhouses.module.css';

const RELATION: Record<string, string> = {
  plant: 'This plant',
  container: 'Its growing location',
  zone: 'Its zone',
  ambient: 'Air around it',
};

/** One tracked plant: where it is, what measures it, and what people recorded about it. */
export function PlantView({
  plant,
  d,
  healthPage,
  go,
}: {
  plant: PlantItem;
  d: GhData;
  healthPage?: PlantHealthPage;
  go: Go;
}) {
  const canEdit = useCan('batch.edit');
  const [observing, setObserving] = useState(false);
  const container = d.places.containers.find((c) => c.id === plant.container_id);
  const crop = cropNames(d).get(plant.crop_type_id) ?? 'Unknown crop';
  const batch = cropOfPlant(plant, d);
  const row = d.health?.get(plant.id);
  const planted = plant.planted_on ? daysSince(plant.planted_on, d.now) : undefined;
  const zone = d.places.zones.find((z) => z.id === plant.zone_id);
  return (
    <div className={crops.plantLayout}>
      <div className={crops.stack}>
        <section className={crops.cardFlush}>
          <PhotoPlaceholder label={`plant photo · ${plant.code}`} height={260} />
          <div className={crops.pad}>
            <div className={crops.rowBetween}>
              <div className={crops.titleBlock}>
                <span className={crops.plantId}>{plant.code}</span>
                <span className={crops.muted}>
                  {[
                    plant.name,
                    crop,
                    container &&
                      `${locationName(container)}${container.spot ? ` · ${container.spot}` : ''}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              {healthPage?.can_observe && (
                <Button icon="edit_note" onClick={() => setObserving(true)}>
                  Log observation
                </Button>
              )}
            </div>
            {plant.notes && <p className={crops.muted}>{plant.notes}</p>}
            {canEdit && (
              <PlantActions
                plant={plant}
                onRetired={() => {
                  if (zone) go({ level: 'zone', gh: zone.greenhouse_id, zone: zone.id });
                }}
              />
            )}
          </div>
        </section>
        <PlantSensors plantId={plant.id} now={d.now} />
      </div>

      <div className={crops.stack}>
        <div className={crops.tiles4}>
          <div className={crops.tile}>
            Plant health
            {row ? (
              <>
                <span className={styles.tileBadge}>
                  <HealthBadge health={row.latest?.health} />
                </span>
                <span>
                  {row.latest
                    ? `${row.latest.observed_by} · ${stamp(row.latest.observed_at)}`
                    : 'Nobody has checked it yet'}
                </span>
              </>
            ) : (
              <>
                <b className={crops.tileSmall}>—</b>
                <span>Needs AI Plant Health access</span>
              </>
            )}
          </div>
          <div className={crops.tile}>
            Growth stage
            <b className={crops.tileSmall}>
              {batch?.growth_stage ? STAGE[batch.growth_stage] : 'Not set'}
            </b>
            <span>{batch ? 'From its crop batch' : 'Not in a crop batch'}</span>
          </div>
          <div className={crops.tile}>
            Planted
            <b className={crops.tileSmall}>
              {planted === undefined ? (plant.planted_on ?? 'Not set') : `Day ${planted}`}
            </b>
            <span>{plant.planted_on ?? 'Date not entered'}</span>
          </div>
          <div className={crops.tile}>
            NFC tag
            <b className={crops.tileSmall}>{plant.nfc_uid ? 'Linked' : 'None'}</b>
            <span className={crops.mono}>{plant.nfc_uid ?? '—'}</span>
          </div>
        </div>

        <section className={crops.card}>
          <span className={crops.cardTitle}>Previous AI inspections</span>
          <div className={styles.unavailable}>
            <Icon name="visibility_off" size={22} />
            <span>
              <b>AI vision is not available.</b>{' '}
              {healthPage?.vision.reason ??
                'Lefi Brain has no plant images and no vision model, so no AI inspection exists.'}
            </span>
          </div>
        </section>

        {d.health ? (
          <section className={crops.card}>
            <ObservationHistory plantId={plant.id} title="Inspection history (people)" />
          </section>
        ) : null}
      </div>

      {healthPage && (
        <Dialog
          open={observing}
          onClose={() => setObserving(false)}
          labelledBy="observe-title"
          width={560}
        >
          <div className={crops.form}>
            <div className={crops.dialogHead}>
              <h2 id="observe-title" className={crops.dialogTitle}>
                Log observation · {plant.code}
              </h2>
              <button
                type="button"
                className={crops.close}
                aria-label="Close"
                onClick={() => setObserving(false)}
              >
                <Icon name="close" size={22} />
              </button>
            </div>
            <ObserveForm
              row={{ plant_id: plant.id, code: plant.code }}
              issues={healthPage.issues}
            />
          </div>
        </Dialog>
      )}
    </div>
  );
}

/** Link, replace or remove its NFC tag; retire it. */
function PlantActions({ plant, onRetired }: { plant: PlantItem; onRetired: () => void }) {
  const platform = usePlatform();
  const [nfc, setNfc] = useState('');
  const setTag = useLiveMutation(
    (uid: string | null) => live.updatePlant(platform, plant.id, { nfc_uid: uid }),
    (r) => (r.nfc_uid ? 'NFC tag linked' : 'NFC tag removed'),
  );
  const retire = useLiveMutation(
    () => live.retirePlant(platform, plant.id),
    () => 'Plant retired',
  );
  return (
    <div className={liveStyles.actions}>
      <form
        className={liveStyles.inline}
        onSubmit={(e) => {
          e.preventDefault();
          setTag.mutate(nfc.trim(), { onSuccess: () => setNfc('') });
        }}
      >
        <input
          aria-label="NFC tag UID"
          placeholder="NFC tag UID, e.g. 04:A2:2B:9C:5D:61:80"
          value={nfc}
          onChange={(e) => setNfc(e.target.value)}
        />
        <Button size="sm" type="submit" disabled={!nfc.trim() || setTag.isPending}>
          {plant.nfc_uid ? 'Replace tag' : 'Link tag'}
        </Button>
        {plant.nfc_uid && (
          <Button size="sm" variant="ghost" type="button" onClick={() => setTag.mutate(null)}>
            Remove tag
          </Button>
        )}
      </form>
      <ConfirmButton
        label="Retire"
        icon="delete"
        confirm="It leaves the list and frees its NFC tag."
        onConfirm={() => retire.mutate(undefined, { onSuccess: onRetired })}
      />
    </div>
  );
}

/** "Environmental observations": the enabled sensors that describe this plant, and how. */
function PlantSensors({ plantId, now }: { plantId: string; now?: string }) {
  const sensors = useQuery(liveQueries.plantSensors(usePlatform(), plantId));
  const [open, setOpen] = useState<string>();
  const list = sensors.data?.sensors ?? [];
  return (
    <section className={crops.card}>
      <span className={crops.cardTitle}>What is measured for this plant</span>
      {sensors.isPending ? (
        <Skeleton height={80} />
      ) : list.length === 0 ? (
        <p className={crops.muted}>
          No enabled sensor describes this plant yet. In Devices &amp; Health, enable a sensor and
          assign it to this plant, its location or its zone, or place an ESP32 with an air sensor in
          its zone.
        </p>
      ) : (
        list.map((ps) => (
          <div key={ps.sensor.id} className={liveStyles.sensor}>
            <div className={liveStyles.sensorHead}>
              <span>
                <b>{ps.sensor.channel.label}</b>{' '}
                <span className={liveStyles.mono}>
                  {RELATION[ps.relation]} · {ps.device_name} ({ps.sensor.id})
                </span>
              </span>
              <span className={liveStyles.assign}>
                {ps.device_id.startsWith('sim-') && <ProvenanceBadge origin="SIMULATED" />}
                <DataStateBadge state={ps.sensor.data_state} />
              </span>
            </div>
            <LatestValues sensor={ps.sensor} {...(now ? { now } : {})} />
            <div>
              <Button
                size="sm"
                variant="link"
                onClick={() => setOpen(open === ps.sensor.id ? undefined : ps.sensor.id)}
              >
                {open === ps.sensor.id ? 'Hide readings' : 'Show last readings'}
              </Button>
            </div>
            {open === ps.sensor.id && <Readings sensorId={ps.sensor.id} />}
          </div>
        ))
      )}
    </section>
  );
}
