import { useMutation, useQueryClient } from '@tanstack/react-query';
import { knowledgeKeys, type CropProfile } from '@lefi/api';
import type { Tone } from '@lefi/ui';
import { describeError } from '../../shared/lib/errors';
import { useToast } from '../../shared/ui';

/** A change sent to Lefi Brain; its answer decides, its refusal is shown as it said it. */
export function useKnowledgeMutation<A, R>(fn: (a: A) => Promise<R>, ok?: (r: R) => string) {
  const qc = useQueryClient();
  const toast = useToast((t) => t.show);
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: knowledgeKeys.all });
      if (ok) toast(ok(r), 'ok');
    },
    onError: (e) => toast(describeError(e), 'bad'),
  });
}

export const STATUS: Record<CropProfile['status'], { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'info' },
  in_review: { label: 'In review', tone: 'warn' },
  published: { label: 'Published', tone: 'ok' },
  superseded: { label: 'Superseded', tone: 'off' },
  archived: { label: 'Archived', tone: 'off' },
};

export const VERIFICATION: Record<string, { label: string; tone: Tone; hint: string }> = {
  illustrative: {
    label: 'Illustrative',
    tone: 'warn',
    hint: 'An example to start from; never authoritative',
  },
  unverified: { label: 'Unverified', tone: 'info', hint: 'From a source not checked yet' },
  verified: { label: 'Verified', tone: 'ok', hint: 'Checked against the reference it cites' },
};

export const SOURCE: Record<string, { label: string; tone: Tone }> = {
  sensor: { label: 'Measured by a sensor', tone: 'ok' },
  calculated: { label: 'Calculated', tone: 'info' },
  manual: { label: 'Measured by people', tone: 'info' },
  not_measurable: { label: 'Not measurable here yet', tone: 'off' },
};

export const STAGE_LABEL: Record<string, string> = {
  germination: 'Germination',
  seedling: 'Seedling',
  ready_to_transplant: 'Ready to transplant',
  vegetative: 'Vegetative',
  harvest_ready: 'Harvest ready',
};
export const STAGES = Object.keys(STAGE_LABEL);

export const METHOD_LABEL: Record<string, string> = {
  soil: 'Soil',
  hydroponic: 'Hydroponic',
  aeroponic: 'Aeroponic',
  other: 'Other',
};

/** "16–22" style range, or "—". */
export function range(lo: number | null | undefined, hi: number | null | undefined): string {
  if (lo == null && hi == null) return '—';
  if (lo == null) return `≤ ${hi}`;
  if (hi == null) return `≥ ${lo}`;
  return `${lo}–${hi}`;
}

/** The newest version of each profile (one row per lineage). */
export function latestVersions(all: CropProfile[]): CropProfile[] {
  const byLineage = new Map<string, CropProfile>();
  for (const p of all) {
    const cur = byLineage.get(p.lineage_id);
    if (!cur || p.version > cur.version) byLineage.set(p.lineage_id, p);
  }
  return [...byLineage.values()].sort((a, b) => a.name.localeCompare(b.name));
}
