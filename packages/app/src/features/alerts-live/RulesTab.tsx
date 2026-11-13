import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { alertQueries, alerts as api, type AlertSeverity, type ValueAlertRule } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { Badge, Button, Card, FormField, Skeleton, Switch } from '../../shared/ui';
import { ConfirmButton, usePlaces } from '../live/common';
import { useAlertMutation } from './AlertsLive';
import { SEVERITY, forLabel } from './presentation';
import styles from './alerts.module.css';

/**
 * What raises an alert. Built-in rules are about the system itself (contact, data) and their
 * timings are part of Lefi Brain. Value rules exist only when a person sets a range: Lefi Brain
 * never invents crop thresholds.
 */
export function RulesTab() {
  const platform = usePlatform();
  const q = useQuery(alertQueries.rules(platform));
  const places = usePlaces();
  if (q.isError) return <span className={styles.muted}>{describeError(q.error)}</span>;
  if (!q.data) return <Skeleton height={400} />;
  const r = q.data;
  const zones = new Map(places.data?.zones.map((z) => [z.id, z.name]));
  const varLabel = new Map(r.variables.map((v) => [v.variable, v]));
  return (
    <div className={styles.stack}>
      <Card
        title="Built-in rules"
        subtitle="About devices, sensors and Lefi Brain itself · timings fixed in Lefi Brain"
      >
        <div className={styles.rules}>
          {r.builtin.map((b) => (
            <div key={b.key} className={styles.rule}>
              <span className={styles.ruleHead}>
                <b>{b.title}</b>
                <Badge tone={SEVERITY[b.severity].tone}>{SEVERITY[b.severity].label}</Badge>
              </span>
              <span>
                <span className={styles.muted}>Raises when </span>
                {b.raises_when}
              </span>
              <span>
                <span className={styles.muted}>Clears when </span>
                {b.clears_when}
              </span>
            </div>
          ))}
        </div>
      </Card>
      <Card
        title="Value rules"
        subtitle="Ranges set by people for sensor values · not agronomic advice from Lefi Brain"
      >
        {r.value_rules.length === 0 && (
          <p className={styles.muted}>
            No value rule yet. Lefi Brain has no crop thresholds of its own: add one with the range
            your grower or agronomist gives you.
          </p>
        )}
        <div className={styles.rules}>
          {r.value_rules.map((v) => (
            <ValueRuleRow
              key={v.id}
              rule={v}
              canEdit={r.can_configure}
              unit={varLabel.get(v.variable)?.unit ?? ''}
              varName={varLabel.get(v.variable)?.label ?? v.variable}
              target={
                v.target_kind === 'all'
                  ? 'every sensor'
                  : v.target_kind === 'zone'
                    ? `zone ${zones.get(v.target_id ?? '') ?? v.target_id}`
                    : `sensor ${v.target_id}`
              }
            />
          ))}
        </div>
        {r.can_configure && (
          <NewRuleForm variables={r.variables} zones={places.data?.zones ?? []} />
        )}
      </Card>
    </div>
  );
}

function ValueRuleRow({
  rule,
  canEdit,
  unit,
  varName,
  target,
}: {
  rule: ValueAlertRule;
  canEdit: boolean;
  unit: string;
  varName: string;
  target: string;
}) {
  const platform = usePlatform();
  const toggle = useAlertMutation(
    () => api.updateRule(platform, rule.id, { enabled: !rule.enabled }),
    (r) => (r.enabled ? 'Rule enabled.' : 'Rule disabled; its alerts are cleared.'),
  );
  const remove = useAlertMutation(
    () => api.deleteRule(platform, rule.id),
    () => 'Rule deleted; its alerts are cleared.',
  );
  const range = [
    rule.min_value !== null ? `below ${rule.min_value} ${unit}` : null,
    rule.max_value !== null ? `above ${rule.max_value} ${unit}` : null,
  ]
    .filter(Boolean)
    .join(' or ');
  return (
    <div className={styles.rule} data-off={!rule.enabled || undefined}>
      <span className={styles.ruleHead}>
        <b>{rule.name}</b>
        <Badge tone={SEVERITY[rule.severity].tone}>{SEVERITY[rule.severity].label}</Badge>
        {!rule.enabled && <Badge tone="off">Disabled</Badge>}
      </span>
      <span>
        {varName} {range} on {target}, for {forLabel(rule.for_s)}
        {rule.clear_margin > 0 && ` · clears ${rule.clear_margin} ${unit} back inside`}
      </span>
      <span className={styles.muted}>
        Set by {rule.created_by}
        {rule.note ? ` · ${rule.note}` : ''}
      </span>
      {canEdit && (
        <span className={styles.actions}>
          <Switch
            label={rule.enabled ? 'Enabled' : 'Disabled'}
            on={rule.enabled}
            disabled={toggle.isPending}
            onChange={() => toggle.mutate(undefined)}
          />
          <ConfirmButton
            label="Delete"
            icon="delete"
            confirm="Its alerts are cleared."
            onConfirm={() => remove.mutate(undefined)}
          />
        </span>
      )}
    </div>
  );
}

const BLANK = {
  name: '',
  variable: '',
  zone: '',
  min: '',
  max: '',
  minutes: '5',
  margin: '0',
  severity: 'warning' as AlertSeverity,
  note: '',
};

function NewRuleForm({
  variables,
  zones,
}: {
  variables: { variable: string; label: string; unit: string | null }[];
  zones: { id: string; name: string }[];
}) {
  const platform = usePlatform();
  const [f, setF] = useState({ ...BLANK, variable: variables[0]?.variable ?? '' });
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const create = useAlertMutation(
    () =>
      api.createRule(platform, {
        name: f.name,
        variable: f.variable,
        target_kind: f.zone ? 'zone' : 'all',
        target_id: f.zone || null,
        min_value: num(f.min),
        max_value: num(f.max),
        for_s: Math.round(Number(f.minutes) * 60),
        clear_margin: Number(f.margin) || 0,
        severity: f.severity,
        note: f.note || null,
      }),
    (r) => `Rule “${r.name}” added.`,
  );
  const unit = variables.find((v) => v.variable === f.variable)?.unit ?? '';
  const set = (k: keyof typeof BLANK) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(undefined, { onSuccess: () => setF({ ...BLANK, variable: f.variable }) });
  };
  return (
    <form className={styles.newRule} onSubmit={submit} aria-label="New value rule">
      <span className={styles.label}>New value rule</span>
      <div className={styles.grid3}>
        <FormField label="Name">
          <input
            required
            maxLength={80}
            value={f.name}
            onChange={set('name')}
            placeholder="e.g. Hot air, Zone A"
          />
        </FormField>
        <FormField label="Value">
          <select value={f.variable} onChange={set('variable')}>
            {variables.map((v) => (
              <option key={v.variable} value={v.variable}>
                {v.label}
                {v.unit ? ` (${v.unit})` : ''}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Where">
          <select value={f.zone} onChange={set('zone')}>
            <option value="">Every sensor</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label={`Minimum ${unit}`}>
          <input type="number" step="any" value={f.min} onChange={set('min')} placeholder="none" />
        </FormField>
        <FormField label={`Maximum ${unit}`}>
          <input type="number" step="any" value={f.max} onChange={set('max')} placeholder="none" />
        </FormField>
        <FormField label="For at least (min)">
          <input
            type="number"
            min={1}
            max={1440}
            step="1"
            value={f.minutes}
            onChange={set('minutes')}
          />
        </FormField>
        <FormField label={`Clears when back by ${unit}`}>
          <input type="number" min={0} step="any" value={f.margin} onChange={set('margin')} />
        </FormField>
        <FormField label="Severity">
          <select value={f.severity} onChange={set('severity')}>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
            <option value="info">Info</option>
          </select>
        </FormField>
        <FormField label="Source of the range (optional)">
          <input
            maxLength={300}
            value={f.note}
            onChange={set('note')}
            placeholder="e.g. agronomist, 2026-11"
          />
        </FormField>
      </div>
      <span className={styles.muted}>
        The value must stay out of range for the whole time, with fresh readings, before an alert;
        it clears after 2 min back inside by the margin. A device out of contact never raises a
        value alert.
      </span>
      <Button type="submit" icon="add" disabled={create.isPending}>
        Add rule
      </Button>
    </form>
  );
}
