/**
 * Mock audit trail shared by the mock modules that record changes (Workforce, Escalation,
 * Administration). Seed rows are prototype content; new rows carry the acting mock user.
 * The real Brain records device_id + user_id per request (ADR-022).
 */
export interface AuditEntry {
  at: string;
  user: string;
  action: string;
  target: string;
  detail: string;
  source: string;
  kind: 'ok' | 'denied' | 'system';
}

const SEED: Array<[string, string, string, string, string, string, AuditEntry['kind']]> = [
  [
    'Yesterday 16:05',
    'Marcus Okafor',
    'Shift changed',
    'Amrit Gill',
    'Fri: Day → Off',
    '192.168.8.52',
    'ok',
  ],
  [
    'Yesterday 09:31',
    'Sofia Marchetti',
    'Updated operating range',
    'Env profile · Baby lettuce',
    'RH max 78 % → 75 % (placeholder profile)',
    '192.168.8.53',
    'ok',
  ],
  [
    'Yesterday 08:47',
    'System',
    'Device status changed',
    'SM-GH2-Z3-02',
    'Online → Offline (heartbeat lost)',
    '—',
    'system',
  ],
  [
    'Yesterday 08:02',
    'Priya Raman',
    'Role assigned',
    'Fatima Haddad',
    'Greenhouse Worker → Crop Scout',
    '192.168.8.51',
    'ok',
  ],
  [
    'Yesterday 07:58',
    'LEFI-R1 (simulated)',
    'Mission completed',
    'Imaging run GH1-Z2',
    '1,240 simulated frames',
    '—',
    'system',
  ],
  [
    'Yesterday 07:54',
    'Detection fixture (simulated)',
    'Detection created',
    'AI-1028-0142',
    'Tipburn · 87 % (simulated, no vision model)',
    '—',
    'system',
  ],
  [
    'Mon 09:10',
    'Priya Raman',
    'Zone access changed',
    'Amrit Gill',
    '+ GH1-Z3',
    '192.168.8.51',
    'ok',
  ],
  [
    'Mon 09:00',
    'Priya Raman',
    'Permission changed',
    'Greenhouse Supervisor',
    '+ Edit shift assignments',
    '192.168.8.51',
    'ok',
  ],
];

const log: AuditEntry[] = SEED.map(([at, user, action, target, detail, source, kind]) => ({
  at,
  user,
  action,
  target,
  detail,
  source,
  kind,
}));

const clock = () => new Date().toTimeString().slice(0, 5);

/** Rows written by the mock come from the local dev session, not a paired device. */
export function record(
  user: string,
  action: string,
  target: string,
  detail: string,
  kind: AuditEntry['kind'] = 'ok',
) {
  log.unshift({
    at: `Today ${clock()}`,
    user,
    action,
    target,
    detail,
    source: 'local dev · unpaired',
    kind,
  });
}

export function list(q?: string | null) {
  const t = (q ?? '').toLowerCase();
  return log.filter(
    (a) => !t || `${a.user} ${a.action} ${a.target} ${a.detail}`.toLowerCase().includes(t),
  );
}

export const about = (name: string) => log.filter((a) => a.target === name || a.user === name);
