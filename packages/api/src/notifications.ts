/**
 * The signed-in person's notifications, made by Lefi Brain from alert transitions (ADR-072).
 * Every type is GENERATED from its OpenAPI document; the mock Brain does not serve these paths.
 */
import { queryOptions } from '@tanstack/react-query';
import type { components } from './generated/brain';
import type { ApiClient } from './endpoints';

type S = components['schemas'];

export type BrainNotifications = S['NotificationsOut'];
export type BrainNotification = S['NotificationOut'];
export type NotificationLevel = S['MinSeverity'];

export const notificationsApi = {
  mine: (c: ApiClient) =>
    c.api<BrainNotifications>({ method: 'GET', path: '/notifications', query: { limit: 50 } }),
  read: (c: ApiClient, ids?: string[]) =>
    c.api<S['ReadOut']>({
      method: 'POST',
      path: '/notifications/read',
      body: ids ? { ids } : {},
    }),
  setPreference: (c: ApiClient, min_severity: NotificationLevel) =>
    c.api<S['PreferenceOut']>({
      method: 'PUT',
      path: '/notifications/preferences',
      body: { min_severity },
    }),
};

/** Until the WebSocket exists: how often a running app asks for new notifications. */
export const NOTIFICATIONS_POLL_MS = 10_000;

export const notificationKeys = { mine: ['notifications', 'mine'] as const };

export const notificationQueries = {
  mine: (c: ApiClient) =>
    queryOptions({
      queryKey: notificationKeys.mine,
      queryFn: () => notificationsApi.mine(c),
      refetchInterval: NOTIFICATIONS_POLL_MS,
      refetchIntervalInBackground: true,
    }),
};
