import { useMutation, useQueryClient } from '@tanstack/react-query';
import { endpoints, queryKeys, type ActionResult, type Handover } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { useToast } from '../../shared/ui';

/** Signing and acknowledging are recorded by the Brain, which checks role and order. */
export function useHandoverActions() {
  const platform = usePlatform();
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const onSuccess = (r: ActionResult<Handover>) => {
    qc.setQueryData(queryKeys.handover, r.item);
    toast(r.message, 'ok');
  };
  const onError = (e: unknown) => {
    toast(describeError(e), 'bad');
    void qc.invalidateQueries({ queryKey: queryKeys.handover });
  };
  return {
    sign: useMutation({ mutationFn: () => endpoints.signHandover(platform), onSuccess, onError }),
    acknowledge: useMutation({
      mutationFn: () => endpoints.acknowledgeHandover(platform),
      onSuccess,
      onError,
    }),
  };
}
