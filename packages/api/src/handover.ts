/**
 * Shift handover as the real Lefi Brain serves it (ADR-095). Every type is GENERATED from its
 * OpenAPI document; the mock Brain keeps the design's sample handover.
 */
import { queryOptions } from '@tanstack/react-query';
import type { components } from './generated/brain';
import type { ApiClient } from './endpoints';

type S = components['schemas'];

export type HandoverView = S['HandoverViewOut'];
export type BrainHandover = S['HandoverOut'];
export type HandoverSlot = S['SlotOut'];
export type HandoverEnvRow = S['EnvRowOut'];
export type HandoverIncident = S['IncidentOut'];

const enc = encodeURIComponent;
const post = <T>(c: ApiClient, path: string, body?: unknown) =>
  c.api<T>({ method: 'POST', path, ...(body === undefined ? {} : { body }) });

export const handoverApi = {
  current: (c: ApiClient) => c.api<HandoverView>({ method: 'GET', path: '/handover/current' }),
  sign: (c: ApiClient, id: string, note?: string) =>
    post<BrainHandover>(c, `/handovers/${enc(id)}/sign`, { note: note || null }),
  acknowledge: (c: ApiClient, id: string, note?: string) =>
    post<BrainHandover>(c, `/handovers/${enc(id)}/acknowledge`, { note: note || null }),
  rewrite: (c: ApiClient, id: string) => post<BrainHandover>(c, `/handovers/${enc(id)}/summary`),
};

export const handoverKeys = { all: ['handover'] as const };

export const handoverQueries = {
  current: (c: ApiClient) =>
    queryOptions({
      queryKey: [...handoverKeys.all, 'current'],
      queryFn: () => handoverApi.current(c),
      refetchInterval: 30_000,
    }),
};
