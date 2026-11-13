import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queries } from '@lefi/api';
import type { Severity } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { FormField } from '../../shared/ui';
import { useIncidentActions } from './useIncidentActions';
import styles from './incidents.module.css';

/** Manual incident report (design: "Report incident" panel). */
export function ReportIncidentForm({ onDone }: { onDone: (id?: string) => void }) {
  const platform = usePlatform();
  const zones = useQuery(queries.zones(platform));
  const { report } = useIncidentActions();
  const [title, setTitle] = useState('');
  const [zone, setZone] = useState('');
  const [severity, setSeverity] = useState<Severity>('warning');
  const zoneId = zone || zones.data?.[0]?.id || '';

  function submit(e: FormEvent) {
    e.preventDefault();
    report.mutate(
      { title: title.trim(), zone_id: zoneId, severity },
      { onSuccess: (r) => onDone(r.item.id) },
    );
  }

  return (
    <form className={styles.reportForm} onSubmit={submit}>
      <FormField label="What happened?" span={2}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Water leak at gutter 4 end cap"
        />
      </FormField>
      <FormField label="Zone">
        <select value={zoneId} onChange={(e) => setZone(e.target.value)}>
          {zones.data?.map((z) => (
            <option key={z.id} value={z.id}>
              {z.id}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Severity">
        <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
          <option value="info">Informational</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
        </select>
      </FormField>
      <button type="submit" className={styles.submit} disabled={report.isPending}>
        Submit report
      </button>
    </form>
  );
}
