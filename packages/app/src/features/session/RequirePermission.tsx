import type { ReactNode } from 'react';
import { useCan, useSession } from './useSession';
import { RestrictedState } from './RestrictedState';

/** Shows the restricted state when the role lacks `permission` (UI only; API decides). */
export function RequirePermission({
  permission,
  children,
}: {
  permission?: string;
  children: ReactNode;
}) {
  const allowed = useCan(permission);
  const { data } = useSession();
  if (!allowed) return <RestrictedState roleName={data?.role.name} permission={permission} />;
  return <>{children}</>;
}
