import { useQueries, useQuery } from '@tanstack/react-query';
import { liveQueries, type CropAssignment, type PlantItem, type ZoneItem } from '@lefi/api';
import { usePlatform } from '../../../platform/PlatformContext';
import { Badge, DataTable, Icon, ProvenanceBadge, Skeleton, type Column } from '../../../shared/ui';
import { HealthBadge } from '../../operations/PlantHealthLive';
import { useCan } from '../../session';
import { DataStateBadge, LatestValues } from '../common';
import { PURPOSE, STAGE, STATUS, locationName } from '../places';
import { PlantCards } from './PlantCards';
import { ZoneCameras } from './ZoneCameras';
import { ZoneInsights, ZoneReviewPanel } from '../../health-review';
import { ZoneEnvironment } from '../../environment/ZoneEnvironment';
import {
  cropNames,
  daysSince,
  fmtNum,
  plantsOfCrop,
  summarizeHealth,
  timeProgress,
  zoneTitle,
  type GhData,
  type Go,
} from './model';
import crops from '../../crops/crops.module.css';
import styles from './greenhouses.module.css';

/**
 * Zone, in the order people need it (ADR-092): its status and Lefi Brain's review of it, then
 * what its sensors measure now with their last 24 h, then the Lefi AI section (the review's
 * points and recommendations, Lefi AI's summary and its analyses of the zone's alerts), then its
 * cameras, crop batches and tracked plants.
 */
export function ZoneView({ zone, d, go }: { zone: ZoneItem; d: GhData; go: Go }) {
  const names = cropNames(d);
  const batches = d.crops.filter((c) => c.zone_id === zone.id);
  const plants = d.plants.filter((p) => p.zone_id === zone.id);
  const kinds = [...new Set(batches.map((c) => names.get(c.crop_type_id)))].filter(Boolean);
  const purpose = zone.purpose
    ? zone.purpose === 'other'
      ? (zone.purpose_other ?? PURPOSE.other)
      : PURPOSE[zone.purpose]
    : undefined;
  const at = { gh: zone.greenhouse_id, zone: zone.id };
  return (
    <>
      <section className={crops.zoneHead}>
        <div className={crops.titleBlock}>
          <span className={crops.bigTitle}>{zoneTitle(zone)}</span>
          <span className={crops.muted}>
            {[
              kinds.join(', ') || 'No active crop',
              `${fmtNum(zone.summary?.plants ?? 0)} plants`,
              `${batches.length} active ${batches.length === 1 ? 'batch' : 'batches'}`,
            ].join(' · ')}
          </span>
        </div>
        <div className={crops.zoneScore}>
          {purpose && <span className={crops.faint}>{purpose}</span>}
          <Badge tone={STATUS[zone.status].tone} dot>
            {STATUS[zone.status].label}
          </Badge>
        </div>
      </section>
      <ZoneReviewPanel zoneId={zone.id} now={d.now} part="summary" />
      <ZoneSensorsSection zone={zone} now={d.now} />
      <LefiAiSection zone={zone} now={d.now} />
      <ZoneCameras zone={zone} now={d.now} />
      <section className={crops.tableCard}>
        <div className={crops.tableHead}>
          <span className={crops.cardTitle}>Crop batch inventory</span>
          <span className={crops.faint}>
            {batches.length} {batches.length === 1 ? 'batch' : 'batches'}
          </span>
        </div>
        <DataTable
          label="Crop batch inventory"
          columns={batchColumns(d)}
          rows={batches}
          rowKey={(b) => b.id}
          onRowClick={(b) => go({ level: 'batch', ...at, batch: b.id })}
          minWidth={820}
        >
          {batches.length === 0 && (
            <div className={crops.none}>
              No crop in this zone. Use “New crop batch” to place one in a growing location.
            </div>
          )}
        </DataTable>
      </section>
      <section className={crops.card}>
        <div className={crops.rowBetween}>
          <span className={crops.cardTitle}>Tracked plants</span>
          <span className={crops.faint}>
            Plants followed one by one in this zone · select to open profile
          </span>
        </div>
        <PlantCards
          plants={plants}
          d={d}
          onOpen={(p: PlantItem) => go({ level: 'plant', ...at, plant: p.id })}
          empty="No plant of this zone is tracked one by one yet."
        />
      </section>
    </>
  );
}

function batchColumns(d: GhData): Column<CropAssignment>[] {
  const names = cropNames(d);
  const where = new Map(d.places.containers.map((c) => [c.id, c]));
  return [
    {
      key: 'batch',
      header: 'Batch',
      width: '0.9fr',
      render: (b) =>
        b.batch_code ? (
          <span className={crops.monoStrong}>{b.batch_code}</span>
        ) : (
          <span className={crops.faint}>No code</span>
        ),
    },
    {
      key: 'crop',
      header: 'Variety',
      width: '1.3fr',
      render: (b) => (
        <span className={crops.titleBlock}>
          <b>{names.get(b.crop_type_id) ?? 'Unknown crop'}</b>
          {b.variety && <span className={crops.faint}>{b.variety}</span>}
        </span>
      ),
    },
    {
      key: 'where',
      header: 'Location',
      width: '1fr',
      render: (b) => {
        const c = where.get(b.location_id);
        return c ? locationName(c) : '—';
      },
    },
    {
      key: 'sown',
      header: 'Started',
      width: '1fr',
      render: (b) => {
        const day = daysSince(b.started_on, d.now);
        return `${b.started_on}${day === undefined ? '' : ` · day ${day}`}`;
      },
    },
    { key: 'plants', header: 'Plants', width: '0.7fr', render: (b) => fmtNum(b.plant_quantity) },
    {
      key: 'stage',
      header: 'Stage · progress',
      width: '1.3fr',
      render: (b) => {
        const pct = timeProgress(b, d.now);
        return (
          <div className={crops.progressCell}>
            <span>{b.growth_stage ? STAGE[b.growth_stage] : 'Stage not set'}</span>
            {pct !== undefined && (
              <div
                className={crops.bar}
                title={`${pct} % of the time to the expected harvest`}
                role="img"
                aria-label={`${pct} % of the time to the expected harvest`}
              >
                <div style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'health',
      header: 'Health',
      width: '0.9fr',
      render: (b) => <BatchHealth batch={b} d={d} />,
    },
    {
      key: 'go',
      header: '',
      width: '32px',
      render: () => <Icon name="chevron_right" size={20} color="var(--lefi-text-faint)" />,
    },
  ];
}

/** The worst state people last recorded on the batch's tracked plants. */
function BatchHealth({ batch, d }: { batch: CropAssignment; d: GhData }) {
  if (!d.health) return <span className={crops.faint}>—</span>;
  const s = summarizeHealth(plantsOfCrop(batch, d), d.health);
  if (s.total === 0) return <span className={crops.faint}>No tracked plants</span>;
  if (!s.worst) return <HealthBadge health={null} />;
  return (
    <span title={`${s.checked} of ${s.total} tracked plants checked by people`}>
      <HealthBadge health={s.worst} />
    </span>
  );
}

/** The zone's sensors with their last 24 h; the plain list for people without the
 * Environmental Monitoring screen. */
function ZoneSensorsSection({ zone, now }: { zone: ZoneItem; now: string | undefined }) {
  const canChart = useCan('nav.environment');
  return (
    <section className={crops.card}>
      {canChart ? <ZoneEnvironment zoneId={zone.id} /> : <ZoneSensors zone={zone} now={now} />}
    </section>
  );
}

/** Lefi AI: the review's analysis and recommendations, then its analyses of the zone's alerts. */
function LefiAiSection({ zone, now }: { zone: ZoneItem; now: string | undefined }) {
  const canReview = useCan('nav.plantHealth');
  const canAlerts = useCan('nav.alerts');
  if (!canReview && !canAlerts) return null;
  return (
    <section className={crops.card} aria-label="Lefi AI">
      <div className={crops.rowBetween}>
        <span className={crops.cardTitle}>
          <Icon name="auto_awesome" size={18} /> Lefi AI · analysis and recommendations
        </span>
        <span className={crops.faint}>
          Orientative · from Lefi Brain’s facts · people decide and act
        </span>
      </div>
      <ZoneReviewPanel zoneId={zone.id} now={now} part="analysis" />
      {canAlerts && (
        <>
          <span className={crops.faint}>Analyses of this zone’s alerts</span>
          <ZoneInsights zoneId={zone.id} now={now} />
        </>
      )}
    </section>
  );
}

/**
 * What each sensor measuring in this zone reads now (ADR-083: a sensor's zone, not its device's
 * installed-in zone — a device in Zone B may have sensors in Zone C). Readings come only from
 * Lefi Brain; a simulated node says SIMULATED. Needs `nav.devices`, like Devices & Health.
 */
export function ZoneSensors({ zone, now }: { zone: ZoneItem; now: string | undefined }) {
  const platform = usePlatform();
  const canSee = useCan('nav.devices');
  const devices = useQuery({ ...liveQueries.devices(platform), enabled: canSee });
  const here = (devices.data ?? []).filter(
    (x) => x.status !== 'RETIRED' && (x.zone_ids.includes(zone.id) || x.zone_id === zone.id),
  );
  const details = useQueries({
    queries: here.map((x) => ({ ...liveQueries.device(platform, x.id), enabled: canSee })),
  });
  if (!canSee) return null;
  if (devices.isPending) return <Skeleton height={110} />;
  const sensors = details.flatMap(({ data }) =>
    data
      ? data.sensors
          .filter((s) => s.enabled && s.zone_id === zone.id)
          .map((s) => ({ s, origin: data.origin, device: data.name }))
      : [],
  );
  if (sensors.length === 0) {
    return (
      <p className={styles.note}>
        <Icon name="sensors" size={17} />
        {here.length === 0
          ? 'No device serves this zone. In Devices & Health, give a device this zone and ' +
            'assign its sensors to it.'
          : 'No enabled sensor of the devices serving this zone measures here yet ' +
            '(Devices & Health).'}
      </p>
    );
  }
  return (
    <div className={styles.sensorGrid}>
      {sensors.map(({ s, origin, device }) => (
        <section key={s.id} className={styles.sensorTile} aria-label={s.channel.label}>
          <div className={crops.rowBetween}>
            <span className={crops.titleBlock}>
              <b>{s.channel.label}</b>
              <span className={crops.faint}>{device}</span>
            </span>
            <ProvenanceBadge origin={origin} />
          </div>
          <LatestValues sensor={s} now={now} />
          <DataStateBadge state={s.data_state} />
        </section>
      ))}
    </div>
  );
}
