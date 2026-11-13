import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  endpoints,
  queryKeys,
  type ActionResult,
  type AiControl,
  type AiSettingsUpdate,
  type AutonomyUpdate,
} from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { useToast } from '../../shared/ui';

/** Every change goes to the Brain, which validates (RBAC, allowlist, ranges) and audits it. */
export function useAiControlActions() {
  const platform = usePlatform();
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const onSuccess = (r: ActionResult<AiControl>) => {
    qc.setQueryData(queryKeys.aiControl, r.item);
    void qc.invalidateQueries({ queryKey: queryKeys.systemStatus });
    void qc.invalidateQueries({ queryKey: queryKeys.navCounters });
    toast(r.message, 'ok');
  };
  const onError = (e: unknown) => {
    toast(describeError(e), 'bad');
    void qc.invalidateQueries({ queryKey: queryKeys.aiControl });
  };
  return {
    resume: useMutation({
      mutationFn: () => endpoints.resumeAi(platform),
      onSuccess: (r) => {
        onSuccess(r);
        void qc.invalidateQueries(); // AI-dependent screens come back
      },
      onError,
    }),
    automation: useMutation({
      mutationFn: (v: { id: string; op: 'stop' | 'restart' }) =>
        endpoints.automation(platform, v.id, v.op),
      onSuccess,
      onError,
    }),
    autonomy: useMutation({
      mutationFn: (b: AutonomyUpdate) => endpoints.updateAutonomy(platform, b),
      onSuccess,
      onError,
    }),
    settings: useMutation({
      mutationFn: (b: AiSettingsUpdate) => endpoints.updateAiSettings(platform, b),
      onSuccess,
      onError,
    }),
  };
}
