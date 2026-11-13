import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queries, type BatchDetail } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { Button, Dialog, FormField, Icon } from '../../shared/ui';
import { useCropActions } from './useCropActions';
import styles from './crops.module.css';

/** Create a crop batch, or edit one (`batch` given). The Brain validates every field. */
export function BatchDialog({
  open,
  onClose,
  batch,
  zoneId,
}: {
  open: boolean;
  onClose: () => void;
  batch?: BatchDetail;
  zoneId?: string;
}) {
  const zones = useQuery({ ...queries.zones(usePlatform()), enabled: open && !batch });
  const { createBatch, updateBatch } = useCropActions();
  const [f, setF] = useState({
    zone_id: batch?.zone_id ?? zoneId ?? '',
    variety: batch?.variety ?? '',
    plants: batch ? String(batch.plants) : '',
    sown_days_ago: batch ? String(batch.day) : '0',
    lot: batch?.lot ?? '',
  });
  const zone = f.zone_id || zones.data?.[0]?.id || '';
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = {
      variety: f.variety,
      plants: Number(f.plants),
      sown_days_ago: Number(f.sown_days_ago),
      lot: f.lot,
    };
    if (batch) updateBatch.mutate({ id: batch.id, body }, { onSuccess: onClose });
    else createBatch.mutate({ ...body, zone_id: zone }, { onSuccess: onClose });
  };
  const busy = createBatch.isPending || updateBatch.isPending;
  return (
    <Dialog open={open} onClose={onClose} labelledBy="batch-title" width={560}>
      <form onSubmit={submit} className={styles.form}>
        <div className={styles.dialogHead}>
          <span id="batch-title" className={styles.dialogTitle}>
            {batch ? `Edit batch ${batch.id}` : 'New crop batch'}
          </span>
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </div>
        <div className={styles.formGrid}>
          <FormField label="Zone">
            {batch ? (
              <input value={`${batch.zone_id} · ${batch.zone_name}`} readOnly />
            ) : (
              <select value={zone} onChange={set('zone_id')}>
                {zones.data?.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.id} · {z.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label="Variety">
            <input value={f.variety} onChange={set('variety')} />
          </FormField>
          <FormField label="Plants">
            <input inputMode="numeric" value={f.plants} onChange={set('plants')} />
          </FormField>
          <FormField label="Sown (days ago)">
            <input inputMode="numeric" value={f.sown_days_ago} onChange={set('sown_days_ago')} />
          </FormField>
          <FormField label="Seed lot" span={2}>
            <input value={f.lot} onChange={set('lot')} placeholder="Optional" />
          </FormField>
        </div>
        <div className={styles.dialogFoot}>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {batch ? 'Save batch' : 'Create batch'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
