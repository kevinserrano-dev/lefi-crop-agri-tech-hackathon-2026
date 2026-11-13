import { useMutation, useQueryClient } from '@tanstack/react-query';
import { endpoints, queryKeys, type BatchInput } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { useToast } from '../../shared/ui';

/** Batch and observation writes; the Brain validates, scopes by zone access and audits them. */
export function useCropActions() {
  const platform = usePlatform();
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const onSuccess = (r: { message: string }) => {
    void qc.invalidateQueries({ queryKey: queryKeys.crops });
    toast(r.message, 'ok');
  };
  const onError = (e: unknown) => toast(describeError(e), 'bad');
  return {
    createBatch: useMutation({
      mutationFn: (b: BatchInput) => endpoints.createBatch(platform, b),
      onSuccess,
      onError,
    }),
    updateBatch: useMutation({
      mutationFn: (v: { id: string; body: BatchInput }) =>
        endpoints.updateBatch(platform, v.id, v.body),
      onSuccess,
      onError,
    }),
    observe: useMutation({
      mutationFn: (v: { id: string; note: string }) =>
        endpoints.logObservation(platform, v.id, v.note),
      onSuccess,
      onError,
    }),
  };
}
