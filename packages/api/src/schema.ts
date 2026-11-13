/**
 * Brain REST types.
 *
 * Types for what the Brain serves today (health, session, login, password change, errors) are
 * GENERATED from its OpenAPI document (`openapi/brain.openapi.json`, ADR-005): run
 * `pnpm --filter @lefi/api gen` after changing the Brain. Everything below "Not served by the
 * Brain yet" is still the client's hand-written PROPOSAL, served only by `packages/mock-brain`
 * with fake data; each block moves to the generated types when the Brain module exists.
 * Field names are snake_case, as FastAPI/Pydantic emit them.
 */
import type { Freshness, Health, Origin, Severity, Tone } from '@lefi/ui';
import type { components } from './generated/brain';

export type IsoTime = string;

type BrainSchemas = components['schemas'];

// ── Served by the Brain (generated) ───────────────────────────────────────────
export type BrainHealth = BrainSchemas['Health'];
export type SessionUser = BrainSchemas['SessionUserOut'];
export type Role = BrainSchemas['RoleOut'];
/** Permissions are granted by the Brain. The UI only hides; the API enforces. */
export type Session = BrainSchemas['SessionOut'];
export type LoginRequest = BrainSchemas['LoginRequest'];
export type PasswordChange = BrainSchemas['PasswordChange'];
export type PermissionsOut = BrainSchemas['PermissionsOut'];
export type RoleMatrix = BrainSchemas['RoleMatrixOut'];
/** Body of every non-2xx answer: `{ "error": { "code", "message", "details" } }`. */
export type BrainErrorBody = BrainSchemas['ErrorOut'];

// Lefi AI assistant (ADR-067): read-only chat over role-scoped tools.
export type AssistantStatus = BrainSchemas['AssistantStatusOut'];
export type AiConversationSummary = BrainSchemas['ConversationSummaryOut'];
export type AiConversation = BrainSchemas['ConversationOut'];
export type AiMessage = BrainSchemas['MessageOut'];
export type AiToolUse = BrainSchemas['ToolUseOut'];
export type ChatRequest = BrainSchemas['ChatIn'];

// ── Not served by the Brain yet: proposal, mock-brain only ────────────────────
// ── System ────────────────────────────────────────────────────────────────────
export type ServiceState = 'up' | 'down' | 'degraded' | 'unknown';
export type AiState = 'available' | 'unavailable' | 'disabled';
export type HaltScope = 'ai' | 'all';

export interface SystemStatus {
  /** Brain clock (ADR-008). */
  brain_time: IsoTime;
  brain_version: string;
  /** True when served by the development mock, never by a real Brain. */
  mock: boolean;
  /** Outdoor temperature if an outdoor sensor exists, else null. */
  outside_temp_c: number | null;
  services: { mqtt: ServiceState; database: ServiceState };
  ai: {
    state: AiState;
    /** Kill switch (`lefi ai off` or STOP AI). */
    kill_switch: boolean;
    halt_scope: HaltScope | null;
    model: string | null;
    reason: string | null;
  };
}

export interface HaltRequest {
  scope: HaltScope;
  reason: string;
}

/** Counters for sidebar items, keyed by screen id. */
export type NavCounters = Record<string, { count: number | string; tone: Tone }>;

// ── Dashboard ─────────────────────────────────────────────────────────────────
export interface DashboardSummary {
  site_name: string;
  greenhouse_count: number;
  shift: { name: string; start: string; end: string } | null;
  health_score: { value: number; delta_day: number; delta_30d: number; label: string } | null;
  zones: { active: number; total: number; healthy: number; warning: number; critical: number };
  plants: { total: number; batches: number; varieties: number; harvest_ready_week: number };
  plant_condition: { healthy: number; warning: number; critical: number };
  /** Role-specific shortcuts shown as chips. `screen` is a screen id. */
  /** `search` = query params so the chip opens the exact item. */
  focus: Array<{ label: string; tone: Tone; screen: string; search: Record<string, string> }>;
  /** Zones the Brain features in "Current conditions" (first = default). */
  condition_zones: string[];
  origin: Origin;
}

export interface Trend {
  labels: string[];
  series: Record<string, number[]>;
  origin: Origin;
}

// ── Greenhouse model ──────────────────────────────────────────────────────────
export interface Zone {
  id: string;
  name: string;
  greenhouse_id: string;
  greenhouse_name: string;
  crop: string | null;
  health: Health;
}

export interface Range {
  min: number;
  max: number;
  is_placeholder: boolean;
}

export interface Reading {
  sensor_id: string;
  variable: string;
  label: string;
  unit: string;
  value: number | null;
  decimals: number;
  origin: Origin;
  /** sensor = physical sensor · estimate = model estimate (no sensor installed) · none = no data. */
  source: ReadingSource;
  freshness: Freshness;
  received_at: IsoTime | null;
  status: Health;
  range: Range | null;
  /** Recent values, oldest first, for sparklines. */
  history: number[];
}

export interface CropProfileRef {
  id: string;
  name: string;
  is_placeholder: boolean;
}

export type ReadingSource = 'sensor' | 'estimate' | 'none';
export type HistoryRange = '24h' | '7d' | '30d';

/** One variable of one zone over a period; statistics are computed by the Brain. */
export interface ZoneHistory {
  zone_id: string;
  variable: string;
  label: string;
  unit: string;
  decimals: number;
  range: Range | null;
  source: ReadingSource;
  origin: Origin;
  freshness: Freshness;
  labels: IsoTime[];
  values: number[];
  stats: {
    current: number;
    average: number;
    min: number;
    max: number;
    time_in_range_pct: number;
  } | null;
  /** Why there is no data, in words for the user. */
  unavailable_note: string | null;
}

export interface OperatingRanges {
  profile: CropProfileRef;
  rows: Array<{
    variable: string;
    label: string;
    unit: string;
    min: number;
    max: number;
    step: number;
  }>;
  can_edit: ActionAvailability;
}

export interface RangesUpdate {
  rows: Array<{ variable: string; min: number; max: number }>;
}

/** Irrigation is interface-only and disabled by design. */
export interface IrrigationStatus {
  state: 'DISABLED';
  reason: string;
}

// ── Devices, alerts, tasks ────────────────────────────────────────────────────
export type DeviceLifecycle = 'PENDING' | 'ACTIVE' | 'MISSING' | 'RETIRED';
export type DeviceCategory = 'sensor' | 'camera' | 'actuator' | 'robot' | 'drone';
/** on = platform + AI · ai = AI isolated · paused = readings paused · off = powered off. */
export type DeviceMode = 'on' | 'ai' | 'paused' | 'off';

export interface Device {
  id: string;
  category: DeviceCategory;
  type: string;
  brand: string;
  model: string;
  serial: string;
  greenhouse_id: string;
  zone_id: string | null;
  zone_label: string;
  position: string;
  location_label: string;
  protocol: string;
  firmware: string;
  signal: string;
  battery: string;
  last_seen_label: string;
  /** Display status from the Brain (Online, Offline, Low battery, Readings paused, Pending approval…). */
  status: string;
  health: number | null;
  mode: DeviceMode;
  lifecycle: DeviceLifecycle;
  origin: Origin;
  service: { interval_days: number | null; due_days: number | null; last: string; next: string };
}

export interface DeviceFilters {
  zone?: string;
  category?: 'sensor' | 'camera' | 'actuator' | 'robot';
  status?: 'attention' | 'offline' | 'due14' | 'isolated' | 'pending';
  q?: string;
}

export interface DeviceSummary {
  registered: number;
  online: number;
  offline: number;
  service_due_14d: number;
  isolated_paused_off: number;
  pending_approval: number;
  categories: { all: number; sensor: number; camera: number; actuator: number; robot: number };
}

export type DeviceAction = 'schedule_maintenance' | 'approve' | 'reject';

export interface DeviceDetail extends Device {
  power_control: string;
  installed: string;
  warranty_until: string;
  history: Array<{ date: string; what: string; who: string }>;
  modes: Record<DeviceMode, ActionAvailability>;
  actions: Record<DeviceAction, ActionAvailability>;
}

export interface NewDevice {
  type: string;
  brand: string;
  model: string;
  serial: string;
  mac?: string;
  firmware?: string;
  zone_id: string;
  position?: string;
  protocol?: string;
  interval_days?: number;
}

export type AlertStatus = 'open' | 'acknowledged' | 'resolved';
export type AlertCategory = 'sensor' | 'device' | 'climate' | 'ai' | 'system';

export interface Alert {
  id: string;
  severity: Severity;
  category: AlertCategory;
  title: string;
  zone_id: string | null;
  device_id: string | null;
  origin: Origin;
  status: AlertStatus;
  created_at: IsoTime;
}

export type TaskPriority = 'critical' | 'high' | 'normal';

export type TaskStatus = 'Open' | 'In progress' | 'Awaiting verification' | 'Verified';
/** `pending` = everything not verified (dashboard). */
export type TaskFilter = 'open' | 'in_progress' | 'awaiting' | 'verified' | 'pending' | 'all';

export interface Task {
  id: string;
  title: string;
  zone_id: string | null;
  assignee: string | null;
  due_label: string;
  priority: TaskPriority;
  status: TaskStatus;
  /** Who proposed the task: the AI (a recommendation turned into work) or a person. */
  created_by: 'ai' | 'human';
  incident_id: string | null;
  type: 'Task' | 'Work order';
  origin: Origin;
}

export interface TaskSummary {
  scope_label: string;
  counts: { open: number; in_progress: number; awaiting: number; verified: number; all: number };
  can_create: ActionAvailability;
}

export type TaskAction = 'start' | 'submit' | 'verify' | 'return' | 'attach_photo';

export interface TaskDetail extends Task {
  source: string;
  notes: string | null;
  evidence: Array<{ label: string; image_url: string | null }>;
  verified_by: string | null;
  actions: Record<TaskAction, ActionAvailability>;
}

export interface NewTask {
  title: string;
  zone_id: string;
  assignee: string;
  priority: TaskPriority;
}

// ── Robots ────────────────────────────────────────────────────────────────────
export interface Robot {
  id: string;
  name: string;
  kind: string;
  origin: Origin;
  mode: string;
  state: 'docked' | 'on_mission' | 'safe_stop' | 'maintenance' | 'offline';
  battery_pct: number | null;
  last_mission: { title: string; state: string; images: number; ai_flags: number } | null;
  note: string | null;
}

// ── People ────────────────────────────────────────────────────────────────────
export interface ShiftNow {
  name: string;
  start: string;
  end: string;
  on_site: Array<{ name: string; role_id: string }>;
  on_break: number;
}

export interface ActivityItem {
  time: string;
  who: string;
  what: string;
}

// ── AI ────────────────────────────────────────────────────────────────────────
export interface AiSummary {
  state: AiState;
  /** Markdown-light: `**bold**` only. */
  text: string | null;
  generated_at: IsoTime | null;
  basis: string | null;
  /** True when the text is a fixture, not produced by the AI. */
  simulated: boolean;
}

export interface AiBriefing {
  state: AiState;
  happened: string | null;
  why: string | null;
  done: string[];
  next: string[];
  simulated: boolean;
}

// ── Incidents (Alerts & Incidents screen) ─────────────────────────────────────
export type IncidentStatus = 'New' | 'Acknowledged' | 'Investigating' | 'Resolved' | 'Closed';

export interface IncidentFilters {
  severity?: Severity;
  /** `open` = New + Acknowledged + Investigating. */
  status?: IncidentStatus | 'open';
  source?: 'automatic' | 'manual';
  q?: string;
}

export interface Incident {
  id: string;
  detected_at: IsoTime;
  zone_id: string | null;
  zone_label: string;
  area: string;
  plant_id: string | null;
  title: string;
  severity: Severity;
  source: { kind: 'automatic' | 'manual'; label: string };
  ai_confidence: number | null;
  status: IncidentStatus;
  assignee: string | null;
  origin: Origin;
}

export interface IncidentSummary {
  open: number;
  critical_open: number;
  unacknowledged: number;
  median_ack_minutes: number | null;
}

/** Whether the signed-in user may perform an action now, decided by the Brain (state + RBAC). */
export interface ActionAvailability {
  allowed: boolean;
  /** Why not, in words for the user (missing permission, wrong state…). */
  reason: string | null;
}

export type IncidentAction = 'acknowledge' | 'investigate' | 'resolve' | 'close' | 'assign';

export interface IncidentDetail extends Incident {
  ack_minutes: number | null;
  evidence: string[];
  recommendation: { text: string; simulated: boolean } | null;
  timeline: Array<{ time: string; text: string }>;
  escalation: Array<{ time: string; what: string; state: string }>;
  notifications: Array<{
    time: string;
    channel: string;
    recipient: string;
    status: string;
    ok: boolean;
  }>;
  missions: string[];
  resolution: string | null;
  actions: Record<IncidentAction, ActionAvailability>;
}

export interface NewIncident {
  title: string;
  zone_id: string;
  severity: Severity;
}

export interface IncidentTransition {
  action: Exclude<IncidentAction, 'assign'>;
  /** Required by the Brain to resolve (resolution evidence). */
  note?: string;
}

/** Answer to a state-changing request: the new state plus the Brain's message. */
export interface ActionResult<T> {
  item: T;
  message: string;
}

export interface Person {
  name: string;
  role_id: string;
}

// ── AI Plant Health (computer-vision detections) ─────────────────────────────
export type DetectionStatus = 'unconfirmed' | 'inspection' | 'confirmed' | 'rejected';
export type DetectionFilter = 'awaiting' | 'confirmed' | 'rejected';

export interface Detection {
  id: string;
  zone_id: string;
  plant_id: string;
  finding: string;
  severity: Severity;
  confidence: number;
  status: DetectionStatus;
  captured_at: IsoTime;
  origin: Origin;
  /** True when the detection is a fixture, not produced by a vision model. */
  simulated: boolean;
}

export interface DetectionSummary {
  awaiting_review: number;
  confirmed_7d: number;
  images_today: number;
  /** Vision model reported by the Brain; null when none is connected. */
  model: string | null;
  model_note: string | null;
  counts: { all: number; awaiting: number; confirmed: number; rejected: number };
}

export type DetectionAction = 'confirm' | 'reject' | 'request_inspection';

export interface DetectionDetail extends Detection {
  category: string;
  variety: string;
  batch: string;
  camera: string;
  reviewer: string | null;
  /** `image_url` is null when there is no real image (never a stand-in picture). */
  frame: { image_url: string | null; label: string; resolution: string };
  comparison: {
    interval: string;
    before: string;
    after: string;
    changes: Array<{ metric: string; value: string }>;
  };
  /** Bounding boxes in % of the frame. */
  boxes: Array<{
    label: string;
    x: number;
    y: number;
    w: number;
    h: number;
    tone: 'ok' | 'warn' | 'crit';
  }>;
  leaf_colour: Array<{ key: string; label: string; pct: number }>;
  growth: Array<{ metric: string; value: string; delta: string }>;
  symptoms: string[];
  evidence: string[];
  review_threshold: number;
  recommendation: { text: string; simulated: boolean };
  actions: Record<DetectionAction, ActionAvailability>;
}

// ── AI Control & Safety ───────────────────────────────────────────────────────
export type AutonomyMode = 'off' | 'ask' | 'auto';
export type ServiceRunState = 'online' | 'stopped' | 'unreachable' | 'safe_hold' | 'not_connected';

export interface AiControl {
  status: { state: 'online' | 'halted' | 'unavailable'; label: string; detail: string };
  services: Array<{ name: string; kind: 'ai' | 'rules'; state: ServiceRunState }>;
  actions: { halt: ActionAvailability; resume: ActionAvailability };
  manual_mode: { keeps: string[]; paused: string[] };
  automations: Array<{
    id: string;
    source: 'ai' | 'rules';
    title: string;
    target: string;
    by: string;
    since: string;
    icon: string;
    running: boolean;
    origin: Origin;
    actions: { stop: ActionAvailability; restart: ActionAvailability };
  }>;
  automations_note: string | null;
  autonomy: {
    can_edit: ActionAvailability;
    rows: Array<{
      key: string;
      label: string;
      area: string;
      risk: 'Low' | 'Medium' | 'High' | 'Critical';
      mode: AutonomyMode;
      approver: string;
      note: string;
      modes: Record<AutonomyMode, ActionAvailability>;
    }>;
    guardrails: Array<{ key: string; label: string; description: string; on: boolean }>;
    max_per_hour: number;
    /** Roles that can approve AI suggestions (role ids from the Brain). */
    approvers: Array<{ id: string; label: string }>;
  };
  settings: {
    can_edit: ActionAvailability;
    depth: 'Fast' | 'Standard' | 'Deep research';
    sources: Array<{ key: string; label: string; on: boolean; available: ActionAvailability }>;
    min_confidence: number;
    corroborating: number;
    rescan: string;
    toggles: Array<{
      key: string;
      label: string;
      description: string;
      on: boolean;
      available: ActionAvailability;
    }>;
  };
}

export interface AutonomyUpdate {
  row?: { key: string; mode?: AutonomyMode; approver?: string };
  guardrail?: { key: string; on: boolean };
  max_per_hour?: number;
}

/** Partial update; `source` / `toggle` flip one item. */
export interface AiSettingsUpdate {
  depth?: AiControl['settings']['depth'];
  source?: string;
  toggle?: string;
  min_confidence?: number;
  corroborating?: number;
  rescan?: string;
}

// ── Shift Handover ────────────────────────────────────────────────────────────
export interface ShiftParty {
  name: string;
  role_id: string;
  shift: string;
}

export interface HandoverHighlight {
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'crit';
}

/**
 * Current shift handover. Incidents, tasks and pending inspections come from their own
 * endpoints; this carries what only the handover owns (parties, signatures, summary).
 */
export interface Handover {
  title: string;
  outgoing: ShiftParty;
  incoming: ShiftParty;
  /** Signature of the outgoing supervisor (who, Brain clock). */
  signed: { by: string; at: string } | null;
  acknowledged: { by: string; at: string } | null;
  summary: AiBriefing;
  environment: HandoverHighlight[];
  plants: HandoverHighlight[];
  missions: Array<{ id: string; title: string; state: string; summary: string }>;
  origin: Origin;
  actions: { sign: ActionAvailability; acknowledge: ActionAvailability };
}

// ── Escalation Rules ──────────────────────────────────────────────────────────
export type EscalationMode = 'dynamic' | 'fixed';
export type NotifyChannel = 'dashboard' | 'push' | 'sms' | 'voice';
export type EscalationLevelKey = 'info' | 'warn' | 'crit';

export interface EscalationConfig {
  /** Edit hint for the current role (read-only vs audited changes). */
  note: string;
  can_edit: ActionAvailability;
  can_edit_oncall: ActionAvailability;
  mode: EscalationMode;
  description: string;
  /** Set when dynamic routing is configured but the Brain is using the fixed chain. */
  fallback_notice: string | null;
  rules: Array<{ key: string; label: string; description: string; on: boolean }>;
  incident_types: Array<{ id: string; label: string }>;
  slots: Array<{ id: string; label: string }>;
  /** Channels the Brain can deliver on; SMS / voice need a gateway and are off by default. */
  channels: Array<{
    key: NotifyChannel;
    label: string;
    description: string;
    available: ActionAvailability;
  }>;
  levels: Array<{
    key: EscalationLevelKey;
    severity: Severity;
    description: string;
    channels: NotifyChannel[];
    /** Minutes before escalating to the next level; null = no escalation. */
    timeout_min: number | null;
  }>;
  chain: Array<{ level: number; role: string; who: string; when: string }>;
  quiet_hours: { label: string; description: string; on: boolean };
  oncall: Array<{
    id: string;
    name: string;
    role_id: string;
    role_label: string;
    phone: string;
    on: boolean;
    primary: boolean;
  }>;
  rotation: Array<{ day: string; who: string; today: boolean }>;
  /** Escalations in progress (acknowledgement timers and attempts). */
  live: Array<{
    incident_id: string;
    title: string;
    next: string | null;
    attempts: Array<{ time: string; channel: string; who: string; state: string }>;
  }>;
  origin: Origin;
}

export interface EscalationPreview {
  mode_used: EscalationMode;
  /** What resolved the routing (e.g. deterministic rules); shown with the preview. */
  resolver: string;
  steps: Array<{
    level: number;
    who: string;
    role: string;
    why: string;
    channels: string;
    when: string;
  }>;
  skipped: string[];
}

export interface EscalationUpdate {
  mode?: EscalationMode;
  rule?: { key: string; on: boolean };
  /** `channel` toggles one channel; `timeout_min` sets the acknowledgement window. */
  level?: { key: EscalationLevelKey; channel?: NotifyChannel; timeout_min?: number };
  quiet_hours?: boolean;
}

export interface NotificationDelivery {
  time: string;
  incident_id: string;
  channel: string;
  recipient: string;
  message: string;
  state: string;
  tone: 'ok' | 'warn' | 'crit';
  origin: Origin;
}

// ── Workforce ─────────────────────────────────────────────────────────────────
export interface RoleInfo {
  id: string;
  name: string;
  short: string;
}

export interface WorkforcePerson {
  id: string;
  name: string;
  email: string;
  role_id: string;
  role_name: string;
  /** `All`, a greenhouse id (`GH-1`) or zone ids. */
  zones: string[];
  status: string;
}

export interface WorkforceFilters {
  q?: string;
  role?: string;
}

export interface WorkforcePersonDetail extends WorkforcePerson {
  phone: string;
  last_active: string;
  zone_access: Array<{ id: string; label: string; on: boolean }>;
  roles: Array<{ id: string; label: string }>;
  notifications: {
    /** In-app, email, SMS — email / SMS need a server or gateway and are off by default. */
    channels: Array<{ key: string; label: string; available: ActionAvailability }>;
    events: Array<{ key: string; label: string; on: boolean[] }>;
    can_edit: ActionAvailability;
  };
  recent: Array<{ at: string; user: string; action: string; target: string; detail: string }>;
  actions: {
    change_role: ActionAvailability;
    edit_zones: ActionAvailability;
    deactivate: ActionAvailability;
  };
  origin: Origin;
}

export interface WorkforceUpdate {
  role?: string;
  /** Toggles access to one zone (or `All`). */
  zone?: string;
  /** Toggles one event × channel preference. */
  notify?: { event: string; channel: string };
}

export interface NewInvite {
  name: string;
  email: string;
  role: string;
}

export type ShiftCode = 'D' | 'E' | 'O' | 'P';

export interface ShiftWeek {
  title: string;
  note: string | null;
  can_edit: ActionAvailability;
  days: Array<{ label: string; today: boolean }>;
  rows: Array<{
    id: string;
    name: string;
    role_id: string;
    role_label: string;
    hours: number;
    availability: string;
    availability_tone: Tone;
    cells: Array<{ code: ShiftCode; label: string; time: string }>;
  }>;
  coverage: Array<{ day: number; evening: number }>;
  origin: Origin;
}

// ── Administration ────────────────────────────────────────────────────────────
export interface PermissionMatrix {
  note: string;
  can_edit: ActionAvailability;
  roles: Array<{ id: string; short: string; name: string; users: number }>;
  groups: Array<{
    label: string;
    rows: Array<{
      key: string;
      label: string;
      /** Role ids that hold the permission. */
      roles: string[];
      /** Role ids that must keep it (lock-out protection). */
      locked: string[];
    }>;
  }>;
}

export interface PermissionChange {
  permission: string;
  role: string;
  granted: boolean;
}

export interface SystemConfig {
  can_edit: ActionAvailability;
  sections: Array<{
    title: string;
    fields: Array<{
      key: string;
      label: string;
      kind: 'text' | 'number' | 'toggle';
      unit: string | null;
      /** Always a string; the Brain parses and validates it. `toggle` uses on / off. */
      value: string;
      hint: string | null;
      /** Not allowed ⇒ read-only, with the reason (installer, firmware, ADR, role). */
      editable: ActionAvailability;
    }>;
  }>;
  origin: Origin;
}

export interface AuditEntry {
  at: string;
  user: string;
  action: string;
  target: string;
  detail: string;
  source: string;
  kind: 'ok' | 'denied' | 'system';
}

// ── Greenhouses & Crops ───────────────────────────────────────────────────────
/** A health score with the Brain's tone and label (simulated while no vision model exists). */
export interface HealthScore {
  value: number;
  tone: 'ok' | 'warn' | 'crit';
  label: string;
}

export interface GreenhouseList {
  /** Set when the user only sees their assigned zones. */
  scope_note: string | null;
  can_create_batch: ActionAvailability;
  items: Array<{
    id: string;
    name: string;
    area: string;
    system: string;
    health: HealthScore;
    zones: Array<{ id: string; health: HealthScore }>;
    plants: number;
    avg_temp_c: number;
    avg_rh_pct: number;
    image_url: string | null;
    origin: Origin;
  }>;
}

export interface GreenhouseDetail {
  id: string;
  name: string;
  area: string;
  system: string;
  structure: string;
  heating: string;
  commissioned: string;
  health: HealthScore;
  image_url: string | null;
  zones: Array<{
    id: string;
    name: string;
    crop: string;
    health: HealthScore;
    temp_c: number;
    rh_pct: number;
    ec: number;
    plants: number;
    batches: number;
  }>;
  origin: Origin;
}

export interface BatchRow {
  id: string;
  variety: string;
  sown: string;
  day: number;
  plants: number;
  stage: string;
  /** 0–100 towards harvest / transplant. */
  progress: number;
  health: HealthScore;
}

export interface ZoneOverview {
  id: string;
  name: string;
  greenhouse_id: string;
  greenhouse_name: string;
  crop: string;
  plants: number;
  health: HealthScore;
  batches: BatchRow[];
  can_create_batch: ActionAvailability;
  origin: Origin;
}

export interface BatchDetail extends BatchRow {
  lot: string;
  zone_id: string;
  zone_name: string;
  greenhouse_id: string;
  target_label: string;
  target: string;
  timeline: Array<{
    label: string;
    day: number;
    date: string;
    state: 'done' | 'current' | 'planned';
  }>;
  /** Heights per day in cm; `simulated` while no imaging pipeline exists. */
  growth: {
    span_days: number;
    measured: number[];
    projected: number[];
    max_cm: number;
    simulated: boolean;
  };
  plants_tracked: Array<{ id: string; health: HealthScore; row: string; image_url: string | null }>;
  actions: { edit: ActionAvailability };
  origin: Origin;
}

export interface BatchInput {
  zone_id?: string;
  variety: string;
  plants: number;
  sown_days_ago: number;
  lot?: string;
}

export interface PlantProfile {
  id: string;
  variety: string;
  row: string;
  batch_id: string;
  zone_id: string;
  zone_name: string;
  greenhouse_name: string;
  stage: string;
  age_days: number;
  sown: string;
  progress: number;
  health: HealthScore;
  health_14d: number[];
  height_cm: number;
  leaves: number;
  /** Height, leaves and health are estimates; true while they are simulated. */
  estimates_simulated: boolean;
  image_url: string | null;
  environment: Array<{ label: string; value: string; note: string }>;
  /** The ranges behind "Within range" are a placeholder crop profile. */
  ranges_placeholder: boolean;
  detections: Array<{
    id: string;
    finding: string;
    confidence: number;
    status: DetectionStatus;
    at: IsoTime;
    source: string;
  }>;
  observations: Array<{ at: string; who: string; role: string; note: string }>;
  actions: { observe: ActionAvailability };
  origin: Origin;
}

// ── Zones & Inventory ─────────────────────────────────────────────────────────
export interface ZoneInventoryList {
  summary: string;
  can_create: ActionAvailability;
  items: Array<{
    id: string;
    name: string;
    greenhouse_name: string;
    crop: string;
    /** `off` = no health data (e.g. a new zone without sensors). */
    tone: Tone;
    sensors_live: number;
    sensors_total: number;
    cameras: number;
    robots: number;
    crew: number;
    service_due: number;
    custom: boolean;
  }>;
  origin: Origin;
}

export interface ZoneInventory {
  id: string;
  name: string;
  greenhouse_id: string;
  greenhouse_name: string;
  custom: boolean;
  params: Array<{ label: string; value: string }>;
  devices: Array<{
    id: string;
    category: DeviceCategory;
    brand: string;
    model: string;
    status: string;
    mode: DeviceMode;
    due_days: number | null;
    origin: Origin;
  }>;
  robots: Array<{ id: string; type: string; mode: DeviceMode; origin: Origin }>;
  crew: Array<{ name: string; role_id: string; role_label: string }>;
  maintenance: Array<{ device_id: string; type: string; date: string; due_days: number }>;
  origin: Origin;
}

export interface ZoneForm {
  can_create: ActionAvailability;
  greenhouses: Array<{ id: string; label: string; next_id: string }>;
  uses: string[];
  systems: string[];
  robot_speeds: string[];
  supervisors: string[];
}

export interface NewZone {
  greenhouse_id: string;
  name: string;
  use: string;
  crop: string;
  system: string;
  area_m2: number;
  rows: number;
  plants: number | null;
  supervisor: string;
  robot_speed: string;
}

// ── Global search ─────────────────────────────────────────────────────────────
/** A search result the app can open: `to` is a screen path, `search` its query params. */
export interface SearchHit {
  kind: string;
  id: string;
  label: string;
  sub: string;
  icon: string;
  to: string;
  search: Record<string, string>;
}

// ── Robot Mission Center (simulated robot) ────────────────────────────────────
export type RobotControl =
  'pause' | 'resume' | 'cancel' | 'return' | 'photo' | 'video' | 'status' | 'goto';
export type RobotIntent =
  | 'nav.goto'
  | 'nav.pause'
  | 'nav.resume'
  | 'nav.return'
  | 'mission.cancel'
  | 'camera.photo'
  | 'camera.video.start'
  | 'camera.video.stop'
  | 'query.status'
  | 'query.findings';

export interface MapPoint {
  x: number;
  y: number;
}

export interface RobotLive {
  sim: { speed: 1 | 2 | 4; driver: string; simulated: boolean };
  fleet: Array<{
    id: string;
    home: string;
    kind: 'rover' | 'drone';
    state: string;
    battery_pct: number | null;
    link: string;
    simulated: boolean;
    adapter: boolean;
  }>;
  robot: {
    id: string;
    model: string;
    mode: string;
    battery_pct: number;
    link: string;
    position: MapPoint;
    position_m: MapPoint;
    location: string;
    speed_mps: number;
    remaining_m: number | null;
  };
  map: {
    title: string;
    subtitle: string;
    width: number;
    height: number;
    aisle_y: number;
    dock: MapPoint;
    zones: Array<{
      id: string;
      label: string;
      x: number;
      y: number;
      w: number;
      h: number;
      restricted: boolean;
    }>;
    targets: Array<{ id: string; x: number; y: number; allowed: boolean; reason: string | null }>;
    route: MapPoint[];
    crew: Array<{ label: string; x: number; y: number }>;
  };
  /** 1-based step of the 12-step inspection workflow; 0 = idle. */
  workflow_step: number;
  /** Steps that do not apply to this mission (e.g. AI steps for a manual dispatch). */
  workflow_skipped: number[];
  mission: null | {
    id: string;
    title: string;
    origin: string;
    target: string;
    state: string;
    elapsed_s: number;
    photos: number;
    log: Array<{ time: string; state: string; note: string }>;
  };
  camera: { live: boolean; label: string; time: string };
  photos: Array<{ id: string; label: string; time: string; by: string; image_url: string | null }>;
  summary: { state: AiState; text: string | null; simulated: boolean };
  commands: Array<{
    id: number;
    time: string;
    who: string;
    via: string;
    text: string;
    intent: string;
    label: string;
    auth: 'allowed' | 'denied' | 'n/a';
    exec: 'Executed' | 'Rejected' | 'Not understood' | 'Paused';
    result: string;
    /** How the text was turned into an intent (e.g. a keyword parser, not AI). */
    parser: string;
  }>;
  queue: Array<{ id: string; title: string; origin: string; target: string; priority: string }>;
  controls: Record<RobotControl, ActionAvailability>;
  queue_actions: ActionAvailability;
  auth_note: string;
}

export interface RobotCommand {
  intent?: RobotIntent;
  arg?: string | null;
  /** Free text; interpreted by the Brain and validated like any other command. */
  text?: string;
}

export interface MissionListItem {
  id: string;
  title: string;
  origin: string;
  state: string;
  start: string;
}

export interface MissionDetail extends MissionListItem {
  target: string;
  end: string;
  distance: string;
  photos: number;
  robot: string;
  adapter: string;
  log: Array<{ time: string; state: string; note: string }>;
  checks: Array<{ label: string; passed: boolean }>;
  summary: { text: string; simulated: boolean };
  photo_labels: string[];
}
