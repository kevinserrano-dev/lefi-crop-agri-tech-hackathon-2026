import type { Platform } from '@lefi/platform';
import type {
  AiConversation,
  AiConversationSummary,
  AssistantStatus,
  ChatRequest,
  ActivityItem,
  AiBriefing,
  AiSummary,
  Alert,
  AlertStatus,
  DashboardSummary,
  Detection,
  DetectionDetail,
  DetectionFilter,
  DetectionSummary,
  Device,
  DeviceDetail,
  DeviceFilters,
  DeviceMode,
  DeviceSummary,
  NewDevice,
  HaltRequest,
  ActionResult,
  MissionDetail,
  MissionListItem,
  RobotCommand,
  RobotLive,
  AiControl,
  AiSettingsUpdate,
  AutonomyUpdate,
  Incident,
  IncidentDetail,
  IncidentFilters,
  IncidentSummary,
  IncidentTransition,
  NewIncident,
  Person,
  IrrigationStatus,
  BrainHealth,
  LoginRequest,
  PasswordChange,
  NavCounters,
  Reading,
  Robot,
  Session,
  ShiftNow,
  Handover,
  WorkforcePerson,
  RoleInfo,
  SearchHit,
  ZoneInventoryList,
  ZoneInventory,
  ZoneForm,
  NewZone,
  GreenhouseList,
  GreenhouseDetail,
  ZoneOverview,
  BatchDetail,
  BatchInput,
  PlantProfile,
  PermissionMatrix,
  PermissionChange,
  SystemConfig,
  AuditEntry,
  WorkforcePersonDetail,
  WorkforceFilters,
  WorkforceUpdate,
  NewInvite,
  ShiftWeek,
  EscalationConfig,
  EscalationPreview,
  EscalationUpdate,
  NotificationDelivery,
  SystemStatus,
  Task,
  TaskDetail,
  TaskAction,
  TaskFilter,
  TaskSummary,
  NewTask,
  Trend,
  Zone,
  ZoneHistory,
  HistoryRange,
  OperatingRanges,
  RangesUpdate,
} from './schema';

/** Anything that can send a Brain request. Platform satisfies it; tests pass a fake. */
export type ApiClient = Pick<Platform, 'api'>;

const get = <T>(c: ApiClient, path: string, query?: Record<string, string | number | undefined>) =>
  c.api<T>({ method: 'GET', path, ...(query ? { query } : {}) });

export const endpoints = {
  login: (c: ApiClient, body: LoginRequest) =>
    c.api<Session>({ method: 'POST', path: '/auth/login', body }),
  logout: (c: ApiClient) => c.api<null>({ method: 'POST', path: '/auth/logout' }),
  session: (c: ApiClient) => get<Session>(c, '/auth/session'),
  health: (c: ApiClient) => get<BrainHealth>(c, '/health'),
  changePassword: (c: ApiClient, body: PasswordChange) =>
    c.api<Session>({ method: 'POST', path: '/auth/password', body }),

  systemStatus: (c: ApiClient) => get<SystemStatus>(c, '/system/status'),
  navCounters: (c: ApiClient) => get<NavCounters>(c, '/nav/counters'),
  haltAi: (c: ApiClient, body: HaltRequest) =>
    c.api<SystemStatus>({ method: 'POST', path: '/ai/halt', body }),
  aiSummary: (c: ApiClient) => get<AiSummary>(c, '/ai/summary'),
  aiControl: (c: ApiClient) => get<AiControl>(c, '/ai/control'),
  resumeAi: (c: ApiClient) =>
    c.api<ActionResult<AiControl>>({ method: 'POST', path: '/ai/resume' }),
  automation: (c: ApiClient, id: string, op: 'stop' | 'restart') =>
    c.api<ActionResult<AiControl>>({
      method: 'POST',
      path: `/ai/automations/${encodeURIComponent(id)}/${op}`,
    }),
  updateAutonomy: (c: ApiClient, body: AutonomyUpdate) =>
    c.api<ActionResult<AiControl>>({ method: 'PUT', path: '/ai/autonomy', body }),
  updateAiSettings: (c: ApiClient, body: AiSettingsUpdate) =>
    c.api<ActionResult<AiControl>>({ method: 'PUT', path: '/ai/settings', body }),
  aiBriefing: (c: ApiClient) => get<AiBriefing>(c, '/ai/briefing'),
  assistantStatus: (c: ApiClient) => get<AssistantStatus>(c, '/ai/assistant'),
  /** Answers 202 at once; the answer is `thinking` until `aiConversation` shows it done. */
  chat: (c: ApiClient, body: ChatRequest) =>
    c.api<AiConversation>({ method: 'POST', path: '/ai/chat', body }),
  aiConversations: (c: ApiClient) => get<AiConversationSummary[]>(c, '/ai/conversations'),
  aiConversation: (c: ApiClient, id: string) =>
    get<AiConversation>(c, `/ai/conversations/${encodeURIComponent(id)}`),
  roles: (c: ApiClient) => get<RoleInfo[]>(c, '/roles'),
  search: (c: ApiClient, q: string) => get<SearchHit[]>(c, '/search', { q }),
  zoneInventoryList: (c: ApiClient) => get<ZoneInventoryList>(c, '/inventory/zones'),
  zoneInventory: (c: ApiClient, id: string) =>
    get<ZoneInventory>(c, `/inventory/zones/${encodeURIComponent(id)}`),
  zoneForm: (c: ApiClient) => get<ZoneForm>(c, '/inventory/zones/form'),
  createZone: (c: ApiClient, body: NewZone) =>
    c.api<ActionResult<ZoneInventory>>({ method: 'POST', path: '/inventory/zones', body }),
  greenhouses: (c: ApiClient) => get<GreenhouseList>(c, '/views/greenhouses'),
  greenhouse: (c: ApiClient, id: string) =>
    get<GreenhouseDetail>(c, `/greenhouses/${encodeURIComponent(id)}`),
  zoneOverview: (c: ApiClient, id: string) =>
    get<ZoneOverview>(c, `/zones/${encodeURIComponent(id)}/overview`),
  batch: (c: ApiClient, id: string) => get<BatchDetail>(c, `/batches/${encodeURIComponent(id)}`),
  createBatch: (c: ApiClient, body: BatchInput) =>
    c.api<ActionResult<BatchDetail>>({ method: 'POST', path: '/batches', body }),
  updateBatch: (c: ApiClient, id: string, body: BatchInput) =>
    c.api<ActionResult<BatchDetail>>({
      method: 'PUT',
      path: `/batches/${encodeURIComponent(id)}`,
      body,
    }),
  plant: (c: ApiClient, id: string) => get<PlantProfile>(c, `/plants/${encodeURIComponent(id)}`),
  logObservation: (c: ApiClient, id: string, note: string) =>
    c.api<ActionResult<PlantProfile>>({
      method: 'POST',
      path: `/plants/${encodeURIComponent(id)}/observations`,
      body: { note },
    }),
  permissions: (c: ApiClient) => get<PermissionMatrix>(c, '/admin/permissions'),
  setPermission: (c: ApiClient, body: PermissionChange) =>
    c.api<ActionResult<PermissionMatrix>>({ method: 'PUT', path: '/admin/permissions', body }),
  systemConfig: (c: ApiClient) => get<SystemConfig>(c, '/admin/config'),
  saveConfig: (c: ApiClient, values: Record<string, string>) =>
    c.api<ActionResult<SystemConfig>>({ method: 'PUT', path: '/admin/config', body: { values } }),
  audit: (c: ApiClient, q?: string) => get<AuditEntry[]>(c, '/admin/audit', { q }),
  workforce: (c: ApiClient, f: WorkforceFilters) =>
    get<WorkforcePerson[]>(c, '/workforce/people', { ...f }),
  workforcePerson: (c: ApiClient, id: string) =>
    get<WorkforcePersonDetail>(c, `/workforce/people/${encodeURIComponent(id)}`),
  updatePerson: (c: ApiClient, id: string, body: WorkforceUpdate) =>
    c.api<ActionResult<WorkforcePersonDetail>>({
      method: 'PUT',
      path: `/workforce/people/${encodeURIComponent(id)}`,
      body,
    }),
  deactivatePerson: (c: ApiClient, id: string) =>
    c.api<ActionResult<WorkforcePersonDetail>>({
      method: 'POST',
      path: `/workforce/people/${encodeURIComponent(id)}/deactivate`,
    }),
  invitePerson: (c: ApiClient, body: NewInvite) =>
    c.api<ActionResult<WorkforcePerson>>({ method: 'POST', path: '/workforce/people', body }),
  shifts: (c: ApiClient) => get<ShiftWeek>(c, '/workforce/shifts'),
  cycleShift: (c: ApiClient, id: string, day: number) =>
    c.api<ActionResult<ShiftWeek>>({
      method: 'POST',
      path: `/workforce/shifts/${encodeURIComponent(id)}/${day}/cycle`,
    }),
  escalation: (c: ApiClient) => get<EscalationConfig>(c, '/escalation'),
  escalationPreview: (c: ApiClient, type: string, slot: string) =>
    get<EscalationPreview>(c, '/escalation/preview', { type, slot }),
  updateEscalation: (c: ApiClient, body: EscalationUpdate) =>
    c.api<ActionResult<EscalationConfig>>({ method: 'PUT', path: '/escalation', body }),
  setOncall: (c: ApiClient, id: string, on: boolean) =>
    c.api<ActionResult<EscalationConfig>>({
      method: 'PUT',
      path: `/escalation/oncall/${encodeURIComponent(id)}`,
      body: { on },
    }),
  deliveries: (c: ApiClient) => get<NotificationDelivery[]>(c, '/escalation/deliveries'),
  handover: (c: ApiClient) => get<Handover>(c, '/handover/current'),
  signHandover: (c: ApiClient) =>
    c.api<ActionResult<Handover>>({ method: 'POST', path: '/handover/current/sign' }),
  acknowledgeHandover: (c: ApiClient) =>
    c.api<ActionResult<Handover>>({ method: 'POST', path: '/handover/current/acknowledge' }),

  dashboard: (c: ApiClient) => get<DashboardSummary>(c, '/dashboard'),
  healthTrend: (c: ApiClient) => get<Trend>(c, '/trends/health', { days: 30 }),
  environmentTrend: (c: ApiClient) => get<Trend>(c, '/trends/environment', { hours: 24 }),

  zones: (c: ApiClient) => get<Zone[]>(c, '/environment/zones'),
  zoneReadings: (c: ApiClient, zoneId: string) =>
    get<Reading[]>(c, `/zones/${encodeURIComponent(zoneId)}/readings/latest`),
  zoneHistory: (c: ApiClient, zoneId: string, variable: string, range: HistoryRange) =>
    get<ZoneHistory>(c, `/zones/${encodeURIComponent(zoneId)}/history`, { variable, range }),
  operatingRanges: (c: ApiClient) => get<OperatingRanges>(c, '/operating-ranges'),
  saveOperatingRanges: (c: ApiClient, body: RangesUpdate) =>
    c.api<ActionResult<OperatingRanges>>({ method: 'PUT', path: '/operating-ranges', body }),
  irrigation: (c: ApiClient) => get<IrrigationStatus>(c, '/irrigation/status'),

  devices: (c: ApiClient, f: DeviceFilters = {}) => get<Device[]>(c, '/devices', { ...f }),
  deviceSummary: (c: ApiClient) => get<DeviceSummary>(c, '/devices/summary'),
  device: (c: ApiClient, id: string) => get<DeviceDetail>(c, `/devices/${encodeURIComponent(id)}`),
  setDeviceMode: (c: ApiClient, id: string, mode: DeviceMode) =>
    c.api<ActionResult<DeviceDetail>>({
      method: 'POST',
      path: `/devices/${encodeURIComponent(id)}/mode`,
      body: { mode },
    }),
  scheduleMaintenance: (c: ApiClient, id: string) =>
    c.api<ActionResult<DeviceDetail>>({
      method: 'POST',
      path: `/devices/${encodeURIComponent(id)}/maintenance`,
    }),
  approveDevice: (c: ApiClient, id: string) =>
    c.api<ActionResult<DeviceDetail>>({
      method: 'POST',
      path: `/devices/${encodeURIComponent(id)}/approve`,
    }),
  rejectDevice: (c: ApiClient, id: string) =>
    c.api<ActionResult<null>>({
      method: 'POST',
      path: `/devices/${encodeURIComponent(id)}/reject`,
    }),
  registerDevice: (c: ApiClient, body: NewDevice) =>
    c.api<ActionResult<Device>>({ method: 'POST', path: '/devices', body }),
  alerts: (c: ApiClient, status: AlertStatus = 'open') => get<Alert[]>(c, '/alerts', { status }),
  tasks: (c: ApiClient, filter: TaskFilter = 'pending', q?: string) =>
    get<Task[]>(c, '/tasks', { filter, q }),
  taskSummary: (c: ApiClient) => get<TaskSummary>(c, '/tasks/summary'),
  task: (c: ApiClient, id: string) => get<TaskDetail>(c, `/tasks/${encodeURIComponent(id)}`),
  createTask: (c: ApiClient, body: NewTask) =>
    c.api<ActionResult<Task>>({ method: 'POST', path: '/tasks', body }),
  transitionTask: (
    c: ApiClient,
    id: string,
    action: Exclude<TaskAction, 'attach_photo'>,
    notes?: string,
  ) =>
    c.api<ActionResult<TaskDetail>>({
      method: 'POST',
      path: `/tasks/${encodeURIComponent(id)}/transition`,
      body: { action, notes },
    }),
  robots: (c: ApiClient) => get<Robot[]>(c, '/robots'),
  robotLive: (c: ApiClient) => get<RobotLive>(c, '/robots/live'),
  robotCommand: (c: ApiClient, body: RobotCommand) =>
    c.api<ActionResult<RobotLive>>({ method: 'POST', path: '/robots/LEFI-R1/commands', body }),
  simSpeed: (c: ApiClient, speed: 1 | 2 | 4) =>
    c.api<ActionResult<RobotLive>>({ method: 'PUT', path: '/robots/sim/speed', body: { speed } }),
  queueOp: (c: ApiClient, id: string, op: 'up' | 'down' | 'cancel') =>
    c.api<ActionResult<RobotLive>>({
      method: 'POST',
      path: `/missions/queue/${encodeURIComponent(id)}/${op}`,
    }),
  missions: (c: ApiClient) => get<MissionListItem[]>(c, '/missions'),
  mission: (c: ApiClient, id: string) =>
    get<MissionDetail>(c, `/missions/${encodeURIComponent(id)}`),
  shiftNow: (c: ApiClient) => get<ShiftNow>(c, '/shifts/current'),
  activity: (c: ApiClient) => get<ActivityItem[]>(c, '/activity', { limit: 4 }),
  people: (c: ApiClient) => get<Person[]>(c, '/people'),

  detections: (c: ApiClient, filter?: DetectionFilter) =>
    get<Detection[]>(c, '/detections', filter ? { filter } : undefined),
  detectionSummary: (c: ApiClient) => get<DetectionSummary>(c, '/detections/summary'),
  detection: (c: ApiClient, id: string) =>
    get<DetectionDetail>(c, `/detections/${encodeURIComponent(id)}`),
  reviewDetection: (c: ApiClient, id: string, decision: 'confirm' | 'reject') =>
    c.api<ActionResult<DetectionDetail>>({
      method: 'POST',
      path: `/detections/${encodeURIComponent(id)}/review`,
      body: { decision },
    }),
  requestInspection: (c: ApiClient, id: string) =>
    c.api<ActionResult<DetectionDetail>>({
      method: 'POST',
      path: `/detections/${encodeURIComponent(id)}/inspection`,
    }),

  incidents: (c: ApiClient, f: IncidentFilters) => get<Incident[]>(c, '/incidents', { ...f }),
  incidentSummary: (c: ApiClient) => get<IncidentSummary>(c, '/incidents/summary'),
  incident: (c: ApiClient, id: string) =>
    get<IncidentDetail>(c, `/incidents/${encodeURIComponent(id)}`),
  reportIncident: (c: ApiClient, body: NewIncident) =>
    c.api<ActionResult<Incident>>({ method: 'POST', path: '/incidents', body }),
  transitionIncident: (c: ApiClient, id: string, body: IncidentTransition) =>
    c.api<ActionResult<IncidentDetail>>({
      method: 'POST',
      path: `/incidents/${encodeURIComponent(id)}/transition`,
      body,
    }),
  assignIncident: (c: ApiClient, id: string, assignee: string) =>
    c.api<ActionResult<IncidentDetail>>({
      method: 'POST',
      path: `/incidents/${encodeURIComponent(id)}/assign`,
      body: { assignee },
    }),
};
