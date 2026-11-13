import { useState } from 'react';
import {
  live,
  type CapacityUnit,
  type ContainerItem,
  type LocationKind,
  type PlaceStatus,
  type Places,
  type ZoneItem,
} from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { Button, Dialog, FormField, Icon, Select } from '../../shared/ui';
import { useLiveMutation } from './common';
import {
  HOLDS_PLANTS_ONLY,
  KIND,
  KIND_GROUPS,
  SIZE_KINDS,
  STATUS,
  SUBTYPES,
  UNIT,
  VOLUME_KINDS,
  countsPositions,
  locationName,
  suggestLocationCode,
  suggestedKinds,
} from './places';
import styles from './live.module.css';

/** "Bench 01 › Tray 02" for a location, from its zone's locations. */
export function locationPath(c: ContainerItem, all: ContainerItem[]): string {
  const byId = new Map(all.map((x) => [x.id, x]));
  const names: string[] = [];
  let node: ContainerItem | undefined = c;
  for (let i = 0; node && i < 10; i += 1) {
    names.unshift(locationName(node));
    node = node.parent_id ? byId.get(node.parent_id) : undefined;
  }
  return names.join(' › ');
}

function descendants(id: string, all: ContainerItem[]): Set<string> {
  const out = new Set<string>();
  let frontier = [id];
  while (frontier.length) {
    const next = all.filter((c) => c.parent_id && frontier.includes(c.parent_id) && !out.has(c.id));
    next.forEach((c) => out.add(c.id));
    frontier = next.map((c) => c.id);
  }
  return out;
}

/** The nearest Row above, whose reference a child inherits instead of typing it again. */
function rowAbove(parentId: string, all: ContainerItem[]): ContainerItem | undefined {
  const byId = new Map(all.map((x) => [x.id, x]));
  let node = byId.get(parentId);
  for (let i = 0; node && i < 10; i += 1) {
    if (node.kind === 'row') return node;
    node = node.parent_id ? byId.get(node.parent_id) : undefined;
  }
  return undefined;
}

const num = (s: string) => (s.trim() === '' ? null : Number(s));

/**
 * Step 2 of a greenhouse layout (ADR-066): a growing location in a zone, optionally inside another
 * one. It may stay empty; crops are assigned to it separately.
 */
export function LocationDialog({
  zone,
  zones,
  places,
  location,
  parentId,
  onClose,
}: {
  /** The zone it belongs to. When absent, the person picks one (`zones`). */
  zone?: ZoneItem;
  zones?: ZoneItem[];
  places: Places;
  location?: ContainerItem;
  /** Parent preselected for a new sub-location. */
  parentId?: string;
  onClose: () => void;
}) {
  const platform = usePlatform();
  const [zoneId, setZoneId] = useState(zone?.id ?? location?.zone_id ?? zones?.[0]?.id ?? '');
  const theZone = zone ?? zones?.find((z) => z.id === zoneId);
  const [f, setF] = useState({
    name: location?.name ?? '',
    code: location?.code ?? '',
    kind: location?.kind ?? ('' as LocationKind | ''),
    parent: location?.parent_id ?? parentId ?? '',
    row: location?.row ?? '',
    position: location?.position?.toString() ?? '',
    level: location?.level?.toString() ?? '',
    capacity: location?.capacity?.toString() ?? '',
    unit: location?.capacity_unit ?? ('' as CapacityUnit | ''),
    status: location?.status ?? ('active' as PlaceStatus),
    notes: location?.notes ?? '',
    subtype: location?.subtype ?? '',
    customKind: location?.custom_kind ?? '',
    volume: location?.volume_l?.toString() ?? '',
    length: location?.length_m?.toString() ?? '',
    width: location?.width_m?.toString() ?? '',
  });
  const [codeTouched, setCodeTouched] = useState(Boolean(location));
  const code = codeTouched ? f.code : suggestLocationCode(f.name);
  const inZone = places.containers.filter((c) => c.zone_id === zoneId);
  const excluded = location ? descendants(location.id, inZone).add(location.id) : new Set();
  const parents = inZone.filter((c) => !excluded.has(c.id) && !HOLDS_PLANTS_ONLY.has(c.kind));
  const inheritedRow = f.parent ? rowAbove(f.parent, inZone) : undefined;
  const kind = f.kind || undefined;
  const positions = kind ? countsPositions(kind, f.subtype) : false;
  const suggested = suggestedKinds(theZone?.growing_systems ?? []);

  const capacity = num(f.capacity);
  const unit: CapacityUnit | null = positions
    ? capacity === null
      ? null
      : 'planting_positions'
    : f.unit || null;
  const bad = (n: number | null, int = false) =>
    n !== null && (!(n > 0) || (int && !Number.isInteger(n)));
  const problems = [
    bad(capacity, true) && 'Capacity must be a whole number greater than 0.',
    capacity !== null && !unit && 'Choose the unit of the capacity.',
    unit !== null && capacity === null && 'Give the capacity for this unit.',
    bad(num(f.volume)) && 'The volume must be greater than 0.',
    (bad(num(f.length)) || bad(num(f.width))) && 'Length and width must be greater than 0.',
    kind === 'other' && !f.customKind.trim() && 'Name the type of this location.',
  ].filter(Boolean) as string[];

  const body = {
    name: f.name.trim(),
    code: code.trim(),
    kind: kind ?? 'other',
    parent_id: f.parent || null,
    row: inheritedRow ? null : f.row.trim() || null,
    position: num(f.position),
    level: num(f.level),
    capacity,
    capacity_unit: unit,
    status: f.status,
    notes: f.notes.trim() || null,
    subtype: kind && SUBTYPES[kind] ? f.subtype || null : null,
    custom_kind: kind === 'other' ? f.customKind.trim() || null : null,
    volume_l: kind && VOLUME_KINDS.has(kind) ? num(f.volume) : null,
    length_m: kind && SIZE_KINDS.has(kind) ? num(f.length) : null,
    width_m: kind && SIZE_KINDS.has(kind) ? num(f.width) : null,
  };
  const save = useLiveMutation(
    () =>
      location
        ? live.updateContainer(platform, location.id, body)
        : live.addContainer(platform, { zone_id: zoneId, ...body }),
    (c) => `${locationName(c)} saved`,
  );
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const title = location
    ? `Edit ${locationName(location)}`
    : `Add growing location to ${theZone?.name ?? 'a zone'}`;
  const ready =
    zoneId && f.name.trim() && code.trim() && kind && problems.length === 0 && !save.isPending;

  return (
    <Dialog open onClose={onClose} labelledBy="location-title" width={680}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined, { onSuccess: onClose });
        }}
      >
        <div className={styles.dialogHead}>
          <h2 id="location-title">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </div>
        <div className={styles.form}>
          <FormField label="Zone">
            {zone || location || !zones ? (
              <input value={theZone?.name ?? ''} readOnly aria-readonly="true" />
            ) : (
              <Select
                required
                value={zoneId}
                onChange={(e) => {
                  setZoneId(e.target.value);
                  setF({ ...f, parent: '' });
                }}
              >
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Type">
            <Select
              required
              value={f.kind}
              onChange={(e) => setF({ ...f, kind: e.target.value as LocationKind, subtype: '' })}
            >
              <option value="" disabled>
                Choose…
              </option>
              {KIND_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {[...g.kinds]
                    .sort((a, b) => Number(suggested.has(b)) - Number(suggested.has(a)))
                    .map((k) => (
                      <option key={k} value={k}>
                        {KIND[k]}
                        {suggested.has(k) ? ' — suggested for this zone' : ''}
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>
          </FormField>
          <FormField label="Name">
            <input
              required
              maxLength={64}
              placeholder="Bench 01, Tray 09, Pot 12"
              value={f.name}
              onChange={set('name')}
            />
          </FormField>
          <FormField label="Code (unique in the zone)">
            <input
              required
              maxLength={32}
              placeholder="BEN-01"
              value={code}
              onChange={(e) => {
                setCodeTouched(true);
                setF({ ...f, code: e.target.value });
              }}
            />
          </FormField>

          {kind && SUBTYPES[kind] && (
            <FormField label={`${KIND[kind]} type (optional)`}>
              <Select value={f.subtype} onChange={set('subtype')}>
                <option value="">Not specified</option>
                {Object.entries(SUBTYPES[kind]!).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
          )}
          {kind === 'other' && (
            <FormField label="Type name">
              <input
                required
                maxLength={32}
                placeholder="Vertical tower"
                value={f.customKind}
                onChange={set('customKind')}
              />
            </FormField>
          )}
          {kind && VOLUME_KINDS.has(kind) && (
            <FormField label="Volume (L, optional)">
              <input type="number" min={0} step="any" value={f.volume} onChange={set('volume')} />
            </FormField>
          )}
          {kind && SIZE_KINDS.has(kind) && (
            <>
              <FormField label="Length (m, optional)">
                <input type="number" min={0} step="any" value={f.length} onChange={set('length')} />
              </FormField>
              <FormField label="Width (m, optional)">
                <input type="number" min={0} step="any" value={f.width} onChange={set('width')} />
              </FormField>
            </>
          )}
          {positions ? (
            <FormField
              label={kind === 'tray' ? 'Cells (optional)' : 'Planting positions (optional)'}
            >
              <input type="number" min={1} step={1} value={f.capacity} onChange={set('capacity')} />
            </FormField>
          ) : null}

          <FormField label="Parent location (optional)" span={2}>
            <Select value={f.parent} onChange={set('parent')}>
              <option value="">None — directly in the zone</option>
              {parents.map((c) => (
                <option key={c.id} value={c.id}>
                  {locationPath(c, inZone)} ({c.code})
                </option>
              ))}
            </Select>
          </FormField>
          {inheritedRow ? (
            <FormField label="Row reference">
              <input
                readOnly
                aria-readonly="true"
                value={`Inherited from ${locationName(inheritedRow)}${inheritedRow.row ? ` (row ${inheritedRow.row})` : ''}`}
              />
            </FormField>
          ) : (
            <FormField label="Row reference (optional)">
              <input maxLength={8} placeholder="A" value={f.row} onChange={set('row')} />
            </FormField>
          )}
          <FormField label="Position (optional)">
            <input
              type="number"
              min={1}
              max={99999}
              step={1}
              placeholder="1"
              value={f.position}
              onChange={set('position')}
            />
          </FormField>
          <FormField label="Level (optional)">
            <input
              type="number"
              min={1}
              max={99}
              step={1}
              value={f.level}
              onChange={set('level')}
            />
          </FormField>
          {!positions && (
            <>
              <FormField label="Capacity (optional)">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={f.capacity}
                  onChange={set('capacity')}
                />
              </FormField>
              <FormField label="Capacity unit">
                <Select value={f.unit} onChange={set('unit')}>
                  <option value="">—</option>
                  {Object.entries(UNIT).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </Select>
              </FormField>
            </>
          )}
          <FormField label="Status">
            <Select value={f.status} onChange={set('status')}>
              {Object.entries(STATUS).map(([k, s]) => (
                <option key={k} value={k}>
                  {s.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Notes (optional)">
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
        <p className={styles.note}>
          {positions
            ? 'The cells or planting positions are this location’s capacity, in planting positions. '
            : ''}
          The same position may repeat under different parents; one parent, row, level and position
          identify a single location. The location can stay empty: assign a crop later.
        </p>
        <div className={styles.dialogFoot}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" icon="save" disabled={!ready}>
            {location ? 'Save' : 'Add growing location'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
