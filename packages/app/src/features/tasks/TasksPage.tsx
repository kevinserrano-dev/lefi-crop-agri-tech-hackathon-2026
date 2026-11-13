import { useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { queries, type TaskFilter } from '@lefi/api';
import { mascots } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import {
  ActionButton,
  ProvenanceBadge,
  SearchInput,
  Segmented,
  Skeleton,
  useToast,
} from '../../shared/ui';
import { NewTaskForm } from './NewTaskForm';
import { TaskDetailPanel } from './TaskDetailPanel';
import { TaskTable } from './TaskTable';
import styles from './tasks.module.css';

type Tab = Exclude<TaskFilter, 'pending'>;

/** Tasks & Work Orders (design). */
export function TasksPage() {
  const platform = usePlatform();
  const search = useSearch({ strict: false }) as { task?: string };
  // `?task=<id>` (global search, other screens) opens that task, whatever its status.
  const [tab, setTab] = useState<Tab>(search.task ? 'all' : 'open');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | undefined>(search.task);
  const [seen, setSeen] = useState(search.task);
  if (search.task !== seen) {
    setSeen(search.task);
    if (search.task) {
      setTab('all');
      setQ('');
      setSelected(search.task);
    }
  }
  const [creating, setCreating] = useState(false);
  const toast = useToast((t) => t.show);
  const summary = useQuery(queries.taskSummary(platform));
  const list = useQuery(queries.tasks(platform, tab, q.trim()));
  const s = summary.data;
  const n = (k: keyof NonNullable<typeof s>['counts']) => (s ? ` · ${s.counts[k]}` : '');
  // The selected task stays open even when its status moves it out of the current tab
  // (e.g. Start work moves it from Open to In progress); changing tab resets the selection.
  const current = selected ?? list.data?.[0]?.id;

  return (
    <>
      <div className={styles.toolbar}>
        <Segmented
          label="Task status"
          value={tab}
          onChange={(t) => {
            setTab(t);
            setSelected(undefined);
          }}
          options={[
            { value: 'open', label: `Open${n('open')}` },
            { value: 'in_progress', label: `In progress${n('in_progress')}` },
            { value: 'awaiting', label: `Awaiting verification${n('awaiting')}` },
            { value: 'verified', label: `Verified${n('verified')}` },
            { value: 'all', label: `All${n('all')}` },
          ]}
        />
        <div className={styles.rowGap}>
          <SearchInput
            placeholder="Search tasks"
            aria-label="Search tasks"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <ActionButton
            label="New task"
            icon="add"
            variant="solid"
            availability={s?.can_create}
            onClick={() =>
              s?.can_create.allowed
                ? setCreating((c) => !c)
                : toast(s?.can_create.reason ?? 'Not allowed.', 'bad')
            }
          />
        </div>
      </div>
      <span className={styles.scope}>
        {s?.scope_label}
        {list.data?.some((t) => t.origin === 'SIMULATED') && (
          <>
            {' '}
            · <ProvenanceBadge origin="SIMULATED" /> mock Brain tasks
          </>
        )}
      </span>

      {creating && <NewTaskForm onDone={() => setCreating(false)} />}

      <div className={styles.layout}>
        <div className={styles.listCol}>
          {list.isPending && <Skeleton height={320} />}
          {list.isError && <span className={styles.faint}>{describeError(list.error)}</span>}
          {list.data && list.data.length > 0 && (
            <TaskTable rows={list.data} selected={current} onSelect={setSelected} />
          )}
          {list.data?.length === 0 && (
            <div className={styles.empty}>
              <img src={mascots.sleeping} alt="" />
              <span className={styles.emptyTitle}>No tasks here</span>
              <span className={styles.faint}>
                Nothing matches this filter. Try “All” or clear the search.
              </span>
            </div>
          )}
        </div>
        {current && <TaskDetailPanel key={current} id={current} />}
      </div>
    </>
  );
}
