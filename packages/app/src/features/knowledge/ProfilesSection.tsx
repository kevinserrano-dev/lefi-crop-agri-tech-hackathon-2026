import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  knowledge,
  knowledgeQueries,
  type CropProfile,
  type CropProfileDetail,
  type KnowledgeMeasurement,
} from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  FormField,
  Icon,
  Select,
  Skeleton,
} from '../../shared/ui';
import { usePlaces } from '../live/common';
import { useCan } from '../session';
import {
  METHOD_LABEL,
  STAGES,
  STAGE_LABEL,
  STATUS,
  latestVersions,
  useKnowledgeMutation,
} from './common';
import live from '../live/live.module.css';
import styles from './knowledge.module.css';

/** 4.1 Agronomic profiles: a list of profiles and the selected version with its review steps. */
export function ProfilesSection({
  selected,
  onSelect,
}: {
  selected?: string;
  onSelect: (id: string) => void;
}) {
  const platform = usePlatform();
  const canEdit = useCan('knowledge.edit');
  const list = useQuery(knowledgeQueries.profiles(platform));
  const [creating, setCreating] = useState(false);
  if (!list.data) return <Skeleton height={300} />;
  const rows = latestVersions(list.data);
  const current = selected ?? rows[0]?.id;
  return (
    <>
      <div className={live.toolbar}>
        <span className={live.muted}>
          A profile is reusable by every plant and zone of its crop. Values typed here are
          illustrative until a person verifies them against a reference.
        </span>
        {canEdit && (
          <Button icon="add" onClick={() => setCreating(true)}>
            New profile
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <EmptyState mascot="curious" title="No crop profiles yet">
          Lefi Brain ships no profile and no threshold of its own: an agronomist creates each one,
          and a System Administrator publishes it.
        </EmptyState>
      ) : (
        <div className={live.devLayout}>
          <nav className={live.devList} aria-label="Crop profiles">
            {rows.map((p) => (
              <button
                key={p.id}
                type="button"
                className={live.devItem}
                aria-current={versionsOf(list.data, p).some((v) => v.id === current) || undefined}
                onClick={() => onSelect(p.id)}
              >
                <span className={live.devItemHead}>
                  <b>{p.name}</b>
                  <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
                </span>
                <span className={live.muted}>
                  {p.scientific_name ? <i>{p.scientific_name}</i> : 'No scientific name'} ·{' '}
                  {METHOD_LABEL[p.method]} · v{p.version}
                </span>
                <span className={live.muted}>
                  {p.parameters} parameters
                  {p.illustrative ? ` · ${p.illustrative} illustrative` : ''}
                </span>
              </button>
            ))}
          </nav>
          {current && <ProfileDetail key={current} id={current} onSelect={onSelect} />}
        </div>
      )}
      {creating && (
        <ProfileDialog
          onClose={() => setCreating(false)}
          onSaved={(p) => {
            setCreating(false);
            onSelect(p.id);
          }}
        />
      )}
    </>
  );
}

const versionsOf = (all: CropProfile[], p: CropProfile) =>
  all.filter((v) => v.lineage_id === p.lineage_id);

function ProfileDetail({ id, onSelect }: { id: string; onSelect: (id: string) => void }) {
  const platform = usePlatform();
  const canEdit = useCan('knowledge.edit');
  const canApprove = useCan('knowledge.approve');
  const q = useQuery(knowledgeQueries.profile(platform, id));
  const places = usePlaces();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const step = useKnowledgeMutation(
    (s: 'new-version' | 'submit' | 'approve' | 'reject' | 'archive') =>
      knowledge.step(platform, id, s, note.trim() || undefined),
    (p) => `${p.name} v${p.version}: ${STATUS[p.status].label.toLowerCase()}`,
  );
  if (!q.data) return <Skeleton height={320} />;
  const p = q.data;
  const crop = places.data?.cropTypes.find((t) => t.id === p.crop_type_id);
  const draft = p.status === 'draft';
  const preparing = p.versions.some((v) => v.status === 'draft' || v.status === 'in_review');
  return (
    <Card
      title={`${p.name} · v${p.version}`}
      subtitle={p.scientific_name ?? undefined}
      actions={
        <span className={live.assign}>
          <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
          {canEdit && draft && (
            <Button size="sm" variant="secondary" icon="edit" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
          {canEdit && draft && (
            <Button size="sm" icon="send" onClick={() => step.mutate('submit')}>
              Send to review
            </Button>
          )}
          {canEdit && p.status === 'published' && !preparing && (
            <Button
              size="sm"
              variant="secondary"
              icon="content_copy"
              onClick={() =>
                step.mutate('new-version', { onSuccess: (n: CropProfileDetail) => onSelect(n.id) })
              }
            >
              New version
            </Button>
          )}
        </span>
      }
    >
      <dl className={live.facts}>
        <div>
          <dt>Crop</dt>
          <dd>{crop ? `${crop.name}${crop.variety ? ` · ${crop.variety}` : ''}` : '—'}</dd>
        </div>
        <div>
          <dt>Variety</dt>
          <dd>{p.variety ?? '—'}</dd>
        </div>
        <div>
          <dt>Growing method</dt>
          <dd>{METHOD_LABEL[p.method]}</dd>
        </div>
        <div>
          <dt>Growing cycle</dt>
          <dd>
            {p.cycle_days_min || p.cycle_days_max
              ? `${p.cycle_days_min ?? '?'}–${p.cycle_days_max ?? '?'} days`
              : 'Not set'}
          </dd>
        </div>
        <div>
          <dt>Parameters</dt>
          <dd>
            {p.parameters}
            {p.illustrative ? ` (${p.illustrative} illustrative)` : ''}
          </dd>
        </div>
        <div>
          <dt>Last change</dt>
          <dd>{p.updated_at.slice(0, 10)}</dd>
        </div>
      </dl>
      {p.description && <p className={styles.text}>{p.description}</p>}
      <div className={styles.cols}>
        <div>
          <h4 className={live.subhead}>Growth stages</h4>
          {p.stages.length ? (
            <ul className={styles.plain}>
              {p.stages.map((s) => (
                <li key={s.key}>
                  {STAGE_LABEL[s.key]}
                  {s.days_min != null || s.days_max != null
                    ? ` · ${s.days_min ?? '?'}–${s.days_max ?? '?'} days`
                    : ''}
                </li>
              ))}
            </ul>
          ) : (
            <span className={live.muted}>Not set</span>
          )}
        </div>
        <div>
          <h4 className={live.subhead}>Diseases and physiological problems</h4>
          {p.problems.length ? (
            <ul className={styles.plain}>
              {p.problems.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <span className={live.muted}>None listed</span>
          )}
        </div>
        <div>
          <h4 className={live.subhead}>Recommended monitoring</h4>
          <span className={live.muted}>
            {p.monitoring.length ? p.monitoring.join(', ') : 'None listed'}
          </span>
        </div>
      </div>
      {p.environment && (
        <>
          <h4 className={live.subhead}>Environmental requirements</h4>
          <p className={styles.text}>{p.environment}</p>
        </>
      )}
      <h4 className={live.subhead}>Linked scientific documentation</h4>
      <span className={live.muted}>
        Documents arrive with the Knowledge documents section (next step); none can be linked yet.
      </span>

      {p.status === 'in_review' && canApprove && (
        <div className={styles.review}>
          <b>Review this version</b>
          <input
            aria-label="Review note"
            placeholder="Note (needed to send it back)"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <span className={live.assign}>
            <Button size="sm" icon="verified" onClick={() => step.mutate('approve')}>
              Approve and publish
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!note.trim()}
              onClick={() => step.mutate('reject')}
            >
              Send back to draft
            </Button>
          </span>
        </div>
      )}
      {p.status === 'in_review' && !canApprove && (
        <p className={live.muted}>Waiting for a System Administrator to review it.</p>
      )}
      {p.review_note && (
        <p className={live.muted}>
          <Icon name="rate_review" size={14} /> Review note: {p.review_note}
        </p>
      )}

      <h4 className={live.subhead}>Versions</h4>
      <ul className={live.placeList}>
        {p.versions.map((v) => (
          <li key={v.id}>
            <button type="button" className={styles.linkish} onClick={() => onSelect(v.id)}>
              v{v.version}
            </button>
            <span className={live.assign}>
              <span className={live.muted}>
                {v.parameters} parameters · {v.updated_at.slice(0, 10)}
              </span>
              <Badge tone={STATUS[v.status].tone}>{STATUS[v.status].label}</Badge>
            </span>
          </li>
        ))}
      </ul>
      {canApprove && ['draft', 'published', 'superseded'].includes(p.status) && (
        <div className={live.actions}>
          <Button size="sm" variant="ghost" icon="archive" onClick={() => step.mutate('archive')}>
            Archive this version
          </Button>
        </div>
      )}
      {editing && (
        <ProfileDialog
          profile={p}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      )}
    </Card>
  );
}

/** Create a profile (draft v1) or edit a draft. */
function ProfileDialog({
  profile,
  onClose,
  onSaved,
}: {
  profile?: CropProfileDetail;
  onClose: () => void;
  onSaved: (p: CropProfileDetail) => void;
}) {
  const platform = usePlatform();
  const places = usePlaces();
  const catalog = useQuery(knowledgeQueries.measurements(platform));
  const [f, setF] = useState({
    crop: profile?.crop_type_id ?? '',
    name: profile?.name ?? '',
    scientific: profile?.scientific_name ?? '',
    variety: profile?.variety ?? '',
    description: profile?.description ?? '',
    method: profile?.method ?? 'soil',
    cycleMin: profile?.cycle_days_min?.toString() ?? '',
    cycleMax: profile?.cycle_days_max?.toString() ?? '',
    environment: profile?.environment ?? '',
    problems: (profile?.problems ?? []).join('\n'),
  });
  const [stages, setStages] = useState<Record<string, { min: string; max: string }>>(
    Object.fromEntries(
      (profile?.stages ?? []).map((s) => [
        s.key,
        { min: s.days_min?.toString() ?? '', max: s.days_max?.toString() ?? '' },
      ]),
    ),
  );
  const [monitoring, setMonitoring] = useState<string[]>(profile?.monitoring ?? []);
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const body = {
    name: f.name.trim(),
    scientific_name: f.scientific.trim() || null,
    variety: f.variety.trim() || null,
    description: f.description.trim() || null,
    method: f.method as CropProfile['method'],
    stages: STAGES.filter((k) => stages[k]).map((k) => ({
      key: k as CropProfile['stages'][number]['key'],
      days_min: num(stages[k]!.min),
      days_max: num(stages[k]!.max),
    })),
    cycle_days_min: num(f.cycleMin),
    cycle_days_max: num(f.cycleMax),
    environment: f.environment.trim() || null,
    problems: f.problems
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean),
    monitoring,
  };
  const save = useKnowledgeMutation(
    () =>
      profile
        ? knowledge.update(platform, profile.id, body)
        : knowledge.create(platform, { ...body, crop_type_id: f.crop }),
    (p) => `${p.name} v${p.version} saved as a draft`,
  );
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open onClose={onClose} labelledBy="profile-title" width={760}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined, { onSuccess: onSaved });
        }}
      >
        <div className={live.dialogHead}>
          <h2 id="profile-title">
            {profile ? `Edit ${profile.name} v${profile.version}` : 'New crop profile'}
          </h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </div>
        <div className={live.form}>
          <FormField label="Crop">
            <Select required value={f.crop} disabled={Boolean(profile)} onChange={set('crop')}>
              <option value="" disabled>
                Choose…
              </option>
              {(places.data?.cropTypes ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.variety ? ` · ${t.variety}` : ''}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Profile name">
            <input required maxLength={64} value={f.name} onChange={set('name')} />
          </FormField>
          <FormField label="Scientific name (optional)">
            <input maxLength={128} value={f.scientific} onChange={set('scientific')} />
          </FormField>
          <FormField label="Variety (optional)">
            <input maxLength={64} value={f.variety} onChange={set('variety')} />
          </FormField>
          <FormField label="Growing method">
            <Select value={f.method} onChange={set('method')}>
              {Object.entries(METHOD_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Growing cycle, days (min – max)">
            <span className={live.assign}>
              <input
                type="number"
                min={1}
                value={f.cycleMin}
                onChange={set('cycleMin')}
                aria-label="Cycle minimum days"
              />
              <input
                type="number"
                min={1}
                value={f.cycleMax}
                onChange={set('cycleMax')}
                aria-label="Cycle maximum days"
              />
            </span>
          </FormField>
          <FormField label="Description (optional)" span={2}>
            <textarea
              rows={2}
              maxLength={2000}
              value={f.description}
              onChange={set('description')}
            />
          </FormField>
          <FormField label="Growth stages (and their days, optional)" span={2}>
            <div className={styles.stageGrid}>
              {STAGES.map((k) => (
                <span key={k} className={live.assign}>
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(stages[k])}
                      onChange={(e) => {
                        const next = { ...stages };
                        if (e.target.checked) next[k] = { min: '', max: '' };
                        else delete next[k];
                        setStages(next);
                      }}
                    />{' '}
                    {STAGE_LABEL[k]}
                  </label>
                  {stages[k] && (
                    <>
                      <input
                        type="number"
                        min={0}
                        className={styles.small}
                        aria-label={`${STAGE_LABEL[k]} minimum days`}
                        value={stages[k]!.min}
                        onChange={(e) =>
                          setStages({ ...stages, [k]: { ...stages[k]!, min: e.target.value } })
                        }
                      />
                      <input
                        type="number"
                        min={0}
                        className={styles.small}
                        aria-label={`${STAGE_LABEL[k]} maximum days`}
                        value={stages[k]!.max}
                        onChange={(e) =>
                          setStages({ ...stages, [k]: { ...stages[k]!, max: e.target.value } })
                        }
                      />
                    </>
                  )}
                </span>
              ))}
            </div>
          </FormField>
          <FormField label="Environmental requirements (optional)" span={2}>
            <textarea
              rows={2}
              maxLength={2000}
              value={f.environment}
              onChange={set('environment')}
            />
          </FormField>
          <FormField label="Diseases and physiological problems (one per line)" span={2}>
            <textarea rows={3} value={f.problems} onChange={set('problems')} />
          </FormField>
          <FormField label="Recommended monitoring" span={2}>
            <div className={live.checkList}>
              {(catalog.data ?? []).map((m: KnowledgeMeasurement) => (
                <label key={m.key}>
                  <input
                    type="checkbox"
                    checked={monitoring.includes(m.key)}
                    onChange={(e) =>
                      setMonitoring(
                        e.target.checked
                          ? [...monitoring, m.key]
                          : monitoring.filter((x) => x !== m.key),
                      )
                    }
                  />
                  {m.label}
                </label>
              ))}
            </div>
          </FormField>
        </div>
        <p className={live.note}>
          Saved as a draft. It applies to plants only after a System Administrator publishes it.
        </p>
        <div className={live.dialogFoot}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" icon="save" disabled={!f.name.trim() || !f.crop || save.isPending}>
            Save draft
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
