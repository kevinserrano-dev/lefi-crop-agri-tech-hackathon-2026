import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  endpoints,
  queryKeys,
  type ActionAvailability,
  type ActionResult,
  type EscalationConfig,
  type EscalationUpdate,
} from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { useToast } from '../../shared/ui';

/** Each change goes to the Brain, which validates (RBAC, channels, ranges) and audits it. */
export function useEscalationActions() {
  const platform = usePlatform();
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const onSuccess = (r: ActionResult<EscalationConfig>) => {
    qc.setQueryData(queryKeys.escalationConfig, r.item);
    void qc.invalidateQueries({ queryKey: queryKeys.escalation }); // preview depends on config
    toast(r.message, 'ok');
  };
  const onError = (e: unknown) => {
    toast(describeError(e), 'bad');
    void qc.invalidateQueries({ queryKey: queryKeys.escalation });
  };
  const update = useMutation({
    mutationFn: (b: EscalationUpdate) => endpoints.updateEscalation(platform, b),
    onSuccess,
    onError,
  });
  const oncall = useMutation({
    mutationFn: (v: { id: string; on: boolean }) => endpoints.setOncall(platform, v.id, v.on),
    onSuccess,
    onError,
  });
  /** Locked controls stay clickable and show the Brain's reason instead of acting. */
  const guarded = (av: ActionAvailability, run: () => void) => () =>
    av.allowed ? run() : toast(av.reason ?? 'Not allowed.', 'bad');
  return { update, oncall, guarded };
}
