import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { alerts as api, liveQueries, type AlertSeverity } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { Button, Dialog, FormField, Icon } from '../../shared/ui';
import { usePlaces } from '../live/common';
import { useAlertMutation } from './AlertsLive';
import styles from './alerts.module.css';

const EMPTY = { title: '', detail: '', severity: 'warning' as AlertSeverity, zone: '', plant: '' };

/** An incident a person saw (a broken bench, a leak, pests…). It stays until a person resolves it. */
export function ReportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const platform = usePlatform();
  const places = usePlaces();
  const plants = useQuery(liveQueries.plants(platform));
  const [f, setF] = useState(EMPTY);
  const report = useAlertMutation(
    () =>
      api.report(platform, {
        title: f.title,
        detail: f.detail || null,
        severity: f.severity,
        zone_id: f.plant ? null : f.zone || null,
        plant_id: f.plant || null,
      }),
    () => 'Incident reported.',
  );
  const close = () => {
    setF(EMPTY);
    onClose();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    report.mutate(undefined, { onSuccess: close });
  };
  const zonePlants = (plants.data ?? []).filter((p) => !f.zone || p.zone_id === f.zone);
  return (
    <Dialog open={open} onClose={close} labelledBy="report-title" width={540}>
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.dialogHead}>
          <span id="report-title" className={styles.dialogTitle}>
            Report incident
          </span>
          <button type="button" className={styles.close} aria-label="Close" onClick={close}>
            <Icon name="close" size={22} />
          </button>
        </div>
        <FormField label="What happened?">
          <input
            required
            maxLength={120}
            value={f.title}
            placeholder="e.g. Water leaking under bench B-02"
            onChange={(e) => setF({ ...f, title: e.target.value })}
          />
        </FormField>
        <FormField label="Details (optional)">
          <textarea
            rows={3}
            maxLength={1000}
            value={f.detail}
            onChange={(e) => setF({ ...f, detail: e.target.value })}
          />
        </FormField>
        <div className={styles.grid2}>
          <FormField label="Severity">
            <select
              value={f.severity}
              onChange={(e) => setF({ ...f, severity: e.target.value as AlertSeverity })}
            >
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </FormField>
          <FormField label="Zone (optional)">
            <select
              value={f.zone}
              onChange={(e) => setF({ ...f, zone: e.target.value, plant: '' })}
            >
              <option value="">Whole greenhouse</option>
              {places.data?.zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Plant (optional)">
            <select value={f.plant} onChange={(e) => setF({ ...f, plant: e.target.value })}>
              <option value="">No specific plant</option>
              {zonePlants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code}
                  {p.name ? ` · ${p.name}` : ''}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <div className={styles.dialogFoot}>
          <Button variant="secondary" type="button" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" icon="report" disabled={report.isPending}>
            Report
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
