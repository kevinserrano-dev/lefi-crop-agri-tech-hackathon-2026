import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { queries, type DetectionFilter } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { KpiRow, KpiTile, Skeleton, ToggleGroup } from '../../shared/ui';
import { DetectionDetailView } from './DetectionDetailView';
import { DetectionList } from './DetectionList';
import styles from './plantHealth.module.css';

type Filter = DetectionFilter | 'all';

/** AI Plant Health (design): detection queue + selected detection. */
export function PlantHealthPage() {
  const platform = usePlatform();
  const search = useSearch({ strict: false }) as { detection?: string };
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | undefined>(search.detection);
  const [seen, setSeen] = useState(search.detection);
  if (search.detection !== seen) {
    setSeen(search.detection);
    if (search.detection) {
      setFilter('all');
      setSelected(search.detection);
    }
  }
  const summary = useQuery(queries.detectionSummary(platform));
  const list = useQuery(queries.detections(platform, filter));
  const s = summary.data;
  const current = selected ?? list.data?.[0]?.id;
  const n = (k: keyof NonNullable<typeof s>['counts']) => (s ? ` · ${s.counts[k]}` : '');

  return (
    <>
      <KpiRow>
        <KpiTile label="Awaiting review" value={s?.awaiting_review} />
        <KpiTile label="Confirmed · 7 d" value={s?.confirmed_7d} />
        <KpiTile label="Images analysed today" value={s?.images_today.toLocaleString('en-CA')} />
        <KpiTile label="Vision model" value={s ? (s.model ?? 'Not connected') : undefined} />
      </KpiRow>
      {s?.model_note && <span className={styles.modelNote}>{s.model_note}</span>}

      <div className={styles.layout}>
        <div className={styles.listCol}>
          <ToggleGroup
            label="Detections"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `All${n('all')}` },
              { value: 'awaiting', label: `Awaiting review${n('awaiting')}` },
              { value: 'confirmed', label: `Confirmed${n('confirmed')}` },
              { value: 'rejected', label: `Rejected${n('rejected')}` },
            ]}
          />
          {list.isPending && <Skeleton height={300} />}
          {list.isError && <span className={styles.muted}>{describeError(list.error)}</span>}
          {list.data && (
            <DetectionList items={list.data} selected={current} onSelect={setSelected} />
          )}
        </div>
        {current && <DetectionDetailView key={current} id={current} />}
      </div>
    </>
  );
}
