import { useState } from 'react';
import {
  live,
  type ClimateControl,
  type GrowingSystem,
  type PlaceStatus,
  type Places,
  type ZoneItem,
  type ZonePurpose,
} from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { Button, Dialog, FormField, Icon, Select } from '../../shared/ui';
import { useLiveMutation } from './common';
import { CLIMATE, PURPOSE, STATUS, SYSTEM, suggestZoneCode } from './places';
import styles from './live.module.css';

const SYSTEMS = Object.keys(SYSTEM) as GrowingSystem[];

/**
 * Step 1 of a greenhouse layout (ADR-066): a zone with its basic information. Nothing here asks for
 * sensors, robots, species or plant counts — a zone exists before any of them.
 */
export function ZoneDialog({
  places,
  zone,
  greenhouseId,
  onClose,
  onSaved,
}: {
  places: Places;
  /** Editing this zone; absent = a new zone. */
  zone?: ZoneItem;
  /** Greenhouse preselected for a new zone. */
  greenhouseId?: string;
  onClose: () => void;
  onSaved?: (z: ZoneItem) => void;
}) {
  const platform = usePlatform();
  const [f, setF] = useState({
    greenhouse: zone?.greenhouse_id ?? greenhouseId ?? places.greenhouses[0]?.id ?? '',
    name: zone?.name ?? '',
    code: zone?.code ?? '',
    purpose: (zone?.purpose ?? '') as ZonePurpose | '',
    purposeOther: zone?.purpose_other ?? '',
    systems: zone?.growing_systems ?? ([] as GrowingSystem[]),
    notes: zone?.notes ?? '',
    area: zone?.area_m2?.toString() ?? '',
    ref: zone?.physical_ref ?? '',
    climate: zone?.climate_control ?? ('not_configured' as ClimateControl),
    status: zone?.status ?? ('active' as PlaceStatus),
  });
  // The code follows the name until the person types one.
  const [codeTouched, setCodeTouched] = useState(Boolean(zone?.code));
  const code = codeTouched ? f.code : suggestZoneCode(f.name);
  const area = f.area.trim() === '' ? null : Number(f.area);
  const areaBad = area !== null && !(area > 0);
  const body = {
    name: f.name.trim(),
    code: code.trim(),
    purpose: f.purpose || undefined,
    purpose_other: f.purpose === 'other' ? f.purposeOther.trim() || null : null,
    growing_systems: f.systems,
    notes: f.notes.trim() || null,
    area_m2: area,
    physical_ref: f.ref.trim() || null,
    climate_control: f.climate,
    status: f.status,
  };
  const save = useLiveMutation(
    () =>
      zone
        ? live.updateZone(platform, zone.id, body)
        : live.addZone(platform, {
            ...body,
            greenhouse_id: f.greenhouse,
            purpose: f.purpose as ZonePurpose,
          }),
    (z) => (zone ? `${z.name} saved` : `${z.name} created`),
  );
  const toggle = (s: GrowingSystem, on: boolean) => {
    let next = on ? [...f.systems, s] : f.systems.filter((x) => x !== s);
    // "Not configured yet" excludes every other system.
    if (on) next = s === 'not_configured' ? [s] : next.filter((x) => x !== 'not_configured');
    setF({ ...f, systems: next });
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const ready =
    f.greenhouse && f.name.trim() && code.trim() && f.purpose && !areaBad && !save.isPending;
  return (
    <Dialog open onClose={onClose} labelledBy="zone-title" width={680}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined, {
            onSuccess: (z) => {
              onSaved?.(z);
              onClose();
            },
          });
        }}
      >
        <div className={styles.dialogHead}>
          <h2 id="zone-title">{zone ? `Edit ${zone.name}` : 'Add zone'}</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </div>
        <fieldset className={styles.group}>
          <legend>Identification and use</legend>
          <div className={styles.form}>
            <FormField label="Greenhouse">
              <Select
                required
                value={f.greenhouse}
                disabled={Boolean(zone)}
                onChange={set('greenhouse')}
              >
                {places.greenhouses.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Zone name">
              <input
                required
                maxLength={64}
                placeholder="Zona A, Propagation North"
                value={f.name}
                onChange={set('name')}
              />
            </FormField>
            <FormField label="Zone code (unique in the greenhouse)">
              <input
                required
                maxLength={16}
                placeholder="ZA"
                value={code}
                onChange={(e) => {
                  setCodeTouched(true);
                  setF({ ...f, code: e.target.value });
                }}
              />
            </FormField>
            <FormField label="Purpose (main use)">
              <Select required value={f.purpose} onChange={set('purpose')}>
                <option value="" disabled>
                  Choose…
                </option>
                {Object.entries(PURPOSE).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
            {f.purpose === 'other' && (
              <FormField label="Describe the purpose (optional)" span={2}>
                <input maxLength={64} value={f.purposeOther} onChange={set('purposeOther')} />
              </FormField>
            )}
          </div>
          <div className={styles.systems} role="group" aria-label="Growing systems">
            <span className={styles.muted}>Growing systems (optional, one or more)</span>
            {SYSTEMS.map((s) => (
              <label key={s} className={styles.checkInline}>
                <input
                  type="checkbox"
                  checked={f.systems.includes(s)}
                  onChange={(e) => toggle(s, e.target.checked)}
                />
                {SYSTEM[s]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className={styles.group}>
          <legend>Optional details</legend>
          <div className={styles.form}>
            <FormField label="Area (m²)">
              <input
                type="number"
                min={0}
                step="any"
                value={f.area}
                aria-invalid={areaBad || undefined}
                onChange={set('area')}
              />
            </FormField>
            <FormField label="Physical reference">
              <input
                maxLength={128}
                placeholder="North side, beside entrance 2"
                value={f.ref}
                onChange={set('ref')}
              />
            </FormField>
            <FormField label="Description / notes" span={2}>
              <input maxLength={500} value={f.notes} onChange={set('notes')} />
            </FormField>
          </div>
          {areaBad && <p className={styles.error}>The area must be greater than 0.</p>}
        </fieldset>
        <fieldset className={styles.group}>
          <legend>Control and status</legend>
          <div className={styles.form}>
            <FormField label="Climate control">
              <Select value={f.climate} onChange={set('climate')}>
                {Object.entries(CLIMATE).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Status">
              <Select value={f.status} onChange={set('status')}>
                {Object.entries(STATUS).map(([k, s]) => (
                  <option key={k} value={k}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        </fieldset>
        <p className={styles.note}>
          Climate control is a description: choosing Independent configures no equipment and does
          not prove the zone is climatically separate.
        </p>
        <div className={styles.dialogFoot}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" icon="save" disabled={!ready}>
            {zone ? 'Save' : 'Create zone'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
