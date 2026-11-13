/**
 * Words for zones, growing locations and crops (ADR-066). Only labels and picker order live here:
 * every rule (uniqueness, parents, capacity, occupancy) is decided by Lefi Brain.
 */
import type {
  CapacityUnit,
  ClimateControl,
  ContainerItem,
  CropAssignment,
  GrowingSystem,
  GrowthStage,
  LocationKind,
  LocationSummary,
  PlaceStatus,
  ZoneItem,
  ZonePurpose,
} from '@lefi/api';
import type { Tone } from '@lefi/ui';

export const PURPOSE: Record<ZonePurpose, string> = {
  production: 'Production',
  propagation: 'Propagation',
  research: 'Research / Trial',
  other: 'Other',
};

export const SYSTEM: Record<GrowingSystem, string> = {
  containers: 'Containers / Substrate',
  nft: 'NFT',
  dwc: 'DWC / Floating rafts',
  soil: 'Soil / Growing beds',
  other: 'Other',
  not_configured: 'Not configured yet',
};

export const CLIMATE: Record<ClimateControl, string> = {
  independent: 'Independent',
  shared: 'Shared',
  not_configured: 'Not configured',
};

export const STATUS: Record<PlaceStatus, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'ok' },
  maintenance: { label: 'Maintenance', tone: 'warn' },
  inactive: { label: 'Inactive', tone: 'off' },
};

export const KIND: Record<LocationKind, string> = {
  row: 'Row',
  bench: 'Bench',
  bed: 'Bed',
  pot: 'Pot',
  bucket: 'Bucket',
  tray: 'Tray',
  grow_bag: 'Grow bag',
  slab: 'Slab',
  nft_channel: 'NFT channel',
  dwc_pond: 'DWC pond / tank',
  floating_raft: 'Floating raft',
  other: 'Other',
};

const PLURAL: Record<LocationKind, [string, string]> = {
  row: ['row', 'rows'],
  bench: ['bench', 'benches'],
  bed: ['bed', 'beds'],
  pot: ['pot', 'pots'],
  bucket: ['bucket', 'buckets'],
  tray: ['tray', 'trays'],
  grow_bag: ['grow bag', 'grow bags'],
  slab: ['slab', 'slabs'],
  nft_channel: ['NFT channel', 'NFT channels'],
  dwc_pond: ['DWC pond', 'DWC ponds'],
  floating_raft: ['floating raft', 'floating rafts'],
  other: ['other location', 'other locations'],
};

/** Picker groups; they organise the list and are not levels. */
export const KIND_GROUPS: { label: string; kinds: LocationKind[] }[] = [
  { label: 'Structures and areas', kinds: ['row', 'bench', 'bed'] },
  { label: 'Containers and supports', kinds: ['pot', 'bucket', 'tray', 'grow_bag', 'slab'] },
  { label: 'Hydroponic systems', kinds: ['nft_channel', 'dwc_pond', 'floating_raft'] },
  { label: 'Other', kinds: ['other'] },
];

/** Types a zone's declared systems usually use: listed first, never the only ones offered. */
const SUGGESTED: Record<GrowingSystem, LocationKind[]> = {
  containers: ['bench', 'row', 'pot', 'bucket', 'tray', 'grow_bag', 'slab'],
  nft: ['bench', 'nft_channel'],
  dwc: ['dwc_pond', 'floating_raft'],
  soil: ['bed', 'row'],
  other: [],
  not_configured: [],
};

export function suggestedKinds(systems: GrowingSystem[]): Set<LocationKind> {
  return new Set(systems.flatMap((s) => SUGGESTED[s]));
}

export const SUBTYPES: Partial<Record<LocationKind, Record<string, string>>> = {
  bucket: { standard: 'Standard', dutch: 'Dutch / Bato bucket' },
  tray: { growing: 'Growing tray', plug: 'Plug tray' },
};

export const UNIT: Record<CapacityUnit, string> = {
  planting_positions: 'Planting positions',
  pots: 'Pots',
  trays: 'Trays',
};

export const STAGE: Record<GrowthStage, string> = {
  germination: 'Germination',
  seedling: 'Seedling',
  ready_to_transplant: 'Ready to transplant',
  vegetative: 'Vegetative',
  harvest_ready: 'Harvest-ready',
};

export const OCCUPANCY: Record<
  NonNullable<LocationSummary['occupancy']>,
  { label: string; tone: Tone }
> = {
  empty: { label: 'Empty', tone: 'off' },
  partial: { label: 'Partly occupied', tone: 'info' },
  full: { label: 'Full', tone: 'ok' },
};

/** Mirrors Lefi Brain's leaf types, only to keep impossible parents out of the picker. */
export const HOLDS_PLANTS_ONLY: ReadonlySet<LocationKind> = new Set([
  'pot',
  'bucket',
  'grow_bag',
  'slab',
  'floating_raft',
]);

export const VOLUME_KINDS: ReadonlySet<LocationKind> = new Set(['pot', 'bucket', 'grow_bag']);
export const SIZE_KINDS: ReadonlySet<LocationKind> = new Set(['bench', 'bed']);

/** Kinds whose cells / planting positions ARE their capacity (one number, never two). */
export function countsPositions(kind: LocationKind, subtype: string | null | undefined): boolean {
  return (
    kind === 'nft_channel' || kind === 'floating_raft' || (kind === 'tray' && subtype === 'plug')
  );
}

export const locationName = (c: Pick<ContainerItem, 'name' | 'code'>) => c.name ?? c.code;

export const kindLabel = (c: Pick<ContainerItem, 'kind' | 'custom_kind' | 'subtype'>) => {
  if (c.kind === 'other') return c.custom_kind ?? KIND.other;
  const sub = c.subtype ? SUBTYPES[c.kind]?.[c.subtype] : undefined;
  return !sub || c.subtype === 'standard' ? KIND[c.kind] : sub;
};

/** "2 benches · 12 trays · 240 plants" — each location and each crop counted once by Lefi Brain. */
export function zoneSummaryText(summary: ZoneItem['summary']): string {
  if (!summary) return '';
  const parts = KIND_GROUPS.flatMap((g) => g.kinds)
    .filter((k) => (summary.locations_by_kind[k] ?? 0) > 0)
    .map((k) => {
      const n = summary.locations_by_kind[k] ?? 0;
      return `${n} ${PLURAL[k][n === 1 ? 0 : 1]}`;
    });
  if (parts.length === 0) parts.push('No growing locations');
  parts.push(`${summary.plants} ${summary.plants === 1 ? 'plant' : 'plants'}`);
  return parts.join(' · ');
}

/** "ZA" from "Zona A", "PN" from "Propagation North"; always editable. */
export function suggestZoneCode(name: string): string {
  const words = name
    .normalize('NFD')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0]!.slice(0, 3).toUpperCase();
  return words
    .map((w) => (/^\d+$/.test(w) ? w : w[0]!))
    .join('')
    .toUpperCase()
    .slice(0, 8);
}

/** "BEN-01" from "Bench 01", "TRA-09" from "Tray 09"; always editable. */
export function suggestLocationCode(name: string): string {
  const clean = name
    .normalize('NFD')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const letters = words.filter((w) => !/^\d+$/.test(w));
  const digits = words.filter((w) => /^\d+$/.test(w)).join('');
  const head = (letters[0] ?? '').slice(0, 3).toUpperCase() || 'LOC';
  return (digits ? `${head}-${digits}` : head).slice(0, 32);
}

export const cropLabel = (
  a: Pick<CropAssignment, 'crop_type_id' | 'variety'>,
  crops: Map<string, string>,
) => `${crops.get(a.crop_type_id) ?? 'Unknown crop'}${a.variety ? ` · ${a.variety}` : ''}`;
