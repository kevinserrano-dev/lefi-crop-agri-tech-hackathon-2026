import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  live,
  liveQueries,
  type ContainerItem,
  type CropAssignment,
  type FieldDevice,
  type InventoryCategory,
  type InventoryItem,
  type Places,
  type ZoneItem,
} from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  FormField,
  Icon,
  ProvenanceBadge,
  Select,
  Skeleton,
  type Column,
} from '../../shared/ui';
import { useCan } from '../session';
import { ConfirmButton, ConnectionBadge, useLiveMutation, usePlaces } from './common';
import { CropDialog, EndCropForm } from './CropDialog';
import { LocationDialog, locationPath } from './LocationDialog';
import {
  CLIMATE,
  HOLDS_PLANTS_ONLY,
  OCCUPANCY,
  PURPOSE,
  STAGE,
  STATUS,
  SYSTEM,
  UNIT,
  cropLabel,
  kindLabel,
  locationName,
  zoneSummaryText,
} from './places';
import { ZoneDialog } from './ZoneDialog';
import styles from './live.module.css';

const CATEGORY: Record<InventoryCategory, string> = {
  equipment: 'Equipment',
  tool: 'Tool',
  supply: 'Supply',
  spare_part: 'Spare part',
  other: 'Other',
};

const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, ''));

type PlantRecord = { zone_id: string; container_id: string | null; assignment_id: string | null };

/**
 * Zones & Inventory against the real Lefi Brain (ADR-064, ADR-066). Set up a greenhouse in two
 * steps: (1) a zone with its basic information, (2) its growing locations — benches, rows, trays,
 * pots, NFT channels, ponds… — optionally nested. Crops are assigned to a location for a while and
 * their history is kept. Every count comes from Lefi Brain; nothing is estimated here.
 */
export function ZonesLive() {
  const platform = usePlatform();
  const canManage = useCan('zone.manage');
  const places = usePlaces();
  const plants = useQuery(liveQueries.plants(platform));
  const items = useQuery(liveQueries.inventory(platform));
  const [selected, setSelected] = useState<string>();
  const p = places.data;

  if (places.isError || items.isError) {
    return (
      <EmptyState mascot="sad" title="Could not load the zones">
        {describeError(places.error ?? items.error)}
      </EmptyState>
    );
  }
  if (!p || items.isPending) return <Skeleton height={320} />;

  const current = p.zones.find((z) => z.id === selected) ?? p.zones[0];
  return (
    <>
      <div className={styles.toolbar}>
        <span className={styles.muted}>
          Greenhouse → zone → growing location → sub-location (optional). Create the zone first,
          then add its growing locations; assign crops to them when they are planted.
        </span>
      </div>
      <div className={styles.layout}>
        <div className={styles.places}>
          {current ? (
            <ZoneDetail
              key={current.id}
              zone={current}
              places={p}
              plants={plants.data ?? []}
              items={(items.data ?? []).filter((i) => i.zone_id === current.id)}
              canManage={canManage}
              onRemoved={() => setSelected(undefined)}
            />
          ) : (
            <EmptyState mascot="curious" title="No zones yet" compact>
              {canManage
                ? 'Create a greenhouse, then use “Add zone” on the right.'
                : 'A greenhouse manager creates the zones.'}
            </EmptyState>
          )}
        </div>
        <ZoneList
          places={p}
          items={items.data ?? []}
          current={current?.id}
          onSelect={setSelected}
          canManage={canManage}
        />
      </div>
    </>
  );
}

function ZoneList({
  places,
  items,
  current,
  onSelect,
  canManage,
}: {
  places: Places;
  items: InventoryItem[];
  current?: string;
  onSelect: (id: string) => void;
  canManage: boolean;
}) {
  const platform = usePlatform();
  const [gh, setGh] = useState('');
  const [adding, setAdding] = useState<string>();
  const addGh = useLiveMutation(
    (n: string) => live.addGreenhouse(platform, n),
    (g) => `${g.name} created`,
  );
  const removeGh = useLiveMutation(
    (id: string) => live.removeGreenhouse(platform, id),
    () => 'Greenhouse removed',
  );
  return (
    <div className={styles.places}>
      {places.greenhouses.map((g) => {
        const zones = places.zones.filter((z) => z.greenhouse_id === g.id);
        return (
          <Card
            key={g.id}
            title={g.name}
            subtitle="Greenhouse"
            actions={
              canManage ? (
                <span className={styles.assign}>
                  <Button size="sm" icon="add" onClick={() => setAdding(g.id)}>
                    Add zone
                  </Button>
                  {zones.length === 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="delete"
                      aria-label={`Remove ${g.name}`}
                      onClick={() => removeGh.mutate(g.id)}
                    />
                  )}
                </span>
              ) : undefined
            }
          >
            <ul className={styles.placeList}>
              {zones.map((z) => {
                const low = items.filter((i) => i.zone_id === z.id && i.low).length;
                return (
                  <li key={z.id}>
                    <Button
                      size="sm"
                      variant={z.id === current ? 'primary' : 'ghost'}
                      onClick={() => onSelect(z.id)}
                      aria-pressed={z.id === current}
                    >
                      {z.name}
                      {z.code ? ` · ${z.code}` : ''}
                    </Button>
                    <span className={styles.assign}>
                      <span className={styles.muted}>{zoneSummaryText(z.summary)}</span>
                      {z.status !== 'active' && (
                        <Badge tone={STATUS[z.status].tone} variant="tag">
                          {STATUS[z.status].label}
                        </Badge>
                      )}
                      {low > 0 && (
                        <Badge tone="warn" variant="tag" title="Inventory below its minimum">
                          {low} low
                        </Badge>
                      )}
                    </span>
                  </li>
                );
              })}
              {zones.length === 0 && <li className={styles.muted}>No zones yet.</li>}
            </ul>
          </Card>
        );
      })}
      {canManage && (
        <Card title="New greenhouse">
          <form
            className={styles.inline}
            onSubmit={(e) => {
              e.preventDefault();
              addGh.mutate(gh, { onSuccess: () => setGh('') });
            }}
          >
            <input
              aria-label="Greenhouse name"
              placeholder="Greenhouse name"
              value={gh}
              onChange={(e) => setGh(e.target.value)}
            />
            <Button size="sm" type="submit" disabled={!gh.trim()}>
              Add
            </Button>
          </form>
        </Card>
      )}
      {adding && (
        <ZoneDialog
          places={places}
          greenhouseId={adding}
          onClose={() => setAdding(undefined)}
          onSaved={(z) => onSelect(z.id)}
        />
      )}
    </div>
  );
}

function ZoneDetail({
  zone,
  places,
  plants,
  items,
  canManage,
  onRemoved,
}: {
  zone: ZoneItem;
  places: Places;
  plants: PlantRecord[];
  items: InventoryItem[];
  canManage: boolean;
  onRemoved: () => void;
}) {
  const platform = usePlatform();
  const [editing, setEditing] = useState(false);
  const [more, setMore] = useState(false);
  const remove = useLiveMutation(
    () => live.removeZone(platform, zone.id),
    () => `${zone.name} removed`,
  );
  const greenhouse = places.greenhouses.find((g) => g.id === zone.greenhouse_id)?.name;
  const systems = zone.growing_systems.map((s) => SYSTEM[s]).join(', ');
  const purpose = zone.purpose
    ? `${PURPOSE[zone.purpose]}${zone.purpose_other ? ` — ${zone.purpose_other}` : ''}`
    : 'Not configured';
  return (
    <>
      <Card
        title={zone.name}
        subtitle={greenhouse ? `Zone in ${greenhouse}` : 'Zone'}
        actions={
          canManage ? (
            <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(true)}>
              Edit zone
            </Button>
          ) : undefined
        }
      >
        <dl className={styles.facts}>
          <div>
            <dt>Code</dt>
            <dd>{zone.code ?? <span className={styles.muted}>Not set</span>}</dd>
          </div>
          <div>
            <dt>Purpose</dt>
            <dd>{purpose}</dd>
          </div>
          <div>
            <dt>Growing systems</dt>
            <dd>{systems || 'Not configured'}</dd>
          </div>
          {zone.area_m2 !== null && (
            <div>
              <dt>Area</dt>
              <dd>{fmtQty(zone.area_m2)} m²</dd>
            </div>
          )}
          <div>
            <dt>Status</dt>
            <dd>
              <Badge tone={STATUS[zone.status].tone} variant="tag">
                {STATUS[zone.status].label}
              </Badge>
            </dd>
          </div>
        </dl>
        <p className={styles.muted}>{zoneSummaryText(zone.summary)}</p>
        {more && (
          <dl className={styles.facts}>
            <div>
              <dt>Climate control</dt>
              <dd>{CLIMATE[zone.climate_control]}</dd>
            </div>
            <div>
              <dt>Physical reference</dt>
              <dd>{zone.physical_ref ?? '—'}</dd>
            </div>
            <div>
              <dt>Notes</dt>
              <dd>{zone.notes ?? '—'}</dd>
            </div>
          </dl>
        )}
        <div className={styles.actions}>
          <Button size="sm" variant="link" onClick={() => setMore(!more)}>
            {more ? 'Fewer details' : 'More details'}
          </Button>
          {canManage && (
            <ConfirmButton
              label="Remove zone"
              icon="delete"
              confirm="Only an empty zone can be removed."
              onConfirm={() => remove.mutate(undefined, { onSuccess: onRemoved })}
            />
          )}
        </div>
      </Card>
      <Card title="Growing locations" subtitle="Where crops grow in this zone">
        <Locations zone={zone} places={places} plants={plants} canManage={canManage} />
      </Card>
      <ZoneDevices zone={zone} />
      <Inventory zone={zone} items={items} canManage={canManage} />
      {editing && <ZoneDialog places={places} zone={zone} onClose={() => setEditing(false)} />}
    </>
  );
}

type Row = { loc: ContainerItem; depth: number; hasChildren: boolean };

/** Depth-first order of a zone's locations, skipping the children of collapsed ones. */
function flatten(all: ContainerItem[], collapsed: Set<string>): Row[] {
  const ids = new Set(all.map((c) => c.id));
  const kids = new Map<string | null, ContainerItem[]>();
  for (const c of all) {
    const key = c.parent_id && ids.has(c.parent_id) ? c.parent_id : null;
    kids.set(key, [...(kids.get(key) ?? []), c]);
  }
  const out: Row[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const c of kids.get(parent) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const hasChildren = (kids.get(c.id) ?? []).length > 0;
      out.push({ loc: c, depth, hasChildren });
      if (hasChildren && !collapsed.has(c.id)) walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function where(c: ContainerItem): string {
  const parts = [
    c.row ? `row ${c.row}` : '',
    c.level !== null ? `level ${c.level}` : '',
    c.position !== null ? `pos. ${c.position}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function Occupancy({ loc }: { loc: ContainerItem }) {
  const s = loc.summary;
  if (!s) return null;
  const parts: string[] = [];
  if (s.plants_total > 0) {
    parts.push(
      s.plants_total === s.plants
        ? `${s.plants} plants`
        : `${s.plants_total} plants incl. sub-locations`,
    );
  }
  if (loc.capacity !== null && loc.capacity_unit === 'planting_positions') {
    parts.push(
      s.occupied_positions !== null
        ? `${s.occupied_positions}/${loc.capacity} positions occupied`
        : `${loc.capacity} positions`,
    );
  } else if (loc.capacity !== null && loc.capacity_unit) {
    parts.push(`${s.filled ?? 0}/${loc.capacity} ${UNIT[loc.capacity_unit].toLowerCase()}`);
  }
  return (
    <span className={styles.assign}>
      <span>{parts.join(' · ') || <span className={styles.muted}>—</span>}</span>
      {s.occupancy && (
        <Badge tone={OCCUPANCY[s.occupancy].tone} variant="tag">
          {OCCUPANCY[s.occupancy].label}
        </Badge>
      )}
    </span>
  );
}

function Locations({
  zone,
  places,
  plants,
  canManage,
}: {
  zone: ZoneItem;
  places: Places;
  plants: PlantRecord[];
  canManage: boolean;
}) {
  const platform = usePlatform();
  const canCrops = useCan('batch.edit');
  const [dialog, setDialog] = useState<
    | { kind: 'location'; location?: ContainerItem; parentId?: string }
    | { kind: 'crop'; location: ContainerItem; crop?: CropAssignment }
  >();
  const [open, setOpen] = useState<string>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const crops = useQuery(liveQueries.crops(platform));
  const remove = useLiveMutation(
    (c: ContainerItem) => live.removeContainer(platform, c.id),
    () => 'Growing location removed',
  );
  const all = places.containers.filter((c) => c.zone_id === zone.id);
  const rows = flatten(all, collapsed);
  const cropName = new Map(
    places.cropTypes.map((t) => [t.id, t.variety ? `${t.name} · ${t.variety}` : t.name]),
  );
  const activeHere = (id: string) => (crops.data ?? []).filter((a) => a.location_id === id);
  const toggle = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: 'Location',
      width: '1.6fr',
      render: ({ loc, depth, hasChildren }) => (
        <span className={styles.treeCell} style={{ paddingLeft: depth * 18 }}>
          {hasChildren ? (
            <button
              type="button"
              className={styles.treeToggle}
              aria-expanded={!collapsed.has(loc.id)}
              aria-label={`${collapsed.has(loc.id) ? 'Expand' : 'Collapse'} ${locationName(loc)}`}
              onClick={(e) => {
                e.stopPropagation();
                toggle(loc.id);
              }}
            >
              {collapsed.has(loc.id) ? '▸' : '▾'}
            </button>
          ) : (
            <span className={styles.treeToggle} aria-hidden="true" />
          )}
          <span>
            <b>{locationName(loc)}</b> <span className={styles.mono}>{loc.code}</span>
          </span>
        </span>
      ),
    },
    { key: 'kind', header: 'Type', width: '0.9fr', render: ({ loc }) => kindLabel(loc) },
    {
      key: 'where',
      header: 'Where',
      width: '0.9fr',
      render: ({ loc }) => where(loc) || <span className={styles.muted}>—</span>,
    },
    {
      key: 'crop',
      header: 'Crop',
      width: '1fr',
      render: ({ loc }) => {
        const here = activeHere(loc.id);
        return here.length ? (
          here.map((a) => cropLabel(a, cropName)).join(', ')
        ) : (
          <span className={styles.muted}>—</span>
        );
      },
    },
    {
      key: 'occ',
      header: 'Plants / occupancy',
      width: '1.3fr',
      render: ({ loc }) => <Occupancy loc={loc} />,
    },
    {
      key: 'status',
      header: 'Status',
      width: '0.8fr',
      render: ({ loc }) => (
        <Badge tone={STATUS[loc.status].tone} variant="tag">
          {STATUS[loc.status].label}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '1.5fr',
      render: ({ loc }) => (
        <span className={styles.assign}>
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={open === loc.id}
            onClick={() => setOpen(open === loc.id ? undefined : loc.id)}
          >
            Details
          </Button>
          {canManage && (
            <Button
              size="sm"
              variant="ghost"
              icon="edit"
              aria-label={`Edit ${locationName(loc)}`}
              onClick={() => setDialog({ kind: 'location', location: loc })}
            />
          )}
          {canCrops && loc.status !== 'inactive' && (
            <Button
              size="sm"
              variant="ghost"
              icon="add"
              onClick={() => setDialog({ kind: 'crop', location: loc })}
            >
              Assign crop
            </Button>
          )}
        </span>
      ),
    },
  ];
  const opened = all.find((c) => c.id === open);
  return (
    <>
      <div className={styles.sectionHead}>
        <span className={styles.muted}>
          {all.length === 0
            ? 'No growing locations yet.'
            : `${all.length} growing ${all.length === 1 ? 'location' : 'locations'}`}
        </span>
        {canManage && (
          <Button size="sm" icon="add" onClick={() => setDialog({ kind: 'location' })}>
            Add growing location
          </Button>
        )}
      </div>
      {all.length === 0 ? (
        <p className={styles.muted}>
          Add benches, rows, beds, pots, trays, NFT channels or ponds. A location can stay empty
          until a crop is assigned to it.
        </p>
      ) : (
        <DataTable
          label={`Growing locations in ${zone.name}`}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.loc.id}
          selectedKey={open}
          minWidth={860}
        />
      )}
      {opened && (
        <LocationDetails
          key={opened.id}
          location={opened}
          all={all}
          places={places}
          plants={plants}
          canManage={canManage}
          canCrops={canCrops}
          onAddInside={() => setDialog({ kind: 'location', parentId: opened.id })}
          onEditCrop={(crop) => setDialog({ kind: 'crop', location: opened, crop })}
          onRemove={() => remove.mutate(opened, { onSuccess: () => setOpen(undefined) })}
        />
      )}
      {dialog?.kind === 'location' && (
        <LocationDialog
          zone={zone}
          places={places}
          location={dialog.location}
          parentId={dialog.parentId}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === 'crop' && (
        <CropDialog
          location={dialog.location}
          places={places}
          crop={dialog.crop}
          onClose={() => setDialog(undefined)}
        />
      )}
    </>
  );
}

function LocationDetails({
  location,
  all,
  places,
  plants,
  canManage,
  canCrops,
  onAddInside,
  onEditCrop,
  onRemove,
}: {
  location: ContainerItem;
  all: ContainerItem[];
  places: Places;
  plants: PlantRecord[];
  canManage: boolean;
  canCrops: boolean;
  onAddInside: () => void;
  onEditCrop: (crop: CropAssignment) => void;
  onRemove: () => void;
}) {
  const platform = usePlatform();
  const history = useQuery(liveQueries.cropHistory(platform, location.id));
  const [ending, setEnding] = useState<string>();
  const cropName = new Map(
    places.cropTypes.map((t) => [t.id, t.variety ? `${t.name} · ${t.variety}` : t.name]),
  );
  // Registered plants here that no crop batch holds yet (ADR-082).
  const tracked = plants.filter(
    (p) => p.container_id === location.id && p.assignment_id === null,
  ).length;
  const facts: [string, string][] = [
    ['Path', locationPath(location, all)],
    ['Type', kindLabel(location)],
    ['Where', where(location) || '—'],
    [
      'Capacity',
      location.capacity !== null && location.capacity_unit
        ? `${location.capacity} ${UNIT[location.capacity_unit].toLowerCase()}`
        : '—',
    ],
  ];
  if (location.volume_l !== null) facts.push(['Volume', `${fmtQty(location.volume_l)} L`]);
  if (location.length_m !== null || location.width_m !== null)
    facts.push([
      'Size',
      `${location.length_m !== null ? fmtQty(location.length_m) : '?'} × ${location.width_m !== null ? fmtQty(location.width_m) : '?'} m`,
    ]);
  if (location.notes) facts.push(['Notes', location.notes]);
  const active = (history.data ?? []).filter((a) => a.status === 'active');
  const ended = (history.data ?? []).filter((a) => a.status === 'ended');
  const describe = (a: CropAssignment) =>
    [
      `${a.plant_quantity} plants`,
      a.occupied_positions !== null ? `${a.occupied_positions} positions` : '',
      `${a.start_event === 'sowing' ? 'sown' : 'transplanted'} ${a.started_on}`,
      a.growth_stage ? STAGE[a.growth_stage] : '',
      a.expected_harvest_on ? `harvest expected ${a.expected_harvest_on}` : '',
      a.batch_code ? `batch ${a.batch_code}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <div className={styles.sensor}>
      <div className={styles.sensorHead}>
        <span>
          <b>{locationName(location)}</b> <span className={styles.mono}>{location.code}</span>
        </span>
        <span className={styles.assign}>
          {canManage && !HOLDS_PLANTS_ONLY.has(location.kind) && (
            <Button size="sm" variant="ghost" icon="add" onClick={onAddInside}>
              Add sub-location
            </Button>
          )}
          {canManage && (
            <Button size="sm" variant="ghost" icon="delete" onClick={onRemove}>
              Remove
            </Button>
          )}
        </span>
      </div>
      <dl className={styles.facts}>
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <h4 className={styles.subhead}>Active crops</h4>
      {history.isPending ? (
        <Skeleton height={40} />
      ) : active.length === 0 ? (
        <p className={styles.muted}>No active crop. This location is free.</p>
      ) : (
        <ul className={styles.placeList}>
          {active.map((a) => (
            <Fragment key={a.id}>
              <li>
                <span>
                  <b>{cropLabel(a, cropName)}</b>{' '}
                  <span className={styles.muted}>{describe(a)}</span>
                </span>
                {canCrops && (
                  <span className={styles.assign}>
                    <Button size="sm" variant="ghost" icon="edit" onClick={() => onEditCrop(a)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEnding(ending === a.id ? undefined : a.id)}
                    >
                      Harvest / end
                    </Button>
                  </span>
                )}
              </li>
              {ending === a.id && (
                <li>
                  <EndCropForm crop={a} onDone={() => setEnding(undefined)} />
                </li>
              )}
            </Fragment>
          ))}
        </ul>
      )}
      {ended.length > 0 && (
        <>
          <h4 className={styles.subhead}>History</h4>
          <ul className={styles.placeList}>
            {ended.map((a) => (
              <li key={a.id}>
                <span>
                  {cropLabel(a, cropName)} <span className={styles.muted}>{describe(a)}</span>
                </span>
                <span className={styles.muted}>
                  {a.end_reason === 'harvested' ? 'Harvested' : 'Ended'} {a.ended_on}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {tracked > 0 && (
        <p className={styles.muted}>
          {tracked} registered {tracked === 1 ? 'plant is' : 'plants are'} here in no crop batch
          yet: assign a crop to add {tracked === 1 ? 'it' : 'them'} to a batch.
        </p>
      )}
    </div>
  );
}

/** ESP32 nodes that serve this zone (ADR-083): their sensors can measure here. */
function ZoneDevices({ zone }: { zone: ZoneItem }) {
  const platform = usePlatform();
  const canSee = useCan('nav.devices');
  const canPlace = useCan('device.manage');
  const devices = useQuery({ ...liveQueries.devices(platform), enabled: canSee });
  const [pick, setPick] = useState('');
  const place = useLiveMutation(
    ({ d, add }: { d: FieldDevice; add: boolean }) =>
      live.updateDevice(
        platform,
        d.id,
        add
          ? { zone_ids: [...d.zone_ids, zone.id] }
          : {
              zone_ids: d.zone_ids.filter((z) => z !== zone.id),
              ...(d.zone_id === zone.id ? { zone_id: null } : {}),
            },
      ),
    (d) =>
      d.zone_ids.includes(zone.id)
        ? `${d.name} now serves ${zone.name}`
        : `${d.name} no longer serves ${zone.name}`,
  );
  if (!canSee) return null;
  const all = (devices.data ?? []).filter((d) => d.status !== 'RETIRED');
  const here = all.filter((d) => d.zone_ids.includes(zone.id));
  const others = all.filter((d) => !d.zone_ids.includes(zone.id));
  return (
    <Card title="Devices in this zone" subtitle="ESP32 nodes that serve this zone">
      {devices.isPending ? (
        <Skeleton height={60} />
      ) : here.length === 0 ? (
        <p className={styles.muted}>No device serves this zone.</p>
      ) : (
        <ul className={styles.placeList}>
          {here.map((d: FieldDevice) => (
            <li key={d.id}>
              <span>
                <b>{d.name}</b> <span className={styles.mono}>{d.id}</span>
                {d.zone_id === zone.id && <span className={styles.muted}> · installed here</span>}
              </span>
              <span className={styles.assign}>
                {d.origin === 'SIMULATED' && <ProvenanceBadge origin="SIMULATED" />}
                <ConnectionBadge connection={d.connection} />
                {canPlace && (
                  <Button size="sm" variant="ghost" onClick={() => place.mutate({ d, add: false })}>
                    Take out
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canPlace && others.length > 0 && (
        <form
          className={styles.inline}
          onSubmit={(e) => {
            e.preventDefault();
            const d = others.find((o) => o.id === pick) ?? others[0]!;
            place.mutate({ d, add: true }, { onSuccess: () => setPick('') });
          }}
        >
          <select
            aria-label="Device to serve this zone"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
          >
            {others.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.id}){d.zone_ids.length ? ' · also serves other zones' : ''}
              </option>
            ))}
          </select>
          <Button size="sm" type="submit" disabled={place.isPending}>
            Add to this zone
          </Button>
        </form>
      )}
    </Card>
  );
}

function Inventory({
  zone,
  items,
  canManage,
}: {
  zone: ZoneItem;
  items: InventoryItem[];
  canManage: boolean;
}) {
  const platform = usePlatform();
  const [editing, setEditing] = useState<InventoryItem | 'new'>();
  const remove = useLiveMutation(
    (i: InventoryItem) => live.removeInventoryItem(platform, i.id),
    () => 'Removed from the inventory',
  );
  const columns: Column<InventoryItem>[] = [
    {
      key: 'name',
      header: 'Item',
      width: '1.4fr',
      render: (i) => (
        <span title={i.notes ?? undefined}>
          <b>{i.name}</b>
        </span>
      ),
    },
    { key: 'cat', header: 'Category', width: '0.9fr', render: (i) => CATEGORY[i.category] },
    {
      key: 'qty',
      header: 'Quantity',
      width: '1fr',
      render: (i) => (
        <span className={styles.assign}>
          {fmtQty(i.quantity)} {i.unit ?? ''}
          {i.low && (
            <Badge
              tone="warn"
              variant="tag"
              title={`Below the minimum of ${fmtQty(i.min_quantity ?? 0)}`}
            >
              Low
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'min',
      header: 'Minimum',
      width: '0.7fr',
      render: (i) => (i.min_quantity === null ? '—' : fmtQty(i.min_quantity)),
    },
  ];
  if (canManage)
    columns.push({
      key: 'edit',
      header: '',
      width: '1.1fr',
      render: (i) => (
        <span className={styles.assign}>
          <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(i)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="delete"
            aria-label={`Remove ${i.name}`}
            onClick={() => remove.mutate(i)}
          />
        </span>
      ),
    });
  return (
    <Card
      title="Inventory"
      subtitle="Counted by people; nothing here is measured or controlled"
      actions={
        canManage ? (
          <Button size="sm" icon="add" onClick={() => setEditing('new')}>
            Add item
          </Button>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <p className={styles.muted}>
          Nothing recorded in this zone. Examples: substrate bags, nutrient bottles, seed packets,
          trays, spare sensors and cables, tools, lamps or fans in storage.
        </p>
      ) : (
        <DataTable
          label={`Inventory in ${zone.name}`}
          columns={columns}
          rows={items}
          rowKey={(i) => i.id}
          minWidth={520}
        />
      )}
      {editing && (
        <ItemDialog
          zone={zone}
          item={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(undefined)}
        />
      )}
    </Card>
  );
}

function ItemDialog({
  zone,
  item,
  onClose,
}: {
  zone: ZoneItem;
  item?: InventoryItem;
  onClose: () => void;
}) {
  const platform = usePlatform();
  const [f, setF] = useState({
    name: item?.name ?? '',
    category: item?.category ?? ('supply' as InventoryCategory),
    quantity: item ? fmtQty(item.quantity) : '',
    unit: item?.unit ?? '',
    min: item?.min_quantity === null || !item ? '' : fmtQty(item.min_quantity),
    notes: item?.notes ?? '',
  });
  const body = {
    name: f.name.trim(),
    category: f.category,
    quantity: Number(f.quantity),
    unit: f.unit.trim() || null,
    min_quantity: f.min === '' ? null : Number(f.min),
    notes: f.notes.trim() || null,
  };
  const save = useLiveMutation(
    () =>
      item
        ? live.updateInventoryItem(platform, item.id, body)
        : live.addInventoryItem(platform, { zone_id: zone.id, ...body }),
    (i) => `${i.name}: ${fmtQty(i.quantity)} ${i.unit ?? ''}`.trim(),
  );
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open onClose={onClose} labelledBy="item-title" width={600}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined, { onSuccess: onClose });
        }}
      >
        <div className={styles.dialogHead}>
          <h2 id="item-title">{item ? `Edit ${item.name}` : `New item in ${zone.name}`}</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </div>
        <div className={styles.form}>
          <FormField label="Item">
            <input
              required
              maxLength={64}
              placeholder="Substrate bags"
              value={f.name}
              onChange={set('name')}
            />
          </FormField>
          <FormField label="Category">
            <Select value={f.category} onChange={set('category')}>
              {Object.entries(CATEGORY).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Quantity">
            <input
              required
              type="number"
              min={0}
              step="any"
              value={f.quantity}
              onChange={set('quantity')}
            />
          </FormField>
          <FormField label="Unit (optional)">
            <input
              maxLength={16}
              placeholder="bags, L, kg, units"
              value={f.unit}
              onChange={set('unit')}
            />
          </FormField>
          <FormField label="Warn below (optional)">
            <input type="number" min={0} step="any" value={f.min} onChange={set('min')} />
          </FormField>
          <FormField label="Notes (optional)">
            <input maxLength={500} value={f.notes} onChange={set('notes')} />
          </FormField>
        </div>
        <div className={styles.dialogFoot}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            icon="save"
            disabled={save.isPending || !f.name.trim() || f.quantity === ''}
          >
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
