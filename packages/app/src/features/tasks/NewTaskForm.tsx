import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queries, type TaskPriority } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { FormField } from '../../shared/ui';
import { useTaskActions } from './useTaskActions';
import styles from './tasks.module.css';

/** "New task" panel (design). Assignment rules are checked by the Brain. */
export function NewTaskForm({ onDone }: { onDone: () => void }) {
  const platform = usePlatform();
  const zones = useQuery(queries.zones(platform));
  const people = useQuery(queries.people(platform));
  const { create } = useTaskActions();
  const [title, setTitle] = useState('');
  const [zone, setZone] = useState('');
  const [assignee, setAssignee] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const zoneId = zone || zones.data?.[0]?.id || '';
  const who = assignee || people.data?.[0]?.name || '';

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      { title: title.trim(), zone_id: zoneId, assignee: who, priority },
      { onSuccess: onDone },
    );
  }

  return (
    <form className={styles.newTask} onSubmit={submit}>
      <FormField label="Task" span={2}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Check raft float levels"
        />
      </FormField>
      <FormField label="Zone">
        <select value={zoneId} onChange={(e) => setZone(e.target.value)}>
          {zones.data?.map((z) => (
            <option key={z.id}>{z.id}</option>
          ))}
        </select>
      </FormField>
      <FormField label="Assignee">
        <select value={who} onChange={(e) => setAssignee(e.target.value)}>
          {people.data?.map((p) => (
            <option key={p.name}>{p.name}</option>
          ))}
        </select>
      </FormField>
      <FormField label="Priority">
        <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </FormField>
      <button type="submit" className={styles.assign} disabled={create.isPending}>
        Assign
      </button>
    </form>
  );
}
