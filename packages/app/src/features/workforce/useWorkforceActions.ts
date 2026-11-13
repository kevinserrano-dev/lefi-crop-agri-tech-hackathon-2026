import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  endpoints,
  queryKeys,
  type ActionAvailability,
  type NewInvite,
  type WorkforceUpdate,
} from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { useToast } from '../../shared/ui';

/** Every change goes to the Brain, which checks RBAC and lock-out rules and audits it. */
export function useWorkforceActions() {
  const platform = usePlatform();
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const done = (message: string) => {
    void qc.invalidateQueries({ queryKey: queryKeys.workforce });
    void qc.invalidateQueries({ queryKey: queryKeys.escalation }); // routing reads Workforce
    toast(message, 'ok');
  };
  const onError = (e: unknown) => {
    toast(describeError(e), 'bad');
    void qc.invalidateQueries({ queryKey: queryKeys.workforce });
  };
  return {
    update: useMutation({
      mutationFn: (v: { id: string; body: WorkforceUpdate }) =>
        endpoints.updatePerson(platform, v.id, v.body),
      onSuccess: (r) => done(r.message),
      onError,
    }),
    deactivate: useMutation({
      mutationFn: (id: string) => endpoints.deactivatePerson(platform, id),
      onSuccess: (r) => done(r.message),
      onError,
    }),
    invite: useMutation({
      mutationFn: (b: NewInvite) => endpoints.invitePerson(platform, b),
      onSuccess: (r) => done(r.message),
      onError: (e) => toast(describeError(e), 'bad'),
    }),
    cycleShift: useMutation({
      mutationFn: (v: { id: string; day: number }) => endpoints.cycleShift(platform, v.id, v.day),
      onSuccess: (r) => {
        qc.setQueryData(queryKeys.shifts, r.item);
        done(r.message);
      },
      onError,
    }),
    /** Locked controls stay clickable and show the Brain's reason instead of acting. */
    guarded: (av: ActionAvailability, run: () => void) => () =>
      av.allowed ? run() : toast(av.reason ?? 'Not allowed.', 'bad'),
  };
}
