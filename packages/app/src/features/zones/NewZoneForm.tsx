import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { endpoints, queries, queryKeys, type NewZone, type ZoneForm } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { Button, FormField, Icon, Skeleton, useToast } from '../../shared/ui';
import styles from './zones.module.css';

const initial = (f: ZoneForm) => ({
  greenhouse_id: f.greenhouses[0]?.id ?? '',
  name: '',
  use: f.uses[0] ?? '',
  crop: '',
  system: f.systems[0] ?? '',
  area_m2: '4500',
  rows: '18',
  plants: '',
  supervisor: f.supervisors[0] ?? '',
  robot_speed: f.robot_speeds[0] ?? '',
});

/**
 * Create a zone. Options and the next id come from the Brain, which validates and audits.
 * No device slots are created: devices join a zone through announce + approval (ADR-016).
 */
export function NewZoneForm({ onDone }: { onDone: (id: string | null) => void }) {
  const platform = usePlatform();
  const q = useQuery(queries.zoneForm(platform));
  if (q.isPending) return <Skeleton height={300} />;
  if (q.isError) return <span className={styles.faint}>{describeError(q.error)}</span>;
  return <Form f={q.data} onDone={onDone} />;
}

function Form({ f, onDone }: { f: ZoneForm; onDone: (id: string | null) => void }) {
  const platform = usePlatform();
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const [v, setV] = useState(() => initial(f));
  const create = useMutation({
    mutationFn: (b: NewZone) => endpoints.createZone(platform, b),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: queryKeys.inventory });
      toast(r.message, 'ok');
      onDone(r.item.id);
    },
    onError: (e) => toast(describeError(e), 'bad'),
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: e.target.value });
  const next = f.greenhouses.find((g) => g.id === v.greenhouse_id)?.next_id;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({
      ...v,
      area_m2: Number(v.area_m2),
      rows: Number(v.rows),
      plants: v.plants === '' ? null : Number(v.plants),
    });
  };
  const select = (k: keyof typeof v, opts: Array<{ id: string; label: string }>) => (
    <select value={v[k]} onChange={set(k)}>
      {opts.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
  const opts = (xs: string[]) => xs.map((x) => ({ id: x, label: x }));
  return (
    <form className={styles.formCard} onSubmit={submit} aria-label="Create zone">
      <div className={styles.titleBlock}>
        <span className={styles.formTitle}>Create zone manually</span>
        <span className={styles.faint}>
          Zone ID is assigned automatically: <b className={styles.mono}>{next}</b>
        </span>
      </div>
      <div className={styles.formGrid}>
        <FormField label="Greenhouse">{select('greenhouse_id', f.greenhouses)}</FormField>
        <FormField label="Zone name *">
          <input value={v.name} onChange={set('name')} placeholder="e.g. Bay E" />
        </FormField>
        <FormField label="Use">{select('use', opts(f.uses))}</FormField>
        <FormField label="Crop / variety">
          <input value={v.crop} onChange={set('crop')} placeholder="Not planted" />
        </FormField>
        <FormField label="Growing system">{select('system', opts(f.systems))}</FormField>
        <FormField label="Area (m²)">
          <input inputMode="numeric" value={v.area_m2} onChange={set('area_m2')} />
        </FormField>
        <FormField label="Rows / benches">
          <input inputMode="numeric" value={v.rows} onChange={set('rows')} />
        </FormField>
        <FormField label="Plant capacity">
          <input inputMode="numeric" value={v.plants} onChange={set('plants')} placeholder="—" />
        </FormField>
        <FormField label="Zone supervisor">{select('supervisor', opts(f.supervisors))}</FormField>
        <FormField label="Robot max speed near crew">
          {select('robot_speed', opts(f.robot_speeds))}
        </FormField>
      </div>
      <div className={styles.info}>
        <Icon name="info" size={18} />
        Devices are not created here. They join the zone when they announce themselves and a
        technician approves them, or when they are registered in Devices &amp; Health. Irrigation
        stays disabled by design.
      </div>
      <div className={styles.formFoot}>
        <Button variant="secondary" type="button" onClick={() => onDone(null)}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          Create zone
        </Button>
      </div>
    </form>
  );
}
