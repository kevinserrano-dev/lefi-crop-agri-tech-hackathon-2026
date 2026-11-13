import { useMutation, useQueryClient } from '@tanstack/react-query';
import { endpoints, queryKeys, type ActionResult, type DetectionDetail } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { useToast } from '../../shared/ui';

/** Review commands: a human decision recorded by the Brain, never an automatic treatment. */
export function useDetectionActions(id: string) {
  const platform = usePlatform();
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const onSuccess = (r: ActionResult<DetectionDetail>) => {
    qc.setQueryData(queryKeys.detection(r.item.id), r.item);
    void qc.invalidateQueries({ queryKey: queryKeys.detections });
    void qc.invalidateQueries({ queryKey: queryKeys.navCounters });
    void qc.invalidateQueries({ queryKey: queryKeys.tasks });
    toast(r.message, r.item.status === 'confirmed' ? 'ok' : 'info');
  };
  const onError = (e: unknown) => toast(describeError(e), 'bad');
  const review = useMutation({
    mutationFn: (d: 'confirm' | 'reject') => endpoints.reviewDetection(platform, id, d),
    onSuccess,
    onError,
  });
  const inspect = useMutation({
    mutationFn: () => endpoints.requestInspection(platform, id),
    onSuccess,
    onError,
  });
  return { review, inspect, busy: review.isPending || inspect.isPending };
}
