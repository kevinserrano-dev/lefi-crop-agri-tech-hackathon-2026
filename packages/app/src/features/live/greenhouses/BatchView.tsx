import { useState } from 'react';
import type { CropAssignment, GrowthStage, PlantItem } from '@lefi/api';
import { toneVars } from '@lefi/ui';
import { Button, Dialog, Icon } from '../../../shared/ui';
import { HEALTH } from '../../operations/presentation';
import { useCan } from '../../session';
import { CropDialog, EndCropForm } from '../CropDialog';
import { STAGE, locationName } from '../places';
import { PlantCards } from './PlantCards';
import {
  cropNames,
  daysSince,
  fmtNum,
  plantsOfCrop,
  summarizeHealth,
  zoneTitle,
  type GhData,
  type Go,
} from './model';
import crops from '../../crops/crops.module.css';
import styles from './greenhouses.module.css';

const STAGES = Object.keys(STAGE) as GrowthStage[];

/**
 * One crop batch (a crop assignment, ADR-066): what people entered about it, the stage it is in,
 * and the plants of it tracked one by one. Heights and AI health need AI vision: not shown.
 */
export function BatchView({ batch, d, go }: { batch: CropAssignment; d: GhData; go: Go }) {
  const canEdit = useCan('batch.edit');
  const [dialog, setDialog] = useState<'edit' | 'end'>();
  const location = d.places.containers.find((c) => c.id === batch.location_id);
  const zone = d.places.zones.find((z) => z.id === batch.zone_id);
  const crop = cropNames(d).get(batch.crop_type_id) ?? 'Unknown crop';
  const day = daysSince(batch.started_on, d.now);
  const plants = plantsOfCrop(batch, d);
  const health = d.health ? summarizeHealth(plants, d.health) : undefined;
  const at = { gh: zone?.greenhouse_id ?? '', zone: batch.zone_id };
  return (
    <>
      <div className={crops.batchTiles}>
        <div className={crops.batchHero}>
          <span className={crops.heroEyebrow}>Crop batch</span>
          <span className={crops.heroTitle}>
            {batch.batch_code ? `${batch.batch_code} · ` : ''}
            {crop}
            {batch.variety ? ` · ${batch.variety}` : ''}
          </span>
          <span className={crops.heroSub}>
            {[
              location && locationName(location),
              zone && zoneTitle(zone),
              `${batch.start_event === 'sowing' ? 'sown' : 'transplanted'} ${batch.started_on}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <div className={crops.tile}>
          Plants
          <b>{fmtNum(batch.plant_quantity)}</b>
          {batch.occupied_positions !== null && (
            <span>{fmtNum(batch.occupied_positions)} positions</span>
          )}
        </div>
        <div className={crops.tile}>
          Age · stage
          <b>{day === undefined ? '—' : `Day ${day}`}</b>
          <span>{batch.growth_stage ? STAGE[batch.growth_stage] : 'Stage not set'}</span>
        </div>
        <div className={crops.tile}>
          Est. harvest
          <b className={crops.tileSmall}>{batch.expected_harvest_on ?? 'Not set'}</b>
          <span>Entered by a person</span>
        </div>
        <div className={crops.tile}>
          Plant health
          {!health ? (
            <b className={crops.tileSmall}>—</b>
          ) : health.worst ? (
            <b
              className={crops.tileSmall}
              style={{ color: toneVars(HEALTH[health.worst].tone).fg }}
            >
              {HEALTH[health.worst].label}
            </b>
          ) : (
            <b className={crops.tileSmall}>Not checked</b>
          )}
          <span>
            {health
              ? `${health.checked} of ${health.total} tracked plants checked by people`
              : 'Needs AI Plant Health access'}
          </span>
        </div>
      </div>

      <div className={crops.twoCol}>
        <section className={crops.card}>
          <div className={crops.rowBetween}>
            <span className={crops.cardTitle}>Growth timeline</span>
            {canEdit && (
              <span className={styles.headActions}>
                <Button size="sm" variant="secondary" icon="edit" onClick={() => setDialog('edit')}>
                  Edit batch
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="agriculture"
                  onClick={() => setDialog('end')}
                >
                  Harvest / end
                </Button>
              </span>
            )}
          </div>
          <Timeline batch={batch} day={day} />
        </section>
        <section className={crops.card}>
          <div className={crops.rowBetween}>
            <span className={crops.cardTitle}>Average plant height</span>
          </div>
          <div className={styles.unavailable}>
            <Icon name="visibility_off" size={22} />
            <span>
              <b>Not available yet.</b> Heights are estimated from images by AI vision, which Lefi
              Brain does not have. No curve is drawn rather than an invented one.
            </span>
          </div>
        </section>
      </div>

      <section className={crops.card}>
        <div className={crops.rowBetween}>
          <span className={crops.cardTitle}>Plants in this batch</span>
          <span className={crops.faint}>
            {fmtNum(batch.plant_quantity)} registered plants · select to open profile
          </span>
        </div>
        <PlantCards
          plants={plants}
          d={d}
          onOpen={(p: PlantItem) => go({ level: 'plant', ...at, batch: batch.id, plant: p.id })}
          empty="This batch has no plants left. “Edit” chooses its registered plants."
        />
      </section>

      {dialog === 'edit' && location && (
        <CropDialog
          location={location}
          places={d.places}
          crop={batch}
          onClose={() => setDialog(undefined)}
        />
      )}
      <Dialog
        open={dialog === 'end'}
        onClose={() => setDialog(undefined)}
        labelledBy="end-batch-title"
        width={520}
      >
        <div className={crops.form}>
          <div className={crops.dialogHead}>
            <h2 id="end-batch-title" className={crops.dialogTitle}>
              Harvest or end this batch
            </h2>
            <button
              type="button"
              className={crops.close}
              aria-label="Close"
              onClick={() => setDialog(undefined)}
            >
              <Icon name="close" size={22} />
            </button>
          </div>
          <p className={crops.muted}>It stays in the location’s history and frees the location.</p>
          <EndCropForm
            crop={batch}
            onDone={() => {
              setDialog(undefined);
              go({ level: 'zone', ...at });
            }}
          />
        </div>
      </Dialog>
    </>
  );
}

/**
 * Stages in order, the current one as people last set it. Lefi Brain keeps no date per stage, so
 * only the start, today and the expected harvest carry dates.
 */
function Timeline({ batch, day }: { batch: CropAssignment; day: number | undefined }) {
  const current = batch.growth_stage ? STAGES.indexOf(batch.growth_stage) : -1;
  const startStage = batch.start_event === 'transplanting' ? STAGES.indexOf('vegetative') : 0;
  return (
    <>
      <ol className={crops.timeline}>
        <li data-state="done">
          <span className={crops.tlDot} />
          <div className={crops.tlBody}>
            <span className={crops.titleBlock}>
              <b>{batch.start_event === 'sowing' ? 'Sown' : 'Transplanted'}</b>
              <span className={crops.faint}>Start of this batch</span>
            </span>
            <span className={crops.mono}>Day 0 · {batch.started_on}</span>
          </div>
        </li>
        {STAGES.map((s, i) => {
          if (batch.start_event === 'transplanting' && i < startStage && i !== current) return null;
          const state = current < 0 || i > current ? 'planned' : i < current ? 'done' : 'current';
          const when =
            state === 'current'
              ? day === undefined
                ? 'Now'
                : `Now · day ${day}`
              : s === 'harvest_ready' && batch.expected_harvest_on
                ? `Expected ${batch.expected_harvest_on}`
                : '';
          return (
            <li key={s} data-state={state}>
              <span className={crops.tlDot} />
              <div className={crops.tlBody}>
                <span className={crops.titleBlock}>
                  <b>{STAGE[s]}</b>
                  <span className={crops.faint}>
                    {state === 'done' ? 'Passed' : state === 'current' ? 'Current' : 'Planned'}
                  </span>
                </span>
                <span className={crops.mono}>{when}</span>
              </div>
            </li>
          );
        })}
      </ol>
      {current < 0 && (
        <p className={crops.faint}>Nobody has set the stage of this batch yet (Edit batch).</p>
      )}
    </>
  );
}
