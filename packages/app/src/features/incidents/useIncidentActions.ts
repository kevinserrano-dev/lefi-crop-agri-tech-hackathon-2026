import { useMutation, useQueryClient } from '@tanstack/react-query';
import { endpoints, queryKeys, type IncidentTransition, type NewIncident } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { useToast } from '../../shared/ui';

/**
 * Incident commands. The Brain validates state and permissions and answers with a message,
 * which is shown as is (validator result). Lists, counters and alerts refresh afterwards.
 */
export function useIncidentActions(incidentId?: string) {
  const platform = usePlatform();
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.incidents });
    void qc.invalidateQueries({ queryKey: queryKeys.navCounters });
    void qc.invalidateQueries({ queryKey: ['alerts'] });
  };
  const onError = (e: unknown) => toast(describeError(e), 'bad');

  const transition = useMutation({
    mutationFn: (t: IncidentTransition) =>
      endpoints.transitionIncident(platform, incidentId ?? '', t),
    onSuccess: (r) => {
      qc.setQueryData(queryKeys.incident(r.item.id), r.item);
      refresh();
      toast(r.message);
    },
    onError,
  });

  const assign = useMutation({
    mutationFn: (assignee: string) =>
      endpoints.assignIncident(platform, incidentId ?? '', assignee),
    onSuccess: (r) => {
      qc.setQueryData(queryKeys.incident(r.item.id), r.item);
      refresh();
      toast(r.message);
    },
    onError: (e) => {
      onError(e);
      // Re-read so the owner selector snaps back to the real value.
      if (incidentId) void qc.invalidateQueries({ queryKey: queryKeys.incident(incidentId) });
    },
  });

  const report = useMutation({
    mutationFn: (body: NewIncident) => endpoints.reportIncident(platform, body),
    onSuccess: (r) => {
      refresh();
      toast(r.message);
    },
    onError,
  });

  return { transition, assign, report };
}
