/**
 * Escalation Rules as the real Lefi Brain serves them (ADR-096). Every type is GENERATED from its
 * OpenAPI document; the mock Brain keeps the design's sample configuration.
 */
import { queryOptions } from '@tanstack/react-query';
import type { components } from './generated/brain';
import type { ApiClient } from './endpoints';

type S = components['schemas'];

export type RoutingView = S['EscalationOut'];
export type RoutingPolicy = S['EscalationPolicyIO'];
export type RoutingPreview = S['EscalationPreviewOut'];
export type RoutingCategory = RoutingPreview['category'];

export const escalationApi = {
  view: (c: ApiClient) => c.api<RoutingView>({ method: 'GET', path: '/escalation' }),
  preview: (c: ApiClient, category: RoutingCategory, at?: string) =>
    c.api<RoutingPreview>({
      method: 'GET',
      path: '/escalation/preview',
      query: { category, at },
    }),
  setPolicy: (c: ApiClient, body: RoutingPolicy) =>
    c.api<S['EscalationPolicyOut']>({ method: 'PUT', path: '/escalation/policy', body }),
};

export const escalationKeys = { all: ['escalation'] as const };

export const escalationQueries = {
  view: (c: ApiClient) =>
    queryOptions({
      queryKey: [...escalationKeys.all, 'view'],
      queryFn: () => escalationApi.view(c),
      refetchInterval: 30_000,
    }),
  preview: (c: ApiClient, category: RoutingCategory, at?: string) =>
    queryOptions({
      queryKey: [...escalationKeys.all, 'preview', category, at],
      queryFn: () => escalationApi.preview(c, category, at),
    }),
};
