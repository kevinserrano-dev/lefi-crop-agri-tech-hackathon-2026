import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  knowledge,
  knowledgeQueries,
  liveQueries,
  type CropProfileDetail,
  type KnowledgeMeasurement,
  type NewProfileParameter,
  type ProfileParameter,
} from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import {
  Badge,
  Banner,
  Button,
  Card,
  Dialog,
  FormField,
  Icon,
  Select,
  Skeleton,
} from '../../shared/ui';
import { useCan } from '../session';
import {
  SOURCE,
  STAGE_LABEL,
  STATUS,
  VERIFICATION,
  latestVersions,
  range,
  useKnowledgeMutation,
} from './common';
import live from '../live/live.module.css';
import styles from './knowledge.module.css';

/** 4.2 Environmental parameters of a profile version, the measurement catalog, plant values. */
export function ParametersSection({
  selected,
  onSelect,
}: {
  selected?: string;
  onSelect: (id: string) => void;
}) {
  const platform = usePlatform();
  const list = useQuery(knowledgeQueries.profiles(platform));
  const catalog = useQuery(knowledgeQueries.measurements(platform));
  if (!list.data || !catalog.data) return <Skeleton height={300} />;
  const all = list.data;
  const current = selected ?? latestVersions(all)[0]?.id;
  return (
    <>
      <Card
        title="Parameters of a profile version"
        subtitle="Unit fixed by the measurement; ranges nested: critical ≤ warning ≤ optimal"
        actions={
          <Select
            aria-label="Profile version"
            value={current ?? ''}
            onChange={(e) => onSelect(e.target.value)}
          >
            {all.length === 0 && <option value="">No profile yet</option>}
            {[...all]
              .sort((a, b) => a.name.localeCompare(b.name) || b.version - a.version)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · v{p.version} · {STATUS[p.status].label}
                </option>
              ))}
          </Select>
        }
      >
        {current ? (
          <ProfileParameters
            key={current}
            id={current}
            catalog={catalog.data}
            onSelect={onSelect}
          />
        ) : (
          <span className={live.muted}>Create a crop profile first (Agronomic profiles).</span>
        )}
      </Card>
      <PlantValues catalog={catalog.data} onSelect={onSelect} />
      <Card
        title="Measurements"
        subtitle="What each parameter means, its unit, and whether anything measures it here today"
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Measurement</th>
              <th>Unit</th>
              <th>Possible values</th>
              <th>On this Lefi Brain</th>
            </tr>
          </thead>
          <tbody>
            {catalog.data.map((m) => (
              <tr key={m.key}>
                <td>
                  <b>{m.label}</b>
                  {m.note && <div className={live.muted}>{m.note}</div>}
                </td>
                <td>{m.unit}</td>
                <td className={live.mono}>
                  {m.lower} – {m.upper}
                </td>
                <td>
                  <Badge tone={SOURCE[m.source]!.tone}>{SOURCE[m.source]!.label}</Badge>
                  {m.calculated_from.length > 0 && (
                    <div className={live.muted}>from {m.calculated_from.join(' + ')}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function ProfileParameters({
  id,
  catalog,
  onSelect,
}: {
  id: string;
  catalog: KnowledgeMeasurement[];
  onSelect: (id: string) => void;
}) {
  const platform = usePlatform();
  const canEdit = useCan('knowledge.edit');
  const q = useQuery(knowledgeQueries.profile(platform, id));
  const [editing, setEditing] = useState<ProfileParameter | 'new'>();
  const remove = useKnowledgeMutation(
    (pid: string) => knowledge.removeParameter(platform, pid),
    () => 'Parameter removed',
  );
  const newVersion = useKnowledgeMutation(
    () => knowledge.step(platform, id, 'new-version'),
    (d) => `Draft v${d.version} started: add the species' values, then send it for review`,
  );
  if (!q.data) return <Skeleton height={200} />;
  const p = q.data;
  const draft = p.status === 'draft';
  const byKey = new Map(catalog.map((m) => [m.key, m]));
  return (
    <>
      <p className={live.muted}>
        These values are the species’ knowledge: they apply to every plant and crop batch of this
        crop in every zone once this version is published. Nobody sets them per plant or per zone.
      </p>
      {p.status === 'published' && p.items.length === 0 && (
        <Banner tone="warn" icon="info" title="This published version has no parameters">
          No zone of this crop is judged against it yet. Start a new version, add the species’
          values (temperature, humidity…), then send it for review and publish it.
          {canEdit && (
            <div>
              <Button
                size="sm"
                icon="add"
                disabled={newVersion.isPending}
                onClick={() => newVersion.mutate(undefined, { onSuccess: (d) => onSelect(d.id) })}
              >
                Start a new version
              </Button>
            </div>
          )}
        </Banner>
      )}
      {!draft && !(p.status === 'published' && p.items.length === 0) && (
        <p className={live.muted}>
          This version is {STATUS[p.status].label.toLowerCase()}: its values are history. To change
          them, start a new version of the profile.
        </p>
      )}
      {p.items.length === 0 ? (
        <p className={live.muted}>No parameter in this version yet.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Measurement</th>
                <th>Stage · period</th>
                <th>Optimal</th>
                <th>Warning</th>
                <th>Critical</th>
                <th>After</th>
                <th>Sudden change</th>
                <th>Trust</th>
                {canEdit && draft && <th />}
              </tr>
            </thead>
            <tbody>
              {p.items.map((x) => {
                const m = byKey.get(x.measurement);
                return (
                  <tr key={x.id}>
                    <td>
                      <b>{x.label}</b> <span className={live.muted}>{x.unit}</span>
                      {m && m.source === 'not_measurable' && (
                        <div className={live.muted}>Nothing measures it here yet</div>
                      )}
                    </td>
                    <td>
                      {x.stage ? STAGE_LABEL[x.stage] : 'Every stage'}
                      {x.period !== 'any' ? ` · ${x.period}` : ''}
                    </td>
                    <td className={live.mono}>{range(x.optimal_min, x.optimal_max)}</td>
                    <td className={live.mono}>{range(x.warning_min, x.warning_max)}</td>
                    <td className={live.mono}>{range(x.critical_min, x.critical_max)}</td>
                    <td>{x.for_s ? `${x.for_s} s` : '—'}</td>
                    <td className={live.mono}>
                      {x.max_change != null
                        ? `±${x.max_change} ${x.unit} / ${x.change_window_min ?? 60} min`
                        : '—'}
                    </td>
                    <td>
                      <Badge
                        tone={VERIFICATION[x.verification]!.tone}
                        title={VERIFICATION[x.verification]!.hint}
                      >
                        {VERIFICATION[x.verification]!.label}
                      </Badge>
                      {x.reference && <div className={live.muted}>{x.reference}</div>}
                    </td>
                    {canEdit && draft && (
                      <td>
                        <span className={live.assign}>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(x)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={remove.isPending}
                            onClick={() => remove.mutate(x.id)}
                          >
                            Remove
                          </Button>
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && draft && (
        <div className={live.actions}>
          <Button size="sm" icon="add" onClick={() => setEditing('new')}>
            Add parameter
          </Button>
        </div>
      )}
      {editing && (
        <ParameterDialog
          profile={p}
          catalog={catalog}
          parameter={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(undefined)}
        />
      )}
    </>
  );
}

const T_FIELDS = [
  ['critical_min', 'Critical min'],
  ['warning_min', 'Warning min'],
  ['optimal_min', 'Optimal min'],
  ['optimal_max', 'Optimal max'],
  ['warning_max', 'Warning max'],
  ['critical_max', 'Critical max'],
] as const;
type TKey = (typeof T_FIELDS)[number][0];

function thresholdsOf(src: Partial<Record<TKey, number | null>> | undefined) {
  return Object.fromEntries(
    T_FIELDS.map(([k]) => [k, src?.[k] == null ? '' : String(src[k])]),
  ) as Record<TKey, string>;
}

function ThresholdInputs({
  unit,
  value,
  onChange,
}: {
  unit: string;
  value: Record<TKey, string>;
  onChange: (v: Record<TKey, string>) => void;
}) {
  return (
    <div className={styles.thresholds}>
      {T_FIELDS.map(([k, label]) => (
        <label key={k}>
          {label} ({unit})
          <input
            type="number"
            step="any"
            value={value[k]}
            onChange={(e) => onChange({ ...value, [k]: e.target.value })}
          />
        </label>
      ))}
    </div>
  );
}

const toNumbers = (t: Record<TKey, string>) =>
  Object.fromEntries(
    T_FIELDS.map(([k]) => [k, t[k].trim() === '' ? null : Number(t[k])]),
  ) as Record<TKey, number | null>;

function ParameterDialog({
  profile,
  catalog,
  parameter,
  onClose,
}: {
  profile: CropProfileDetail;
  catalog: KnowledgeMeasurement[];
  parameter?: ProfileParameter;
  onClose: () => void;
}) {
  const platform = usePlatform();
  const [m, setM] = useState(parameter?.measurement ?? catalog[0]!.key);
  const [stage, setStage] = useState(parameter?.stage ?? '');
  const [period, setPeriod] = useState(parameter?.period ?? 'any');
  const [forS, setForS] = useState(String(parameter?.for_s ?? 0));
  const [verification, setVerification] = useState(parameter?.verification ?? 'illustrative');
  const [reference, setReference] = useState(parameter?.reference ?? '');
  const [note, setNote] = useState(parameter?.note ?? '');
  const [maxChange, setMaxChange] = useState(
    parameter?.max_change == null ? '' : String(parameter.max_change),
  );
  const [windowMin, setWindowMin] = useState(String(parameter?.change_window_min ?? 60));
  const [t, setT] = useState(thresholdsOf(parameter));
  const meas = catalog.find((x) => x.key === m)!;
  const body: NewProfileParameter = {
    measurement: m,
    stage: stage || null,
    period: period as NewProfileParameter['period'],
    for_s: Number(forS) || 0,
    verification: verification as NewProfileParameter['verification'],
    reference: reference.trim() || null,
    note: note.trim() || null,
    max_change: maxChange.trim() === '' ? null : Number(maxChange),
    change_window_min: maxChange.trim() === '' ? null : Number(windowMin) || 60,
    ...toNumbers(t),
  };
  const save = useKnowledgeMutation(
    () =>
      parameter
        ? knowledge.updateParameter(platform, profile.id, parameter.id, body)
        : knowledge.addParameter(platform, profile.id, body),
    (x) => `${x.label} saved (${x.verification})`,
  );
  return (
    <Dialog open onClose={onClose} labelledBy="param-title" width={720}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined, { onSuccess: onClose });
        }}
      >
        <div className={live.dialogHead}>
          <h2 id="param-title">
            {parameter ? 'Edit parameter' : 'Add parameter'} · {profile.name} v{profile.version}
          </h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </div>
        <div className={live.form}>
          <FormField label="Measurement">
            <Select value={m} onChange={(e) => setM(e.target.value)}>
              {catalog.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label} ({x.unit})
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Growth stage">
            <Select value={stage} onChange={(e) => setStage(e.target.value)}>
              <option value="">Every stage</option>
              {profile.stages.map((s) => (
                <option key={s.key} value={s.key}>
                  {STAGE_LABEL[s.key]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Day / night">
            <Select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
              <option value="any">Day and night</option>
              <option value="day">Day only</option>
              <option value="night">Night only</option>
            </Select>
          </FormField>
          <FormField label="Outside for at least (seconds) before it counts">
            <input
              type="number"
              min={0}
              max={86400}
              value={forS}
              onChange={(e) => setForS(e.target.value)}
            />
          </FormField>
          <FormField label={`Sudden change: alert when it moves more than (${meas.unit})`}>
            <input
              type="number"
              step="any"
              min={0}
              value={maxChange}
              placeholder="Empty = not watched"
              onChange={(e) => setMaxChange(e.target.value)}
            />
          </FormField>
          <FormField label="… within (minutes)">
            <input
              type="number"
              min={5}
              max={1440}
              value={windowMin}
              disabled={maxChange.trim() === ''}
              onChange={(e) => setWindowMin(e.target.value)}
            />
          </FormField>
          <FormField label="Thresholds (leave empty what does not apply)" span={2}>
            <ThresholdInputs unit={meas.unit} value={t} onChange={setT} />
          </FormField>
          <FormField label="Trust">
            <Select
              value={verification}
              onChange={(e) => setVerification(e.target.value as typeof verification)}
            >
              <option value="illustrative">Illustrative (an example)</option>
              <option value="unverified">Unverified (from a source not checked)</option>
              <option value="verified">Verified (cites its reference)</option>
            </Select>
          </FormField>
          <FormField
            label={verification === 'verified' ? 'Reference (required)' : 'Reference (optional)'}
          >
            <input
              maxLength={500}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Document, page or table"
            />
          </FormField>
          <FormField label="Note (optional)" span={2}>
            <input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        </div>
        {meas.source === 'not_measurable' && (
          <p className={live.note}>
            Nothing measures {meas.label.toLowerCase()} on this Lefi Brain yet: the target is kept,
            but no reading will be compared with it until a sensor or a person measures it.
          </p>
        )}
        {meas.note && <p className={live.note}>{meas.note}</p>}
        <div className={live.dialogFoot}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" icon="save" disabled={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** The values that apply to one plant: its published profile, or a person's override. */
function PlantValues({
  catalog,
  onSelect,
}: {
  catalog: KnowledgeMeasurement[];
  onSelect: (id: string) => void;
}) {
  const platform = usePlatform();
  const canEdit = useCan('knowledge.edit');
  const plants = useQuery(liveQueries.plants(platform));
  const [plant, setPlant] = useState('');
  const pid = plant || plants.data?.[0]?.id || '';
  const q = useQuery({ ...knowledgeQueries.plant(platform, pid), enabled: Boolean(pid) });
  const [adding, setAdding] = useState(false);
  const remove = useKnowledgeMutation(
    (id: string) => knowledge.removeOverride(platform, id),
    () => 'The plant follows its profile again',
  );
  const toSpecies = useKnowledgeMutation(
    () => knowledge.overridesToSpecies(platform, pid),
    (d) =>
      `Copied into draft v${d.version} of ${d.name}: send it for review and publish it to apply ` +
      'it to every plant of the crop',
  );
  const own = (q.data?.parameters ?? []).filter((e) => e.source === 'override');
  return (
    <Card
      title="Values for one plant"
      subtitle="Its published profile, with the values a person set for this plant only"
      actions={
        <span className={live.assign}>
          <Select aria-label="Plant" value={pid} onChange={(e) => setPlant(e.target.value)}>
            {(plants.data ?? []).length === 0 && <option value="">No plant yet</option>}
            {(plants.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ? `${p.code} · ${p.name}` : p.code}
              </option>
            ))}
          </Select>
          {canEdit && pid && (
            <Button size="sm" icon="tune" onClick={() => setAdding(true)}>
              Set a value for this plant
            </Button>
          )}
        </span>
      }
    >
      {!pid ? (
        <span className={live.muted}>Register a plant first (Greenhouses &amp; Crops).</span>
      ) : !q.data ? (
        <Skeleton height={120} />
      ) : (
        <>
          <p className={live.muted}>
            {q.data.profile
              ? `Profile: ${q.data.profile.name} v${q.data.profile.version} (published).`
              : q.data.candidates > 1
                ? `${q.data.candidates} published profiles exist for its crop: none is chosen for it.`
                : 'No published profile for its crop yet.'}
          </p>
          {own.length > 0 && (
            <Banner tone="warn" icon="info" title="These values apply to this plant only">
              Ideal values belong to the species: put them in its profile and they apply to every
              plant of the crop in every zone, and change everywhere when the species is updated.
              {canEdit && q.data.profile && (
                <div>
                  <Button
                    size="sm"
                    icon="content_copy"
                    disabled={toSpecies.isPending}
                    onClick={() =>
                      toSpecies.mutate(undefined, { onSuccess: (d) => onSelect(d.id) })
                    }
                  >
                    Copy them to the species’ profile
                  </Button>
                </div>
              )}
            </Banner>
          )}
          {q.data.parameters.length > 0 && (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Measurement</th>
                  <th>Stage</th>
                  <th>Optimal</th>
                  <th>Warning</th>
                  <th>Critical</th>
                  <th>From</th>
                </tr>
              </thead>
              <tbody>
                {q.data.parameters.map((e) => (
                  <tr key={`${e.measurement}:${e.stage ?? ''}`}>
                    <td>
                      <b>{e.label}</b> <span className={live.muted}>{e.unit}</span>
                    </td>
                    <td>{e.stage ? STAGE_LABEL[e.stage] : 'Every stage'}</td>
                    <td className={live.mono}>{range(e.optimal_min, e.optimal_max)}</td>
                    <td className={live.mono}>{range(e.warning_min, e.warning_max)}</td>
                    <td className={live.mono}>{range(e.critical_min, e.critical_max)}</td>
                    <td>
                      {e.source === 'override' ? (
                        <span className={live.assign}>
                          <Badge tone="info" title={e.reason ?? undefined}>
                            This plant
                          </Badge>
                          {canEdit && e.override_id && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => remove.mutate(e.override_id!)}
                            >
                              Remove
                            </Button>
                          )}
                        </span>
                      ) : (
                        <Badge tone={VERIFICATION[e.verification]!.tone}>
                          Profile v{e.profile_version} · {VERIFICATION[e.verification]!.label}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      {adding && pid && (
        <OverrideDialog plantId={pid} catalog={catalog} onClose={() => setAdding(false)} />
      )}
    </Card>
  );
}

function OverrideDialog({
  plantId,
  catalog,
  onClose,
}: {
  plantId: string;
  catalog: KnowledgeMeasurement[];
  onClose: () => void;
}) {
  const platform = usePlatform();
  const [m, setM] = useState(catalog[0]!.key);
  const [stage, setStage] = useState('');
  const [reason, setReason] = useState('');
  const [t, setT] = useState(thresholdsOf(undefined));
  const meas = catalog.find((x) => x.key === m)!;
  const save = useKnowledgeMutation(
    () =>
      knowledge.addOverride(platform, plantId, {
        measurement: m,
        stage: stage || null,
        reason: reason.trim(),
        verification: 'unverified',
        ...toNumbers(t),
      }),
    () => 'Value set for this plant; its profile is unchanged',
  );
  return (
    <Dialog open onClose={onClose} labelledBy="override-title" width={680}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined, { onSuccess: onClose });
        }}
      >
        <div className={live.dialogHead}>
          <h2 id="override-title">A value for this plant only</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </div>
        <div className={live.form}>
          <FormField label="Measurement">
            <Select value={m} onChange={(e) => setM(e.target.value)}>
              {catalog.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label} ({x.unit})
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Growth stage">
            <Select value={stage} onChange={(e) => setStage(e.target.value)}>
              <option value="">Every stage</option>
              {Object.entries(STAGE_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Thresholds" span={2}>
            <ThresholdInputs unit={meas.unit} value={t} onChange={setT} />
          </FormField>
          <FormField label="Why this plant needs its own value" span={2}>
            <input
              required
              minLength={3}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
        </div>
        <p className={live.note}>
          Only this plant changes; the crop profile and every other plant keep their values. A
          plant&apos;s own value is never marked verified.
        </p>
        <div className={live.dialogFoot}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" icon="save" disabled={reason.trim().length < 3 || save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
