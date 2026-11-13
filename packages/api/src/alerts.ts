/**
 * Alerts and incidents as the real Lefi Brain serves them (ADR-071): raised by its rules engine
 * or reported by people. Every type is GENERATED from its OpenAPI document; the mock Brain does
 * not serve these paths (ADR-049).
 */
import { queryOptions } from '@tanstack/react-query';
import type { components } from './generated/brain';
import type { ApiClient } from './endpoints';

type S = components['schemas'];

export type AlertList = S['AlertListOut'];
export type AlertItem = S['AlertOut'];
export type AlertDetail = S['AlertDetailOut'];
export type AlertTimelineEvent = S['AlertEventOut'];
export type AlertSeverity = S['Severity'];
export type IncidentReport = S['IncidentIn'];
export type AlertRules = S['RulesOut'];
export type BuiltinAlertRule = S['BuiltinRuleOut'];
export type ValueAlertRule = S['ValueRuleOut'];
export type NewValueAlertRule = S['ValueRuleIn'];
export type ValueAlertRulePatch = S['ValueRulePatch'];
export type AlertStatusFilter = 'active' | 'resolved' | 'all';

const enc = encodeURIComponent;
const post = <T>(c: ApiClient, path: string, body?: unknown) =>
  c.api<T>({ method: 'POST', path, ...(body === undefined ? {} : { body }) });

export const alerts = {
  list: (c: ApiClient, status: AlertStatusFilter = 'active') =>
    c.api<AlertList>({ method: 'GET', path: '/alerts', query: { status } }),
  get: (c: ApiClient, id: string) =>
    c.api<AlertDetail>({ method: 'GET', path: `/alerts/${enc(id)}` }),
  report: (c: ApiClient, body: IncidentReport) => post<AlertItem>(c, '/alerts', body),
  acknowledge: (c: ApiClient, id: string) => post<AlertItem>(c, `/alerts/${enc(id)}/acknowledge`),
  assign: (c: ApiClient, id: string, userId: string | null) =>
    post<AlertItem>(c, `/alerts/${enc(id)}/assign`, { user_id: userId }),
  note: (c: ApiClient, id: string, note: string) =>
    post<AlertItem>(c, `/alerts/${enc(id)}/notes`, { note }),
  resolve: (c: ApiClient, id: string, note?: string) =>
    post<AlertItem>(c, `/alerts/${enc(id)}/resolve`, note ? { note } : {}),
  rules: (c: ApiClient) => c.api<AlertRules>({ method: 'GET', path: '/alert-rules' }),
  createRule: (c: ApiClient, body: NewValueAlertRule) =>
    post<ValueAlertRule>(c, '/alert-rules', body),
  updateRule: (c: ApiClient, id: string, body: ValueAlertRulePatch) =>
    c.api<ValueAlertRule>({ method: 'PATCH', path: `/alert-rules/${enc(id)}`, body }),
  deleteRule: (c: ApiClient, id: string) =>
    c.api<null>({ method: 'DELETE', path: `/alert-rules/${enc(id)}` }),
};

/** Until the WebSocket exists, alerts poll quickly: the rules engine checks every 5 s. */
export const ALERTS_POLL_MS = 10_000;

export const alertKeys = {
  all: ['alerts'] as const,
  list: (status: AlertStatusFilter) => ['alerts', 'list', status] as const,
  one: (id: string) => ['alerts', 'one', id] as const,
  rules: ['alerts', 'rules'] as const,
};

export const alertQueries = {
  list: (c: ApiClient, status: AlertStatusFilter) =>
    queryOptions({
      queryKey: alertKeys.list(status),
      queryFn: () => alerts.list(c, status),
      refetchInterval: ALERTS_POLL_MS,
    }),
  one: (c: ApiClient, id: string) =>
    queryOptions({
      queryKey: alertKeys.one(id),
      queryFn: () => alerts.get(c, id),
      refetchInterval: ALERTS_POLL_MS,
    }),
  rules: (c: ApiClient) =>
    queryOptions({ queryKey: alertKeys.rules, queryFn: () => alerts.rules(c) }),
};
