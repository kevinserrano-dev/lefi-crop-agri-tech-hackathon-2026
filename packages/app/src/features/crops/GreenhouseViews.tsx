import { useQuery } from '@tanstack/react-query';
import { queries, type GreenhouseList } from '@lefi/api';
import { toneVars } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { Icon, Skeleton } from '../../shared/ui';
import type { Go } from './nav';
import { Fact, HealthPill, num, PhotoPlaceholder } from './parts';
import styles from './crops.module.css';

/** All greenhouses the user may see. */
export function GreenhouseCards({ list, go }: { list: GreenhouseList; go: Go }) {
  return (
    <div className={styles.ghGrid}>
      {list.items.map((g) => (
        <button
          key={g.id}
          type="button"
          className={styles.ghCard}
          onClick={() => go({ level: 'gh', gh: g.id })}
        >
          <div className={styles.ghPhoto}>
            <PhotoPlaceholder label={`${g.id} ${g.name}`} height={150} />
            <span className={styles.ghBadge}>
              <HealthPill h={g.health} withLabel />
            </span>
          </div>
          <div className={styles.ghBody}>
            <div className={styles.rowBetween}>
              <div className={styles.titleBlock}>
                <span className={styles.ghName}>{g.name}</span>
                <span className={styles.faint}>
                  {g.id} · {g.area} · {g.system}
                </span>
              </div>
              <Icon name="arrow_forward" size={22} color="var(--lefi-text-faint)" />
            </div>
            <div className={styles.stats4}>
              <Fact label="Zones">{g.zones.length}</Fact>
              <Fact label="Plants">{num(g.plants)}</Fact>
              <Fact label="Avg temp">{g.avg_temp_c.toFixed(1)} °C</Fact>
              <Fact label="Avg RH">{g.avg_rh_pct} %</Fact>
            </div>
            <div className={styles.dots}>
              {g.zones.map((z) => (
                <span key={z.id} className={styles.dotChip}>
                  <i style={{ background: toneVars(z.health.tone).dot }} />
                  {z.id}
                </span>
              ))}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

/** One greenhouse: facts and its zones. */
export function GreenhouseView({ id, go }: { id: string; go: Go }) {
  const q = useQuery(queries.greenhouse(usePlatform(), id));
  if (q.isPending) return <Skeleton height={400} />;
  if (q.isError) return <span className={styles.faint}>{describeError(q.error)}</span>;
  const g = q.data;
  return (
    <div className={styles.ghLayout}>
      <section className={styles.cardFlush}>
        <PhotoPlaceholder label={`aerial · ${g.id}`} height={180} />
        <div className={styles.pad}>
          <span className={styles.bigTitle}>{g.name}</span>
          <div className={styles.facts2}>
            <Fact label="Growing area">{g.area}</Fact>
            <Fact label="System">{g.system}</Fact>
            <Fact label="Structure">{g.structure}</Fact>
            <Fact label="Heating">{g.heating}</Fact>
            <Fact label="Commissioned">{g.commissioned}</Fact>
            <Fact label="Health score">
              <span style={{ color: toneVars(g.health.tone).fg }}>
                {g.health.value} · {g.health.label}
              </span>
            </Fact>
          </div>
        </div>
      </section>
      <section className={styles.card}>
        <div className={styles.rowBetween}>
          <span className={styles.cardTitle}>Zones</span>
          <span className={styles.faint}>Select a zone to see environment and batches</span>
        </div>
        <div className={styles.zoneGrid}>
          {g.zones.map((z) => (
            <button
              key={z.id}
              type="button"
              className={styles.zoneCard}
              onClick={() => go({ level: 'zone', gh: g.id, zone: z.id })}
            >
              <div className={styles.rowBetween}>
                <div className={styles.titleBlock}>
                  <span className={styles.zoneId}>{z.id}</span>
                  <span className={styles.faint}>
                    {z.name} · {z.crop}
                  </span>
                </div>
                <HealthPill h={z.health} />
              </div>
              <div className={styles.stats3}>
                <Fact label="Temp">{z.temp_c.toFixed(1)} °C</Fact>
                <Fact label="RH">{z.rh_pct} %</Fact>
                <Fact label="EC">{z.ec.toFixed(2)}</Fact>
              </div>
              <span className={styles.faint}>
                {num(z.plants)} plants · {z.batches} batches
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
