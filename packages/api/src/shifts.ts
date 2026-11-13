/**
 * Shifts, the weekly roster and the 24/7 on-call roster as the real Lefi Brain serves them
 * (ADR-094). Every type is GENERATED from its OpenAPI document; the mock Brain does not serve these.
 */
import { queryOptions } from '@tanstack/react-query';
import type { components } from './generated/brain';
import type { ApiClient } from './endpoints';

type S = components['schemas'];

export type RosterWeek = S['WeekOut'];
export type ShiftType = S['ShiftTypeOut'];
export type NewShiftType = S['ShiftTypeIn'];
export type ShiftTypePatch = S['ShiftTypePatch'];
export type ShiftCell = S['CellOut'];
export type ShiftAssignment = S['AssignmentIn'];
export type OnShiftList = S['OnShiftListOut'];
export type OnCall = S['OnCallOut'];
export type OnCallMember = S['OnCallMemberOut'];

const enc = encodeURIComponent;

export const shiftsApi = {
  week: (c: ApiClient, start?: string) =>
    c.api<RosterWeek>({ method: 'GET', path: '/shifts/week', query: { start } }),
  assign: (c: ApiClient, body: ShiftAssignment) =>
    c.api<ShiftCell[]>({ method: 'PUT', path: '/shifts/assignments', body }),
  setTimezone: (c: ApiClient, timezone: string) =>
    c.api<{ timezone: string }>({ method: 'PUT', path: '/shifts/timezone', body: { timezone } }),
  addType: (c: ApiClient, body: NewShiftType) =>
    c.api<ShiftType>({ method: 'POST', path: '/shifts/types', body }),
  changeType: (c: ApiClient, id: string, body: ShiftTypePatch) =>
    c.api<ShiftType>({ method: 'PATCH', path: `/shifts/types/${enc(id)}`, body }),
  retireType: (c: ApiClient, id: string) =>
    c.api<ShiftType>({ method: 'POST', path: `/shifts/types/${enc(id)}/retire` }),
  now: (c: ApiClient) => c.api<OnShiftList>({ method: 'GET', path: '/shifts/now' }),
  oncall: (c: ApiClient, start?: string) =>
    c.api<OnCall>({ method: 'GET', path: '/oncall', query: { start } }),
  setMember: (c: ApiClient, userId: string, enabled: boolean, contact: string | null) =>
    c.api<OnCallMember>({
      method: 'PUT',
      path: `/oncall/members/${enc(userId)}`,
      body: { enabled, contact },
    }),
  setPrimary: (c: ApiClient, day: string, userId: string | null) =>
    c.api<{ user_id: string | null }>({
      method: 'PUT',
      path: `/oncall/days/${enc(day)}`,
      body: { user_id: userId },
    }),
};

export const shiftKeys = {
  all: ['shifts'] as const,
  week: (start?: string) => ['shifts', 'week', start] as const,
  oncall: (start?: string) => ['shifts', 'oncall', start] as const,
};

export const shiftQueries = {
  week: (c: ApiClient, start?: string) =>
    queryOptions({ queryKey: shiftKeys.week(start), queryFn: () => shiftsApi.week(c, start) }),
  oncall: (c: ApiClient, start?: string) =>
    queryOptions({
      queryKey: shiftKeys.oncall(start),
      queryFn: () => shiftsApi.oncall(c, start),
    }),
};
