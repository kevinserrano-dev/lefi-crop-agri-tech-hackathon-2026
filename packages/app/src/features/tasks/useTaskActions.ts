import { useMutation, useQueryClient } from '@tanstack/react-query';
import { endpoints, queryKeys, type NewTask, type TaskDetail } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { useToast } from '../../shared/ui';

type Step = 'start' | 'submit' | 'verify' | 'return';

/** Task commands; the Brain checks assignee / permission / state and answers with a message. */
export function useTaskActions(id?: string) {
  const platform = usePlatform();
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.tasks });
    void qc.invalidateQueries({ queryKey: queryKeys.navCounters });
  };
  const onError = (e: unknown) => toast(describeError(e), 'bad');

  const transition = useMutation({
    mutationFn: ({ step, notes }: { step: Step; notes?: string }) =>
      endpoints.transitionTask(platform, id ?? '', step, notes),
    onSuccess: (r: { item: TaskDetail; message: string }) => {
      qc.setQueryData(queryKeys.task(r.item.id), r.item);
      refresh();
      toast(
        r.message,
        r.item.status === 'In progress' && r.message.includes('returned') ? 'info' : 'ok',
      );
    },
    onError,
  });
  const create = useMutation({
    mutationFn: (body: NewTask) => endpoints.createTask(platform, body),
    onSuccess: (r) => {
      refresh();
      toast(r.message, 'ok');
    },
    onError,
  });
  return { transition, create };
}
