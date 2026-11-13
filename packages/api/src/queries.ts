import { queryOptions } from '@tanstack/react-query';
import { endpoints, type ApiClient } from './endpoints';
import type {
  AlertStatus,
  DetectionFilter,
  DeviceFilters,
  HistoryRange,
  IncidentFilters,
  TaskFilter,
  WorkforceFilters,
} from './schema';

/** Live views poll until the WebSocket feed exists (milestone 4). */
export const LIVE_REFRESH_MS = 10_000;

export const queryKeys = {
  session: ['session'] as const,
  systemStatus: ['system', 'status'] as const,
  navCounters: ['nav', 'counters'] as const,
  aiSummary: ['ai', 'summary'] as const,
  aiControl: ['ai', 'control'] as const,
  aiBriefing: ['ai', 'briefing'] as const,
  assistantStatus: ['ai', 'assistant'] as const,
  aiConversations: ['ai', 'conversations'] as const,
  aiConversation: (id: string) => ['ai', 'conversations', id] as const,
  handover: ['handover', 'current'] as const,
  roles: ['roles'] as const,
  search: (q: string) => ['search', q] as const,
  inventory: ['inventory'] as const,
  zoneInventoryList: ['inventory', 'zones'] as const,
  zoneInventory: (id: string) => ['inventory', 'zone', id] as const,
  zoneForm: ['inventory', 'form'] as const,
  crops: ['crops'] as const,
  greenhouses: ['crops', 'greenhouses'] as const,
  greenhouse: (id: string) => ['crops', 'greenhouse', id] as const,
  zoneOverview: (id: string) => ['crops', 'zone', id] as const,
  batch: (id: string) => ['crops', 'batch', id] as const,
  plant: (id: string) => ['crops', 'plant', id] as const,
  admin: ['admin'] as const,
  permissions: ['admin', 'permissions'] as const,
  systemConfig: ['admin', 'config'] as const,
  audit: (q: string) => ['admin', 'audit', q] as const,
  workforce: ['workforce'] as const,
  workforceList: (f: WorkforceFilters) => ['workforce', 'list', f] as const,
  workforcePerson: (id: string) => ['workforce', 'person', id] as const,
  shifts: ['workforce', 'shifts'] as const,
  escalation: ['escalation'] as const,
  escalationConfig: ['escalation', 'config'] as const,
  escalationPreview: (type: string, slot: string) => ['escalation', 'preview', type, slot] as const,
  deliveries: ['escalation', 'deliveries'] as const,
  dashboard: ['dashboard'] as const,
  healthTrend: ['trends', 'health'] as const,
  environmentTrend: ['trends', 'environment'] as const,
  zones: ['zones'] as const,
  zoneReadings: (zoneId: string) => ['zones', zoneId, 'readings'] as const,
  irrigation: ['irrigation'] as const,
  zoneHistory: (zoneId: string, variable: string, range: HistoryRange) =>
    ['zones', zoneId, 'history', variable, range] as const,
  operatingRanges: ['operating-ranges'] as const,
  devices: ['devices'] as const,
  deviceList: (f: DeviceFilters) => ['devices', 'list', f] as const,
  deviceSummary: ['devices', 'summary'] as const,
  device: (id: string) => ['devices', 'detail', id] as const,
  alerts: (status: AlertStatus) => ['alerts', status] as const,
  tasks: ['tasks'] as const,
  taskList: (f: TaskFilter, q: string) => ['tasks', 'list', f, q] as const,
  taskSummary: ['tasks', 'summary'] as const,
  task: (id: string) => ['tasks', 'detail', id] as const,
  robots: ['robots'] as const,
  robotLive: ['robots', 'live'] as const,
  missions: ['missions'] as const,
  mission: (id: string) => ['missions', id] as const,
  shiftNow: ['shifts', 'current'] as const,
  activity: ['activity'] as const,
  people: ['people'] as const,
  detections: ['detections'] as const,
  detectionList: (f: DetectionFilter | 'all') => ['detections', 'list', f] as const,
  detectionSummary: ['detections', 'summary'] as const,
  detection: (id: string) => ['detections', 'detail', id] as const,
  incidents: ['incidents'] as const,
  incidentList: (f: IncidentFilters) => ['incidents', 'list', f] as const,
  incidentSummary: ['incidents', 'summary'] as const,
  incident: (id: string) => ['incidents', 'detail', id] as const,
};

const live = { refetchInterval: LIVE_REFRESH_MS } as const;

export const queries = {
  session: (c: ApiClient) =>
    queryOptions({ queryKey: queryKeys.session, queryFn: () => endpoints.session(c) }),
  systemStatus: (c: ApiClient) =>
    queryOptions({
      queryKey: queryKeys.systemStatus,
      queryFn: () => endpoints.systemStatus(c),
      ...live,
    }),
  navCounters: (c: ApiClient) =>
    queryOptions({
      queryKey: queryKeys.navCounters,
      queryFn: () => endpoints.navCounters(c),
      ...live,
    }),
  aiSummary: (c: ApiClient) =>
    queryOptions({ queryKey: queryKeys.aiSummary, queryFn: () => endpoints.aiSummary(c) }),
  aiBriefing: (c: ApiClient) =>
    queryOptions({ queryKey: queryKeys.aiBriefing, queryFn: () => endpoints.aiBriefing(c) }),
  assistantStatus: (c: ApiClient) =>
    queryOptions({
      queryKey: queryKeys.assistantStatus,
      queryFn: () => endpoints.assistantStatus(c),
      refetchInterval: 30_000,
    }),
  /** Re-read every 1.5 s while Lefi is still writing the answer. */
  aiConversation: (c: ApiClient, id: string) =>
    queryOptions({
      queryKey: queryKeys.aiConversation(id),
      queryFn: () => endpoints.aiConversation(c, id),
      refetchInterval: (q) =>
        q.state.data?.messages.some((m) => m.state === 'thinking') ? 1_500 : false,
    }),
  zoneInventoryList: (c: ApiClient) =>
    queryOptions({
      queryKey: queryKeys.zoneInventoryList,
      queryFn: () => endpoints.zoneInventoryList(c),
    }),
  zoneInventory: (c: ApiClient, id: string) =>
    queryOptions({
      queryKey: queryKeys.zoneInventory(id),
      queryFn: () => endpoints.zoneInventory(c, id),
    }),
  zoneForm: (c: ApiClient) =>
    queryOptions({ queryKey: queryKeys.zoneForm, queryFn: () => endpoints.zoneForm(c) }),
  greenhouses: (c: ApiClient) =>
    queryOptions({ queryKey: queryKeys.greenhouses, queryFn: () => endpoints.greenhouses(c) }),
  greenhouse: (c: ApiClient, id: string) =>
    queryOptions({
      queryKey: queryKeys.greenhouse(id),
      queryFn: () => endpoints.greenhouse(c, id),
    }),
  zoneOverview: (c: ApiClient, id: string) =>
    queryOptions({
      queryKey: queryKeys.zoneOverview(id),
      queryFn: () => endpoints.zoneOverview(c, id),
    }),
  batch: (c: ApiClient, id: string) =>
    queryOptions({ queryKey: queryKeys.batch(id), queryFn: () => endpoints.batch(c, id) }),
  plant: (c: ApiClient, id: string) =>
    queryOptions({ queryKey: queryKeys.plant(id), queryFn: () => endpoints.plant(c, id) }),
  permissions: (c: ApiClient) =>
    queryOptions({ queryKey: queryKeys.permissions, queryFn: () => endpoints.permissions(c) }),
  systemConfig: (c: ApiClient) =>
    queryOptions({ queryKey: queryKeys.systemConfig, queryFn: () => endpoints.systemConfig(c) }),
  audit: (c: ApiClient, q = '') =>
    queryOptions({
      queryKey: queryKeys.audit(q),
      queryFn: () => endpoints.audit(c, q || undefined),
      ...live,
    }),
  search: (c: ApiClient, q: string) =>
    queryOptions({
      queryKey: queryKeys.search(q),
      queryFn: () => endpoints.search(c, q),
      enabled: q.length >= 2,
      staleTime: 5_000,
    }),
  roles: (c: ApiClient) =>
    queryOptions({
      queryKey: queryKeys.roles,
      queryFn: () => endpoints.roles(c),
      staleTime: Infinity,
    }),
  workforce: (c: ApiClient, f: WorkforceFilters) =>
    queryOptions({
      queryKey: queryKeys.workforceList(f),
      queryFn: () => endpoints.workforce(c, f),
    }),
  workforcePerson: (c: ApiClient, id: string) =>
    queryOptions({
      queryKey: queryKeys.workforcePerson(id),
      queryFn: () => endpoints.workforcePerson(c, id),
    }),
  shifts: (c: ApiClient) =>
    queryOptions({ queryKey: queryKeys.shifts, queryFn: () => endpoints.shifts(c) }),
  escalation: (c: ApiClient) =>
    queryOptions({ queryKey: queryKeys.escalationConfig, queryFn: () => endpoints.escalation(c) }),
  escalationPreview: (c: ApiClient, type: string, slot: string) =>
    queryOptions({
      queryKey: queryKeys.escalationPreview(type, slot),
      queryFn: () => endpoints.escalationPreview(c, type, slot),
    }),
  deliveries: (c: ApiClient) =>
    queryOptions({
      queryKey: queryKeys.deliveries,
      queryFn: () => endpoints.deliveries(c),
      ...live,
    }),
  handover: (c: ApiClient) =>
    queryOptions({ queryKey: queryKeys.handover, queryFn: () => endpoints.handover(c), ...live }),
  dashboard: (c: ApiClient) =>
    queryOptions({ queryKey: queryKeys.dashboard, queryFn: () => endpoints.dashboard(c), ...live }),
  healthTrend: (c: ApiClient) =>
    queryOptions({ queryKey: queryKeys.healthTrend, queryFn: () => endpoints.healthTrend(c) }),
  environmentTrend: (c: ApiClient) =>
    queryOptions({
      queryKey: queryKeys.environmentTrend,
      queryFn: () => endpoints.environmentTrend(c),
    }),
  zones: (c: ApiClient) =>
    queryOptions({ queryKey: queryKeys.zones, queryFn: () => endpoints.zones(c) }),
  zoneReadings: (c: ApiClient, zoneId: string) =>
    queryOptions({
      queryKey: queryKeys.zoneReadings(zoneId),
      queryFn: () => endpoints.zoneReadings(c, zoneId),
      ...live,
    }),
  zoneHistory: (c: ApiClient, zoneId: string, variable: string, range: HistoryRange) =>
    queryOptions({
      queryKey: queryKeys.zoneHistory(zoneId, variable, range),
      queryFn: () => endpoints.zoneHistory(c, zoneId, variable, range),
      ...live,
    }),
  operatingRanges: (c: ApiClient) =>
    queryOptions({
      queryKey: queryKeys.operatingRanges,
      queryFn: () => endpoints.operatingRanges(c),
    }),
  irrigation: (c: ApiClient) =>
    queryOptions({ queryKey: queryKeys.irrigation, queryFn: () => endpoints.irrigation(c) }),
  devices: (c: ApiClient, f: DeviceFilters = {}) =>
    queryOptions({
      queryKey: queryKeys.deviceList(f),
      queryFn: () => endpoints.devices(c, f),
      ...live,
    }),
  deviceSummary: (c: ApiClient) =>
    queryOptions({
      queryKey: queryKeys.deviceSummary,
      queryFn: () => endpoints.deviceSummary(c),
      ...live,
    }),
  device: (c: ApiClient, id: string) =>
    queryOptions({
      queryKey: queryKeys.device(id),
      queryFn: () => endpoints.device(c, id),
      ...live,
    }),
  alerts: (c: ApiClient, status: AlertStatus = 'open') =>
    queryOptions({
      queryKey: queryKeys.alerts(status),
      queryFn: () => endpoints.alerts(c, status),
      ...live,
    }),
  tasks: (c: ApiClient, f: TaskFilter = 'pending', q = '') =>
    queryOptions({
      queryKey: queryKeys.taskList(f, q),
      queryFn: () => endpoints.tasks(c, f, q || undefined),
      ...live,
    }),
  taskSummary: (c: ApiClient) =>
    queryOptions({
      queryKey: queryKeys.taskSummary,
      queryFn: () => endpoints.taskSummary(c),
      ...live,
    }),
  task: (c: ApiClient, id: string) =>
    queryOptions({ queryKey: queryKeys.task(id), queryFn: () => endpoints.task(c, id), ...live }),
  robots: (c: ApiClient) =>
    queryOptions({ queryKey: queryKeys.robots, queryFn: () => endpoints.robots(c), ...live }),
  shiftNow: (c: ApiClient) =>
    queryOptions({ queryKey: queryKeys.shiftNow, queryFn: () => endpoints.shiftNow(c) }),
  activity: (c: ApiClient) =>
    queryOptions({ queryKey: queryKeys.activity, queryFn: () => endpoints.activity(c), ...live }),
  people: (c: ApiClient) =>
    queryOptions({
      queryKey: queryKeys.people,
      queryFn: () => endpoints.people(c),
      staleTime: 5 * 60_000,
    }),
  incidents: (c: ApiClient, f: IncidentFilters) =>
    queryOptions({
      queryKey: queryKeys.incidentList(f),
      queryFn: () => endpoints.incidents(c, f),
      ...live,
    }),
  incidentSummary: (c: ApiClient) =>
    queryOptions({
      queryKey: queryKeys.incidentSummary,
      queryFn: () => endpoints.incidentSummary(c),
      ...live,
    }),
  incident: (c: ApiClient, id: string) =>
    queryOptions({
      queryKey: queryKeys.incident(id),
      queryFn: () => endpoints.incident(c, id),
      ...live,
    }),
  detections: (c: ApiClient, f: DetectionFilter | 'all') =>
    queryOptions({
      queryKey: queryKeys.detectionList(f),
      queryFn: () => endpoints.detections(c, f === 'all' ? undefined : f),
      ...live,
    }),
  detectionSummary: (c: ApiClient) =>
    queryOptions({
      queryKey: queryKeys.detectionSummary,
      queryFn: () => endpoints.detectionSummary(c),
      ...live,
    }),
  detection: (c: ApiClient, id: string) =>
    queryOptions({
      queryKey: queryKeys.detection(id),
      queryFn: () => endpoints.detection(c, id),
      ...live,
    }),
  aiControl: (c: ApiClient) =>
    queryOptions({ queryKey: queryKeys.aiControl, queryFn: () => endpoints.aiControl(c), ...live }),
  /** Faster polling while the simulated robot moves (until the WebSocket feed exists). */
  robotLive: (c: ApiClient) =>
    queryOptions({
      queryKey: queryKeys.robotLive,
      queryFn: () => endpoints.robotLive(c),
      refetchInterval: 1_000,
    }),
  missions: (c: ApiClient) =>
    queryOptions({ queryKey: queryKeys.missions, queryFn: () => endpoints.missions(c), ...live }),
  mission: (c: ApiClient, id: string) =>
    queryOptions({
      queryKey: queryKeys.mission(id),
      queryFn: () => endpoints.mission(c, id),
      refetchInterval: 2_000,
    }),
};
