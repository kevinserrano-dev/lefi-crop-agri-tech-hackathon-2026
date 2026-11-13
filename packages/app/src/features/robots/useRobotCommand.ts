import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  endpoints,
  queryKeys,
  type ActionResult,
  type RobotCommand,
  type RobotLive,
} from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { useToast } from '../../shared/ui';

/**
 * Every robot command — buttons or free text — goes to the Brain, which interprets, checks
 * RBAC and mission policy, and answers. Rejections are shown as the Brain words them.
 */
export function useRobotActions() {
  const platform = usePlatform();
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const onSuccess = (r: ActionResult<RobotLive>) => {
    qc.setQueryData(queryKeys.robotLive, r.item);
    void qc.invalidateQueries({ queryKey: queryKeys.missions });
    void qc.invalidateQueries({ queryKey: queryKeys.robots });
    toast(r.message, 'ok');
  };
  const onError = (e: unknown) => {
    toast(describeError(e), 'bad');
    void qc.invalidateQueries({ queryKey: queryKeys.robotLive }); // the command log changed
  };
  return {
    command: useMutation({
      mutationFn: (b: RobotCommand) => endpoints.robotCommand(platform, b),
      onSuccess,
      onError,
    }),
    speed: useMutation({
      mutationFn: (s: 1 | 2 | 4) => endpoints.simSpeed(platform, s),
      onSuccess,
      onError,
    }),
    queue: useMutation({
      mutationFn: (v: { id: string; op: 'up' | 'down' | 'cancel' }) =>
        endpoints.queueOp(platform, v.id, v.op),
      onSuccess,
      onError,
    }),
  };
}
