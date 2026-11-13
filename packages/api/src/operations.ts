/**
 * The Executive Dashboard (`/overview`) and plant health recorded by people (`/plant-health`) as
 * the real Lefi Brain serves them (ADR-070). Every type is GENERATED from its OpenAPI document; the
 * mock Brain does not serve these paths (ADR-049).
 */
import { queryOptions } from '@tanstack/react-query';
import type { components } from './generated/brain';
import type { ApiClient } from './endpoints';

type S = components['schemas'];

export type Overview = S['OverviewOut'];
export type OverviewReading = S['OverviewReadingOut'];
export type OverviewTrends = S['TrendsOut'];
export type PlantHealthPage = S['PlantHealthOut'];
export type PlantHealthRow = S['PlantHealthRow'];
export type PlantObservation = S['ObservationOut'];
export type NewObservation = S['ObservationIn'];
export type InspectionRequest = S['InspectionRequestOut'];
export type PlantHealthState = S['HealthState'];
export type PlantIssue = S['Issue'];
export type EnvironmentView = S['EnvironmentOut'];
export type AiControlView = S['AiControlOut'];
export type EnvironmentRange = EnvironmentView['window']['range'];

const enc = encodeURIComponent;

export const operations = {
  overview: (c: ApiClient) => c.api<Overview>({ method: 'GET', path: '/overview' }),
  overviewTrends: (c: ApiClient) =>
    c.api<OverviewTrends>({ method: 'GET', path: '/overview/trends' }),
  plantHealth: (c: ApiClient) => c.api<PlantHealthPage>({ method: 'GET', path: '/plant-health' }),
  /** AI Control & Safety (ADR-085). */
  aiControl: (c: ApiClient) => c.api<AiControlView>({ method: 'GET', path: '/ai/control' }),
  /** Emergency stop: the same kill switch as `lefi ai off` (ADR-021, ADR-085). */
  stopAi: (c: ApiClient, reason: string) =>
    c.api<AiControlView>({ method: 'POST', path: '/ai/stop', body: { reason } }),
  resumeAi: (c: ApiClient) => c.api<AiControlView>({ method: 'POST', path: '/ai/resume' }),
  /** Environmental Monitoring of one zone (ADR-084); no zone = the first zone with sensors. */
  environment: (c: ApiClient, zoneId: string | undefined, range: EnvironmentRange) =>
    c.api<EnvironmentView>({
      method: 'GET',
      path: '/environment',
      query: { zone_id: zoneId, range },
    }),
  observations: (c: ApiClient, plantId: string) =>
    c.api<PlantObservation[]>({ method: 'GET', path: `/plants/${enc(plantId)}/observations` }),
  observe: (c: ApiClient, plantId: string, body: NewObservation) =>
    c.api<S['ObservedOut']>({
      method: 'POST',
      path: `/plants/${enc(plantId)}/observations`,
      body,
    }),
  requestInspection: (c: ApiClient, plantId: string, reason?: string) =>
    c.api<InspectionRequest>({
      method: 'POST',
      path: `/plants/${enc(plantId)}/inspection-requests`,
      body: reason ? { reason } : {},
    }),
  cancelInspection: (c: ApiClient, id: string) =>
    c.api<InspectionRequest>({ method: 'POST', path: `/inspection-requests/${enc(id)}/cancel` }),
};

/** Until the WebSocket exists, these views poll (same pace as the other live views). */
export const OPERATIONS_POLL_MS = 15_000;
/** Charts move in 5-minute buckets: once a minute is enough (ADR-077). */
export const TRENDS_POLL_MS = 60_000;

export const operationsKeys = {
  all: ['operations'] as const,
  overview: ['operations', 'overview'] as const,
  overviewTrends: ['operations', 'overview', 'trends'] as const,
  plantHealth: ['operations', 'plant-health'] as const,
  aiControl: ['operations', 'ai-control'] as const,
  environment: (zoneId: string | undefined, range: string) =>
    ['operations', 'environment', zoneId ?? '', range] as const,
  observations: (plantId: string) => ['operations', 'observations', plantId] as const,
};

export const operationsQueries = {
  overview: (c: ApiClient) =>
    queryOptions({
      queryKey: operationsKeys.overview,
      queryFn: () => operations.overview(c),
      refetchInterval: OPERATIONS_POLL_MS,
    }),
  overviewTrends: (c: ApiClient) =>
    queryOptions({
      queryKey: operationsKeys.overviewTrends,
      queryFn: () => operations.overviewTrends(c),
      refetchInterval: TRENDS_POLL_MS,
    }),
  plantHealth: (c: ApiClient) =>
    queryOptions({
      queryKey: operationsKeys.plantHealth,
      queryFn: () => operations.plantHealth(c),
      refetchInterval: OPERATIONS_POLL_MS,
    }),
  aiControl: (c: ApiClient) =>
    queryOptions({
      queryKey: operationsKeys.aiControl,
      queryFn: () => operations.aiControl(c),
      refetchInterval: OPERATIONS_POLL_MS,
    }),
  environment: (c: ApiClient, zoneId: string | undefined, range: EnvironmentRange) =>
    queryOptions({
      queryKey: operationsKeys.environment(zoneId, range),
      queryFn: () => operations.environment(c, zoneId, range),
      refetchInterval: OPERATIONS_POLL_MS,
    }),
  observations: (c: ApiClient, plantId: string) =>
    queryOptions({
      queryKey: operationsKeys.observations(plantId),
      queryFn: () => operations.observations(c, plantId),
    }),
};
