/**
 * Tasks and zone health reviews as the real Lefi Brain serves them (ADR-089). Every type is
 * GENERATED from its OpenAPI document; the mock Brain does not serve these paths (ADR-049).
 */
import { queryOptions } from '@tanstack/react-query';
import type { components } from './generated/brain';
import type { ApiClient } from './endpoints';

type S = components['schemas'];

export type TaskList = S['TaskListOut'];
export type TaskItem = S['TaskOut'];
export type NewBrainTask = S['TaskIn'];
export type TaskStatusFilter =
  'active' | 'closed' | 'all' | 'open' | 'in_progress' | 'awaiting' | 'verified';
export type TaskPatch = S['TaskPatch'];
export type TaskPerson = S['TaskPersonOut'];
export type TaskPhotoMeta = S['TaskPhotoOut'];
export type TaskPhotoData = S['TaskPhotoDataOut'];
export type HealthReview = S['ReviewOut'];
export type HealthReviewList = S['ReviewListOut'];
export type ReviewMeasurement = S['ReviewMeasurementOut'];
export type ReviewHealth = HealthReview['status'];
/** Lefi AI's analysis of an alert (ADR-092): orientative, schema-checked, never an action. */
export type AlertInsight = S['InsightOut'];
export type AlertInsightList = S['InsightListOut'];

const enc = encodeURIComponent;
const post = <T>(c: ApiClient, path: string, body?: unknown) =>
  c.api<T>({ method: 'POST', path, ...(body === undefined ? {} : { body }) });

export const tasksApi = {
  list: (c: ApiClient, status: TaskStatusFilter = 'active', zoneId?: string) =>
    c.api<TaskList>({ method: 'GET', path: '/tasks', query: { status, zone_id: zoneId } }),
  create: (c: ApiClient, body: NewBrainTask) => post<TaskItem>(c, '/tasks', body),
  assign: (c: ApiClient, id: string, userId: string | null) =>
    post<TaskItem>(c, `/tasks/${enc(id)}/assign`, { user_id: userId }),
  start: (c: ApiClient, id: string) => post<TaskItem>(c, `/tasks/${enc(id)}/start`),
  complete: (c: ApiClient, id: string, note?: string) =>
    post<TaskItem>(c, `/tasks/${enc(id)}/complete`, note ? { note } : {}),
  cancel: (c: ApiClient, id: string, note?: string) =>
    post<TaskItem>(c, `/tasks/${enc(id)}/cancel`, note ? { note } : {}),
  /** Work awaiting verification (ADR-093): verified and closed, or back to the assignee. */
  verify: (c: ApiClient, id: string, note?: string) =>
    post<TaskItem>(c, `/tasks/${enc(id)}/verify`, note ? { note } : {}),
  sendBack: (c: ApiClient, id: string, note: string) =>
    post<TaskItem>(c, `/tasks/${enc(id)}/return`, { note }),
  update: (c: ApiClient, id: string, body: TaskPatch) =>
    c.api<TaskItem>({ method: 'PATCH', path: `/tasks/${enc(id)}`, body }),
  photos: (c: ApiClient, id: string) =>
    c.api<TaskPhotoMeta[]>({ method: 'GET', path: `/tasks/${enc(id)}/photos` }),
  photo: (c: ApiClient, photoId: string) =>
    c.api<TaskPhotoData>({ method: 'GET', path: `/task-photos/${enc(photoId)}` }),
  addPhoto: (c: ApiClient, id: string, imageBase64: string, note?: string) =>
    post<TaskPhotoMeta>(c, `/tasks/${enc(id)}/photos`, {
      image_base64: imageBase64,
      note: note ?? null,
    }),
};

export const reviewsApi = {
  latest: (c: ApiClient, zoneId?: string) =>
    c.api<HealthReviewList>({ method: 'GET', path: '/health-reviews', query: { zone_id: zoneId } }),
  /** Reviews zones whose newest review is older than 10 min, then returns the newest of each. */
  refresh: (c: ApiClient) => post<HealthReviewList>(c, '/health-reviews/refresh'),
  review: (c: ApiClient, zoneId: string) =>
    post<HealthReview>(c, '/health-reviews', { zone_id: zoneId }),
};

export const insightsApi = {
  /** The newest analysis of one alert, or of every alert of one zone, newest first. */
  latest: (c: ApiClient, by: { alertId?: string; zoneId?: string }) =>
    c.api<AlertInsightList>({
      method: 'GET',
      path: '/alert-insights',
      query: { alert_id: by.alertId, zone_id: by.zoneId },
    }),
  /** Ask Lefi AI again with the facts of now; the answer arrives later. */
  ask: (c: ApiClient, alertId: string) =>
    post<AlertInsight>(c, '/alert-insights', { alert_id: alertId }),
};

/** Until the WebSocket exists: tasks follow alerts (rules engine every 5 s). */
export const TASKS_POLL_MS = 15_000;
/** Reviews change every 30 min or after a photo; Lefi AI's summary arrives a little later. */
export const REVIEWS_POLL_MS = 20_000;

export const taskKeys = {
  all: ['tasks'] as const,
  list: (status: TaskStatusFilter, zoneId?: string) => ['tasks', 'list', status, zoneId] as const,
  photos: (id: string) => ['tasks', 'photos', id] as const,
  photo: (photoId: string) => ['tasks', 'photo', photoId] as const,
};

export const reviewKeys = {
  all: ['health-reviews'] as const,
  latest: (zoneId?: string) => ['health-reviews', 'latest', zoneId] as const,
};

export const insightKeys = {
  all: ['alert-insights'] as const,
  latest: (alertId?: string, zoneId?: string) =>
    ['alert-insights', 'latest', alertId, zoneId] as const,
};

export const taskQueries = {
  list: (c: ApiClient, status: TaskStatusFilter, zoneId?: string) =>
    queryOptions({
      queryKey: taskKeys.list(status, zoneId),
      queryFn: () => tasksApi.list(c, status, zoneId),
      refetchInterval: TASKS_POLL_MS,
    }),
};

export const reviewQueries = {
  latest: (c: ApiClient, zoneId?: string) =>
    queryOptions({
      queryKey: reviewKeys.latest(zoneId),
      queryFn: () => reviewsApi.latest(c, zoneId),
      refetchInterval: REVIEWS_POLL_MS,
    }),
};

export const insightQueries = {
  latest: (c: ApiClient, by: { alertId?: string; zoneId?: string }) =>
    queryOptions({
      queryKey: insightKeys.latest(by.alertId, by.zoneId),
      queryFn: () => insightsApi.latest(c, by),
      refetchInterval: REVIEWS_POLL_MS,
    }),
};
