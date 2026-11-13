/**
 * Users, roles, the audit trail and paired PCs as the real Lefi Brain serves them (Workforce and
 * Administration). Every type is GENERATED from its OpenAPI document; the mock Brain does not
 * serve these paths (ADR-049).
 */
import { queryOptions } from '@tanstack/react-query';
import type { components } from './generated/brain';
import type { ApiClient } from './endpoints';

type S = components['schemas'];

export type BrainUser = S['UserOut'];
export type BrainUserDetail = S['UserDetailOut'];
export type BrainUserList = S['UserListOut'];
export type BrainUserSession = S['UserSessionOut'];
export type BrainUserChange = S['UserChangeOut'];
export type NewBrainUser = S['UserIn'];
export type BrainUserPatch = S['UserPatch'];
export type UserWithPassword = S['UserWithPasswordOut'];
export type BrainRole = S['RoleOut'];
export type BrainRoleMatrix = S['RoleMatrixOut'];
export type AuditPage = S['AuditPageOut'];
export type AuditRow = S['AuditEntryOut'];
export type AuditVerify = S['AuditVerifyOut'];
export type PairedPc = S['ClientDeviceOut'];

export interface AuditFilter {
  action?: string;
  outcome?: 'success' | 'denied' | 'failed';
  subject?: string;
  before?: number;
  limit?: number;
}

const enc = encodeURIComponent;

export const people = {
  users: (c: ApiClient) => c.api<BrainUserList>({ method: 'GET', path: '/users' }),
  user: (c: ApiClient, id: string) =>
    c.api<BrainUserDetail>({ method: 'GET', path: `/users/${enc(id)}` }),
  createUser: (c: ApiClient, body: NewBrainUser) =>
    c.api<UserWithPassword>({ method: 'POST', path: '/users', body }),
  updateUser: (c: ApiClient, id: string, body: BrainUserPatch) =>
    c.api<BrainUser>({ method: 'PATCH', path: `/users/${enc(id)}`, body }),
  resetPassword: (c: ApiClient, id: string, password?: string) =>
    c.api<UserWithPassword>({
      method: 'POST',
      path: `/users/${enc(id)}/password`,
      body: password ? { password } : {},
    }),
  revokeSessions: (c: ApiClient, id: string) =>
    c.api<{ revoked: number }>({ method: 'POST', path: `/users/${enc(id)}/sessions/revoke` }),
  unlock: (c: ApiClient, id: string) =>
    c.api<BrainUser>({ method: 'POST', path: `/users/${enc(id)}/unlock` }),
  roleMatrix: (c: ApiClient) => c.api<BrainRoleMatrix>({ method: 'GET', path: '/roles' }),
  audit: (c: ApiClient, f: AuditFilter = {}) => {
    const query: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '') query[k] = v;
    return c.api<AuditPage>({ method: 'GET', path: '/audit', query });
  },
  verifyAudit: (c: ApiClient) => c.api<AuditVerify>({ method: 'GET', path: '/audit/verify' }),
  pairedPcs: (c: ApiClient) => c.api<PairedPc[]>({ method: 'GET', path: '/client-devices' }),
  revokePc: (c: ApiClient, id: string, reason?: string) =>
    c.api<PairedPc>({
      method: 'POST',
      path: `/client-devices/${enc(id)}/revoke`,
      body: reason ? { reason } : {},
    }),
};

export const peopleKeys = {
  all: ['people'] as const,
  users: ['people', 'users'] as const,
  user: (id: string) => ['people', 'users', id] as const,
  roles: ['people', 'roles'] as const,
  audit: (f: AuditFilter) => ['people', 'audit', f] as const,
  pcs: ['people', 'pcs'] as const,
};

export const peopleQueries = {
  users: (c: ApiClient) =>
    queryOptions({ queryKey: peopleKeys.users, queryFn: () => people.users(c) }),
  user: (c: ApiClient, id: string) =>
    queryOptions({ queryKey: peopleKeys.user(id), queryFn: () => people.user(c, id) }),
  roles: (c: ApiClient) =>
    queryOptions({ queryKey: peopleKeys.roles, queryFn: () => people.roleMatrix(c) }),
  audit: (c: ApiClient, f: AuditFilter) =>
    queryOptions({ queryKey: peopleKeys.audit(f), queryFn: () => people.audit(c, f) }),
  pcs: (c: ApiClient) =>
    queryOptions({ queryKey: peopleKeys.pcs, queryFn: () => people.pairedPcs(c) }),
};
