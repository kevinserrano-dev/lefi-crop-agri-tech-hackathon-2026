/**
 * Mock Brain responses built from the design dataset (design-data.ts). Every value is FAKE
 * and labelled: readings and records carry `origin: SIMULATED`, AI text carries
 * `simulated: true`, and /system/status reports `mock: true`.
 */
import * as d from './design-data.ts';
import * as inc from './incidents.ts';
import * as dev from './devices.ts';
import * as det from './detections.ts';
import * as rob from './robotSim.ts';
import * as tk from './tasks.ts';

export interface MockState {
  halted: 'ai' | 'all' | null;
  haltReason: string;
  haltedBy?: string;
  haltedAt?: string;
}

export interface MockUser {
  username: string;
  email: string;
  password: string;
  display_name: string;
  role: { id: d.RoleId; name: string; short: string };
  permissions: string[];
}

export const USERS: MockUser[] = d.ROLES.map((r) => ({
  username: r.id,
  email: d.email(r.user),
  password: 'demo',
  display_name: r.user,
  role: { id: r.id, name: r.name, short: r.short },
  permissions: Object.entries(d.PERMS)
    .filter(([, roles]) => roles.includes(r.id))
    .map(([p]) => p),
}));

const SIM = 'SIMULATED' as const;

/** "HH:MM" earlier today on the design's 09:42 clock → ISO time relative to now. */
function designTime(now: Date, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const minutesBefore = 9 * 60 + 42 - (h * 60 + m);
  return new Date(now.getTime() - minutesBefore * 60_000).toISOString();
}

export function systemStatus(now: Date, s: MockState) {
  return {
    brain_time: now.toISOString(),
    brain_version: '0.0.0-mock',
    mock: true,
    outside_temp_c: 7,
    services: { mqtt: 'unknown', database: 'unknown' },
    ai: {
      state: s.halted ? 'disabled' : 'available',
      kill_switch: Boolean(s.halted),
      halt_scope: s.halted,
      model: 'mock (no model)',
      reason: s.halted ? `Stopped from the admin${s.haltReason ? `: ${s.haltReason}` : ''}` : null,
    },
  };
}

export function navCounters(
  perms: string[],
  s: MockState,
  actor: { name: string; role: d.RoleId; permissions: string[] },
) {
  const all: Record<string, { count: number | string; tone: string }> = {
    environment: { count: 2, tone: 'crit' },
    plantHealth: { count: det.unconfirmedCount(), tone: 'warn' },
    alerts: { count: inc.openCount(), tone: 'crit' },
    tasks: { count: tk.pendingCount(actor), tone: 'off' },
    devices: { count: dev.attentionCount(), tone: 'warn' },
  };
  if (s.halted) all.aiControl = { count: 'OFF', tone: 'crit' };
  return Object.fromEntries(Object.entries(all).filter(([id]) => perms.includes(`nav.${id}`)));
}

/** Focus chips open the exact item they mention. */
const FOCUS_LINK: Record<string, Record<string, string>> = {
  '1 device offline · GH2-Z3': { device: 'SM-GH2-Z3-02' },
  'Role change logged today': { tab: 'audit' },
  '2 critical alerts · GH2-Z3': { zone: 'GH2-Z3' },
  'EC drift · GH2-Z3': { zone: 'GH2-Z3' },
  'Probe offline · GH2-Z3': { zone: 'GH2-Z3' },
  'B-2611 harvest-ready': { gh: 'GH-1', zone: 'GH1-Z1', batch: 'B-2611' },
  'Evening shift starts 14:00': { tab: 'shifts' },
};

export function dashboard(role: d.RoleId) {
  return {
    site_name: 'Lefi Farms Leamington',
    greenhouse_count: 3,
    shift: { name: 'Day shift', start: '06:00', end: '14:30' },
    health_score: { value: 89, delta_day: -1, delta_30d: 3, label: 'Stable' },
    zones: { active: 9, total: 9, healthy: 6, warning: 2, critical: 1 },
    plants: { total: 486200, batches: 18, varieties: 7, harvest_ready_week: 2 },
    plant_condition: { healthy: 448930, warning: 31640, critical: 5630 },
    focus: d.FOCUS[role].map(([label, screen, tone]) => ({
      label,
      screen,
      tone,
      search: FOCUS_LINK[label] ?? {},
    })),
    condition_zones: ['GH1-Z2', 'GH1-Z3', 'GH2-Z2', 'GH2-Z3', 'GH3-P1'],
    origin: SIM,
  };
}

const ghName = (id: string) => d.GREENHOUSES.find((g) => g.id === id)?.name ?? id;
const healthOf = (h: number) => (h >= 85 ? 'HEALTHY' : h >= 70 ? 'WARNING' : 'CRITICAL');

export function zones() {
  return d.ZONES.map((z) => ({
    id: z.id,
    name: z.name,
    greenhouse_id: z.gh,
    greenhouse_name: ghName(z.gh),
    crop: z.crop,
    health: healthOf(z.health),
  }));
}

export function healthTrend(now: Date) {
  const score = d.series(30, 88, 1.8, 1.6, 5, 1.2, 2);
  score[29] = 89;
  score[28] = 90;
  const warning = d.series(30, 32, 6, 5, 9, 1.2, 5);
  const labels = Array.from({ length: 30 }, (_, i) =>
    new Date(now.getTime() - (29 - i) * 86_400_000).toISOString(),
  );
  return { labels, series: { score, warning_plants_k: warning }, origin: SIM };
}

export function environmentTrend(now: Date) {
  const labels = Array.from({ length: 48 }, (_, i) =>
    new Date(now.getTime() - (47 - i) * 30 * 60_000).toISOString(),
  );
  return {
    labels,
    series: {
      temp_c: d.series(48, 20.8, 2.2, 0.5, 3, 1, -1.2),
      rh_pct: d.series(48, 70, 7, 2.5, 4, 1, 1.9),
    },
    origin: SIM,
  };
}

export function alerts(now: Date) {
  const category = (icon: string) =>
    icon === 'wifi_off'
      ? 'device'
      : icon === 'psychiatry'
        ? 'ai'
        : icon === 'bolt'
          ? 'sensor'
          : 'climate';
  return d.ALERTS.map((a) => ({
    id: a.id,
    severity: a.severity,
    category: category(a.icon),
    title: a.title,
    zone_id: a.zone,
    device_id: null,
    origin: SIM,
    status: 'open',
    created_at: designTime(now, a.at),
  }));
}

export function robots() {
  const r = rob.robotCard();
  return [
    {
      id: 'LEFI-R1',
      name: 'LEFI-R1 · Imaging rover',
      kind: 'Ground rover',
      origin: SIM,
      mode: r.mode,
      state: r.state,
      battery_pct: r.battery_pct,
      last_mission: r.last
        ? {
            title: r.last.title,
            state: `${r.last.state} ${r.last.end}`,
            images: r.last.photos,
            ai_flags: r.last.id === 'M-1042' ? 3 : 0,
          }
        : null,
      note: 'LEFI-R2 · In maintenance (wheel encoder) · ETA Oct 30',
    },
  ];
}

export function shiftNow() {
  return {
    name: 'Day',
    start: '06:00',
    end: '14:30',
    on_site: d.CREW.filter(([, , st]) => st === 'On shift').map(([name, role_id]) => ({
      name,
      role_id,
    })),
    on_break: d.CREW.filter(([, , st]) => st === 'On break').length,
  };
}

export function aiSummary(now: Date, s: MockState) {
  if (s.halted)
    return { state: 'disabled', text: null, generated_at: null, basis: null, simulated: true };
  return {
    state: 'available',
    text: d.AI_SUMMARY,
    generated_at: designTime(now, '09:40'),
    basis: 'Generated from 1,284 sensor readings and 1,240 images in the last 12 h',
    simulated: true,
  };
}

export function aiBriefing(s: MockState) {
  if (s.halted)
    return { state: 'disabled', happened: null, why: null, done: [], next: [], simulated: true };
  return { state: 'available', ...d.BRIEFING, simulated: true };
}

export const activity = () => d.ACTIVITY;

export const people = () => d.CREW.map(([name, role_id]) => ({ name, role_id }));
