import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { endpoints, queries, queryKeys, type LoginRequest, type PasswordChange } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';

export function useSession() {
  const platform = usePlatform();
  return useQuery({ ...queries.session(platform), retry: false, staleTime: 60_000 });
}

/** UI-side permission check. Hiding is not authorisation: the API still enforces (403). */
export function useCan(permission: string | undefined): boolean {
  const { data } = useSession();
  if (!permission) return true;
  return data?.permissions.includes(permission) ?? false;
}

export function useLogin() {
  const platform = usePlatform();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) => endpoints.login(platform, body),
    onSuccess: (session) => {
      qc.setQueryData(queryKeys.session, session);
      // A different user may see different data: refetch everything else.
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== queryKeys.session[0] });
    },
  });
}

export function useLogout() {
  const platform = usePlatform();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => endpoints.logout(platform),
    onSettled: () => qc.clear(),
  });
}

/** The Brain answers with the updated session (`must_change_password: false`). */
export function useChangePassword() {
  const platform = usePlatform();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PasswordChange) => endpoints.changePassword(platform, body),
    onSuccess: (session) => {
      qc.setQueryData(queryKeys.session, session);
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== queryKeys.session[0] });
    },
  });
}
