import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  live,
  liveQueries,
  type ContainerItem,
  type CropAssignment,
  type GrowthStage,
  type Places,
} from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { Button, Dialog, FormField, Icon, Select } from '../../shared/ui';
import { useLiveMutation } from './common';
import { STAGE, locationName } from './places';
import styles from './live.module.css';

/**
 * Assign a crop to a growing location, or edit an active one (ADR-066). A batch is made of the
 * registered plants of its zone and crop (ADR-082): people choose them, and Lefi Brain counts
 * them. Occupied positions are asked only where the location counts planting positions.
 */
export function CropDialog({
  location,
  places,
  crop,
  onClose,
}: {
  location: ContainerItem;
  places: Places;
  crop?: CropAssignment;
  onClose: () => void;
}) {
  const platform = usePlatform();
  const plants = useQuery(liveQueries.plants(platform));
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [f, setF] = useState({
    cropType: crop?.crop_type_id ?? '',
    variety: crop?.variety ?? '',
    batch: crop?.batch_code ?? '',
    occupied: crop?.occupied_positions?.toString() ?? '',
    started: crop?.started_on ?? '',
    event: crop?.start_event ?? '',
    stage: crop?.growth_stage ?? '',
    harvest: crop?.expected_harvest_on ?? '',
    notes: crop?.notes ?? '',
  });
  const tracksPositions =
    location.capacity_unit === 'planting_positions' && location.capacity !== null;
  // Plants that can be in this batch: its zone, its crop, in no other active batch.
  const eligible = (plants.data ?? []).filter(
    (p) =>
      p.zone_id === location.zone_id &&
      p.crop_type_id === (crop?.crop_type_id ?? f.cropType) &&
      (p.assignment_id === null || p.assignment_id === crop?.id),
  );
  const selected =
    chosen ??
    new Set(
      (plants.data ?? []).filter((p) => crop && p.assignment_id === crop.id).map((p) => p.id),
    );
  const picked = eligible.filter((p) => selected.has(p.id)).map((p) => p.id);
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
  };
  const occ = f.occupied.trim() === '' ? null : Number(f.occupied);
  const problems = [
    occ !== null &&
      !(Number.isInteger(occ) && occ > 0) &&
      'Occupied positions is a whole number greater than 0.',
    f.harvest &&
      f.started &&
      f.harvest < f.started &&
      'The expected harvest is before the start date.',
  ].filter(Boolean) as string[];
  const common = {
    variety: f.variety.trim() || null,
    batch_code: f.batch.trim() || null,
    plant_ids: picked,
    occupied_positions: tracksPositions ? occ : null,
    started_on: f.started,
    start_event: f.event as CropAssignment['start_event'],
    growth_stage: (f.stage || null) as GrowthStage | null,
    expected_harvest_on: f.harvest || null,
    notes: f.notes.trim() || null,
  };
  const save = useLiveMutation(
    () =>
      crop
        ? live.updateCropAssignment(platform, crop.id, common)
        : live.assignCrop(platform, {
            ...common,
            location_id: location.id,
            crop_type_id: f.cropType,
          }),
    (a) => `${a.plant_quantity} plants recorded in ${locationName(location)}`,
  );
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const ready =
    (crop || f.cropType) &&
    picked.length > 0 &&
    f.started &&
    f.event &&
    problems.length === 0 &&
    !save.isPending;
  return (
    <Dialog open onClose={onClose} labelledBy="crop-title" width={680}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined, { onSuccess: onClose });
        }}
      >
        <div className={styles.dialogHead}>
          <h2 id="crop-title">
            {crop ? 'Edit crop' : 'Assign crop'} · {locationName(location)}
          </h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </div>
        <div className={styles.form}>
          <FormField label="Crop">
            <Select required value={f.cropType} disabled={Boolean(crop)} onChange={set('cropType')}>
              <option value="" disabled>
                Choose…
              </option>
              {places.cropTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.variety ? ` · ${t.variety}` : ''}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Variety (optional)">
            <input maxLength={64} value={f.variety} onChange={set('variety')} />
          </FormField>
          <FormField label="Growing batch (optional)">
            <input
              maxLength={32}
              placeholder="LET-2026-11"
              value={f.batch}
              onChange={set('batch')}
            />
          </FormField>
          <FormField label={`Plants in this batch (${picked.length})`} span={2}>
            {!crop && !f.cropType ? (
              <p className={styles.note}>Choose the crop first.</p>
            ) : plants.isPending ? (
              <p className={styles.note}>Loading plants…</p>
            ) : eligible.length === 0 ? (
              <p className={styles.note}>
                No registered plant of this crop in this zone is free. Register the plants first
                (one by one, with their code); a batch is made of them.
              </p>
            ) : (
              <div className={styles.checkList} role="group" aria-label="Plants in this batch">
                {eligible.map((p) => (
                  <label key={p.id}>
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                    {p.name ? `${p.code} · ${p.name}` : p.code}
                  </label>
                ))}
              </div>
            )}
          </FormField>
          {tracksPositions && (
            <FormField label={`Occupied positions (optional, of ${location.capacity})`}>
              <input
                type="number"
                min={1}
                max={location.capacity ?? undefined}
                step={1}
                value={f.occupied}
                onChange={set('occupied')}
              />
            </FormField>
          )}
          <FormField label="Start date">
            <input required type="date" value={f.started} onChange={set('started')} />
          </FormField>
          <FormField label="The start date is the">
            <Select required value={f.event} onChange={set('event')}>
              <option value="" disabled>
                Choose…
              </option>
              <option value="sowing">Sowing</option>
              <option value="transplanting">Transplanting</option>
            </Select>
          </FormField>
          <FormField label="Growth stage (optional)">
            <Select value={f.stage} onChange={set('stage')}>
              <option value="">Not recorded</option>
              {Object.entries(STAGE).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Expected harvest (optional)">
            <input type="date" value={f.harvest} onChange={set('harvest')} />
          </FormField>
          <FormField label="Notes (optional)" span={2}>
            <input maxLength={500} value={f.notes} onChange={set('notes')} />
          </FormField>
        </div>
        {problems.length > 0 && (
          <ul className={styles.error}>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {places.cropTypes.length === 0 && (
          <p className={styles.note}>Add a crop type in Greenhouses &amp; Crops first.</p>
        )}
        <p className={styles.note}>
          The batch counts the registered plants chosen here; Lefi Brain keeps that number. A
          position or cell may hold more than one plant, so occupied positions are recorded
          separately. Recording a crop does not apply any control profile.
        </p>
        <div className={styles.dialogFoot}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" icon="save" disabled={!ready}>
            {crop ? 'Save' : 'Assign crop'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Harvest or end a crop: it stays as history and frees the location. */
export function EndCropForm({ crop, onDone }: { crop: CropAssignment; onDone?: () => void }) {
  const platform = usePlatform();
  const [f, setF] = useState({ on: '', reason: 'harvested' as 'harvested' | 'removed' });
  const end = useLiveMutation(
    () => live.endCropAssignment(platform, crop.id, { ended_on: f.on, reason: f.reason }),
    (a) => (a.end_reason === 'harvested' ? 'Harvest recorded' : 'Crop ended'),
  );
  return (
    <form
      className={styles.inline}
      onSubmit={(e) => {
        e.preventDefault();
        end.mutate(undefined, { onSuccess: onDone });
      }}
    >
      <select
        aria-label="How it ended"
        value={f.reason}
        onChange={(e) => setF({ ...f, reason: e.target.value as typeof f.reason })}
      >
        <option value="harvested">Harvested</option>
        <option value="removed">Ended without harvest</option>
      </select>
      <input
        aria-label="End date"
        type="date"
        min={crop.started_on}
        value={f.on}
        onChange={(e) => setF({ ...f, on: e.target.value })}
      />
      <Button size="sm" type="submit" disabled={!f.on || end.isPending}>
        Record
      </Button>
    </form>
  );
}
