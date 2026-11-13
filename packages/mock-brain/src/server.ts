/**
 * Fake Brain for UI development: `pnpm --filter @lefi/mock-brain start`.
 * Listens on 127.0.0.1 only. The desktop app reaches it through Rust (`api_request`) and the
 * browser dev server through Vite's proxy. Never deploy this.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import * as fx from './fixtures.ts';
import * as inc from './incidents.ts';
import * as dev from './devices.ts';
import * as env from './environment.ts';
import * as det from './detections.ts';
import * as tk from './tasks.ts';
import * as aic from './aiControl.ts';
import * as rob from './robotSim.ts';
import * as ho from './handover.ts';
import * as esc from './escalation.ts';
import * as wf from './workforce.ts';
import * as adm from './admin.ts';
import * as crop from './crops.ts';
import * as zn from './zones.ts';
import * as srch from './search.ts';
import * as asst from './assistant.ts';

const PORT = Number(process.env.MOCK_BRAIN_PORT ?? 8787);
const sessions = new Map<string, fx.MockUser>();
const state: fx.MockState = { halted: null, haltReason: '' };

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

/** Same body as the real Brain: `{ "error": { "code", "message", "details" } }`. */
function fail(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  send(res, status, { error: { code: code.toUpperCase(), message, details } });
}

function sessionOf(req: IncomingMessage): fx.MockUser | undefined {
  const sid = /(?:^|;\s*)lefi_session=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  return sid ? sessions.get(sid) : undefined;
}

function sessionBody(u: fx.MockUser) {
  return {
    user: {
      id: `mock-user-${u.username}`,
      username: u.username,
      email: u.email,
      display_name: u.display_name,
    },
    role: u.role,
    permissions: u.permissions,
    must_change_password: false,
    session: {
      id: `mock-session-${u.username}`,
      expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      idle_timeout_s: 8 * 3600,
    },
  };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : null;
}

type Ctx = {
  req: IncomingMessage;
  user: fx.MockUser;
  params: string[];
  body: unknown;
  now: Date;
  query: URLSearchParams;
};
type Route = [method: string, path: RegExp, perm: string | null, handler: (c: Ctx) => unknown];

const routes: Route[] = [
  ['GET', /^\/auth\/session$/, null, ({ user }) => sessionBody(user)],
  ['GET', /^\/system\/status$/, null, ({ now }) => fx.systemStatus(now, state)],
  [
    'GET',
    /^\/nav\/counters$/,
    null,
    ({ user }) => fx.navCounters(user.permissions, state, actor(user)),
  ],
  [
    'POST',
    /^\/ai\/halt$/,
    'ai.halt',
    ({ body, now, user }) => {
      aic.halt(state, actor(user), (body ?? {}) as { scope?: string; reason?: string });
      rob.onHalt(state.halted ?? 'ai', user.display_name);
      return fx.systemStatus(now, state);
    },
  ],
  ['GET', /^\/ai\/control$/, 'nav.aiControl', ({ user }) => aic.view(state, actor(user))],
  ['POST', /^\/ai\/resume$/, 'nav.aiControl', ({ user }) => aic.resume(state, actor(user))],
  [
    'POST',
    /^\/ai\/automations\/([\w-]+)\/(stop|restart)$/,
    'nav.aiControl',
    ({ user, params: [id, op] }) =>
      aic.automation(state, actor(user), id!, op as 'stop' | 'restart'),
  ],
  [
    'PUT',
    /^\/ai\/autonomy$/,
    'nav.aiControl',
    ({ user, body }) =>
      aic.updateAutonomy(
        state,
        actor(user),
        (body ?? {}) as Parameters<typeof aic.updateAutonomy>[2],
      ),
  ],
  [
    'PUT',
    /^\/ai\/settings$/,
    'nav.aiControl',
    ({ user, body }) =>
      aic.updateSettings(state, actor(user), (body ?? {}) as Record<string, unknown>),
  ],
  ['GET', /^\/ai\/summary$/, null, ({ now }) => fx.aiSummary(now, state)],
  ['GET', /^\/ai\/briefing$/, null, () => fx.aiBriefing(state)],
  ['GET', /^\/ai\/assistant$/, 'ai.chat', ({ user }) => asst.status(user.permissions)],
  [
    'POST',
    /^\/ai\/chat$/,
    'ai.chat',
    ({ user, body }) => asst.chat(user.username, body as Parameters<typeof asst.chat>[1]),
  ],
  ['GET', /^\/ai\/conversations$/, 'ai.chat', ({ user }) => asst.list(user.username)],
  [
    'GET',
    /^\/ai\/conversations\/([\w-]+)$/,
    'ai.chat',
    ({ user, params: [id] }) => asst.get(user.username, id!),
  ],
  ['GET', /^\/dashboard$/, 'nav.dashboard', ({ user }) => fx.dashboard(user.role.id)],
  ['GET', /^\/trends\/health$/, 'nav.dashboard', ({ now }) => fx.healthTrend(now)],
  ['GET', /^\/trends\/environment$/, 'nav.dashboard', ({ now }) => fx.environmentTrend(now)],
  ['GET', /^\/environment\/zones$/, null, () => fx.zones()],
  [
    'GET',
    /^\/zones\/([\w-]+)\/readings\/latest$/,
    null,
    ({ params: [id], now }) => env.zoneReadings(id!, now),
  ],
  [
    'GET',
    /^\/zones\/([\w-]+)\/history$/,
    'nav.environment',
    ({ params: [id], now, query }) => env.history(now, id!, query),
  ],
  [
    'GET',
    /^\/operating-ranges$/,
    'nav.environment',
    ({ user }) => env.operatingRanges(actor(user)),
  ],
  [
    'PUT',
    /^\/operating-ranges$/,
    'nav.environment',
    ({ user, body }) =>
      env.saveRanges(
        actor(user),
        (body ?? {}) as { rows?: Array<{ variable: string; min: number; max: number }> },
      ),
  ],
  [
    'GET',
    /^\/irrigation\/status$/,
    null,
    () => ({
      state: 'DISABLED',
      reason:
        'Irrigation control is disabled by design: no pump, valve or relay can be operated from LEFI CROP.',
    }),
  ],
  ['GET', /^\/devices$/, 'nav.devices', ({ now, query }) => dev.list(now, query)],
  ['GET', /^\/devices\/summary$/, 'nav.devices', () => dev.summary()],
  [
    'POST',
    /^\/devices$/,
    'nav.devices',
    ({ now, user, body }) => dev.register(now, actor(user), (body ?? {}) as Record<string, string>),
  ],
  [
    'GET',
    /^\/devices\/([\w-]+)$/,
    'nav.devices',
    ({ now, user, params: [id] }) => dev.get(now, id!, actor(user)),
  ],
  [
    'POST',
    /^\/devices\/([\w-]+)\/mode$/,
    'nav.devices',
    ({ now, user, params: [id], body }) =>
      dev.setMode(now, id!, actor(user), String((body as { mode?: string } | null)?.mode ?? '')),
  ],
  [
    'POST',
    /^\/devices\/([\w-]+)\/maintenance$/,
    'nav.devices',
    ({ now, user, params: [id] }) => dev.scheduleMaintenance(now, id!, actor(user)),
  ],
  [
    'POST',
    /^\/devices\/([\w-]+)\/approve$/,
    'nav.devices',
    ({ now, user, params: [id] }) => dev.decide(now, id!, actor(user), true),
  ],
  [
    'POST',
    /^\/devices\/([\w-]+)\/reject$/,
    'nav.devices',
    ({ now, user, params: [id] }) => dev.decide(now, id!, actor(user), false),
  ],
  ['GET', /^\/alerts$/, 'nav.alerts', ({ now }) => fx.alerts(now)],
  ['GET', /^\/tasks$/, 'nav.tasks', ({ user, query }) => tk.list(actor(user), query)],
  ['GET', /^\/tasks\/summary$/, 'nav.tasks', ({ user }) => tk.summary(actor(user))],
  [
    'POST',
    /^\/tasks$/,
    'nav.tasks',
    ({ user, body }) =>
      tk.create(
        actor(user),
        (body ?? {}) as Record<string, string>,
        fx.people().map((p) => p.name),
      ),
  ],
  ['GET', /^\/tasks\/([\w-]+)$/, 'nav.tasks', ({ user, params: [id] }) => tk.get(actor(user), id!)],
  [
    'POST',
    /^\/tasks\/([\w-]+)\/transition$/,
    'nav.tasks',
    ({ user, params: [id], body }) =>
      tk.transition(actor(user), id!, (body ?? {}) as { action?: string; notes?: string }),
  ],
  ['GET', /^\/robots$/, 'nav.robots', () => fx.robots()],
  ['GET', /^\/shifts\/current$/, null, () => fx.shiftNow()],
  ['GET', /^\/activity$/, null, () => fx.activity()],
  ['GET', /^\/people$/, null, () => fx.people()],
  ['GET', /^\/handover\/current$/, 'nav.handover', ({ user }) => ho.view(state, actor(user))],
  [
    'POST',
    /^\/handover\/current\/sign$/,
    'nav.handover',
    ({ user }) => ho.sign(state, actor(user)),
  ],
  [
    'POST',
    /^\/handover\/current\/acknowledge$/,
    'nav.handover',
    ({ user }) => ho.acknowledge(state, actor(user)),
  ],
  ['GET', /^\/search$/, null, ({ user, query }) => srch.search(actor(user), query)],
  ['GET', /^\/inventory\/zones$/, 'nav.zones', ({ user, now }) => zn.list(actor(user), now)],
  ['GET', /^\/inventory\/zones\/form$/, 'nav.zones', ({ user }) => zn.form(actor(user))],
  [
    'GET',
    /^\/inventory\/zones\/([\w-]+)$/,
    'nav.zones',
    ({ user, now, params: [id] }) => zn.detail(actor(user), now, id!),
  ],
  [
    'POST',
    /^\/inventory\/zones$/,
    'nav.zones',
    ({ user, now, body }) =>
      zn.create(actor(user), now, (body ?? {}) as Parameters<typeof zn.create>[2]),
  ],
  ['GET', /^\/views\/greenhouses$/, 'nav.greenhouses', ({ user }) => crop.greenhouses(actor(user))],
  [
    'GET',
    /^\/greenhouses\/([\w-]+)$/,
    'nav.greenhouses',
    ({ user, params: [id] }) => crop.greenhouse(actor(user), id!),
  ],
  [
    'GET',
    /^\/zones\/([\w-]+)\/overview$/,
    'nav.greenhouses',
    ({ user, now, params: [id] }) => crop.zone(actor(user), now, id!),
  ],
  [
    'POST',
    /^\/batches$/,
    'nav.greenhouses',
    ({ user, now, body }) =>
      crop.createBatch(actor(user), now, (body ?? {}) as Parameters<typeof crop.createBatch>[2]),
  ],
  [
    'GET',
    /^\/batches\/([\w-]+)$/,
    'nav.greenhouses',
    ({ user, now, params: [id] }) => crop.batch(actor(user), now, id!),
  ],
  [
    'PUT',
    /^\/batches\/([\w-]+)$/,
    'nav.greenhouses',
    ({ user, now, params: [id], body }) =>
      crop.updateBatch(
        actor(user),
        now,
        id!,
        (body ?? {}) as Parameters<typeof crop.updateBatch>[3],
      ),
  ],
  [
    'GET',
    /^\/plants\/([\w-]+)$/,
    'nav.greenhouses',
    ({ user, now, params: [id] }) => crop.plant(actor(user), now, id!),
  ],
  [
    'POST',
    /^\/plants\/([\w-]+)\/observations$/,
    'nav.greenhouses',
    ({ user, now, params: [id], body }) =>
      crop.observe(actor(user), now, id!, (body ?? {}) as { note?: string }),
  ],
  ['GET', /^\/admin\/permissions$/, 'admin.roles', ({ user }) => adm.permissions(actor(user))],
  [
    'PUT',
    /^\/admin\/permissions$/,
    'admin.roles',
    ({ user, body }) =>
      adm.setPermission(actor(user), (body ?? {}) as Parameters<typeof adm.setPermission>[1]),
  ],
  ['GET', /^\/admin\/config$/, 'admin.config', ({ user }) => adm.config(actor(user))],
  [
    'PUT',
    /^\/admin\/config$/,
    'admin.config',
    ({ user, body }) =>
      adm.saveConfig(actor(user), (body ?? {}) as Parameters<typeof adm.saveConfig>[1]),
  ],
  ['GET', /^\/admin\/audit$/, 'admin.audit', ({ query }) => adm.audit(query)],
  ['GET', /^\/roles$/, null, () => wf.roles()],
  ['GET', /^\/workforce\/people$/, 'nav.workforce', ({ query }) => wf.list(query)],
  [
    'POST',
    /^\/workforce\/people$/,
    'nav.workforce',
    ({ user, body }) => wf.invite(actor(user), (body ?? {}) as Parameters<typeof wf.invite>[1]),
  ],
  [
    'GET',
    /^\/workforce\/people\/([\w-]+)$/,
    'nav.workforce',
    ({ user, params: [id] }) => wf.detail(actor(user), id!),
  ],
  [
    'PUT',
    /^\/workforce\/people\/([\w-]+)$/,
    'nav.workforce',
    ({ user, params: [id], body }) =>
      wf.update(actor(user), id!, (body ?? {}) as Parameters<typeof wf.update>[2]),
  ],
  [
    'POST',
    /^\/workforce\/people\/([\w-]+)\/deactivate$/,
    'nav.workforce',
    ({ user, params: [id] }) => {
      const r = wf.deactivate(actor(user), id!);
      for (const [sid, u] of sessions) if (u.display_name === r.revoked) sessions.delete(sid);
      return { item: r.item, message: r.message };
    },
  ],
  ['GET', /^\/workforce\/shifts$/, 'nav.workforce', ({ user, now }) => wf.shifts(actor(user), now)],
  [
    'POST',
    /^\/workforce\/shifts\/([\w-]+)\/([0-6])\/cycle$/,
    'nav.workforce',
    ({ user, now, params: [id, day] }) => wf.cycleShift(actor(user), now, id!, Number(day)),
  ],
  ['GET', /^\/escalation$/, 'nav.escalation', ({ user }) => esc.view(state, actor(user))],
  ['GET', /^\/escalation\/preview$/, 'nav.escalation', ({ query }) => esc.preview(state, query)],
  ['GET', /^\/escalation\/deliveries$/, 'nav.escalation', () => esc.deliveries()],
  [
    'PUT',
    /^\/escalation$/,
    'nav.escalation',
    ({ user, body }) =>
      esc.update(state, actor(user), (body ?? {}) as Parameters<typeof esc.update>[2]),
  ],
  [
    'PUT',
    /^\/escalation\/oncall\/([\w-]+)$/,
    'nav.escalation',
    ({ user, params: [id], body }) =>
      esc.setOncall(state, actor(user), id!, Boolean((body as { on?: boolean } | null)?.on)),
  ],
  ['GET', /^\/robots\/live$/, 'nav.robots', ({ user }) => rob.live(state, actor(user))],
  [
    'POST',
    /^\/robots\/LEFI-R1\/commands$/,
    'nav.robots',
    ({ user, body }) =>
      rob.command(
        state,
        actor(user),
        (body ?? {}) as { intent?: string; arg?: string; text?: string },
      ),
  ],
  [
    'PUT',
    /^\/robots\/sim\/speed$/,
    'nav.robots',
    ({ user, body }) =>
      rob.setSpeed(state, actor(user), Number((body as { speed?: number } | null)?.speed)),
  ],
  [
    'POST',
    /^\/missions\/queue\/([\w-]+)\/(up|down|cancel)$/,
    'nav.robots',
    ({ user, params: [id, op] }) => rob.queueOp(state, actor(user), id!, op!),
  ],
  ['GET', /^\/missions$/, 'nav.robots', () => rob.missions()],
  ['GET', /^\/missions\/([\w-]+)$/, 'nav.robots', ({ params: [id] }) => rob.mission(id!)],
  ['GET', /^\/detections$/, 'nav.plantHealth', ({ now, query }) => det.list(now, query)],
  ['GET', /^\/detections\/summary$/, 'nav.plantHealth', () => det.summary()],
  [
    'GET',
    /^\/detections\/([\w-]+)$/,
    'nav.plantHealth',
    ({ now, user, params: [id] }) => det.get(now, id!, actor(user)),
  ],
  [
    'POST',
    /^\/detections\/([\w-]+)\/review$/,
    'nav.plantHealth',
    ({ now, user, params: [id], body }) =>
      det.review(
        now,
        id!,
        actor(user),
        String((body as { decision?: string } | null)?.decision ?? ''),
      ),
  ],
  [
    'POST',
    /^\/detections\/([\w-]+)\/inspection$/,
    'nav.plantHealth',
    ({ now, user, params: [id] }) => det.requestInspection(now, id!, actor(user)),
  ],
  ['GET', /^\/incidents$/, 'nav.alerts', ({ now, query }) => inc.list(now, query)],
  ['GET', /^\/incidents\/summary$/, 'nav.alerts', () => inc.summary()],
  [
    'POST',
    /^\/incidents$/,
    'nav.alerts',
    ({ now, user, body }) => inc.report(now, actor(user), body as Record<string, string>),
  ],
  [
    'GET',
    /^\/incidents\/([\w-]+)$/,
    'nav.alerts',
    ({ now, user, params: [id] }) => inc.get(now, id!, actor(user)),
  ],
  [
    'POST',
    /^\/incidents\/([\w-]+)\/transition$/,
    'nav.alerts',
    ({ now, user, params: [id], body }) =>
      inc.transition(now, id!, actor(user), (body ?? {}) as { action?: string; note?: string }),
  ],
  [
    'POST',
    /^\/incidents\/([\w-]+)\/assign$/,
    'nav.alerts',
    ({ now, user, params: [id], body }) =>
      inc.assign(
        now,
        id!,
        actor(user),
        String((body as { assignee?: string } | null)?.assignee ?? ''),
        fx.people().map((p) => p.name),
      ),
  ],
];

function actor(u: fx.MockUser) {
  return { name: u.display_name, role: u.role.id, permissions: u.permissions };
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://mock');
  const path = url.pathname.replace(/^\/api\/v1/, '');
  try {
    const body = req.method === 'POST' || req.method === 'PUT' ? await readJson(req) : null;
    // Public, like the real Brain's GET /api/v1/health.
    if (req.method === 'GET' && path === '/health') {
      return send(res, 200, {
        status: 'ok',
        service: 'lefi-brain',
        version: '0.0.0-mock',
        time: new Date().toISOString(),
        // Not in the real Brain's answer: lets the client label everything as sample data.
        mock: true,
      });
    }
    if (req.method === 'POST' && path === '/auth/login') {
      const b = body as { username?: string; password?: string } | null;
      const id = String(b?.username ?? '')
        .trim()
        .toLowerCase();
      const user = fx.USERS.find(
        (u) => (u.username === id || u.email === id) && u.password === b?.password,
      );
      if (!user) return fail(res, 401, 'INVALID_CREDENTIALS', 'invalid username or password');
      const sid = randomUUID();
      sessions.set(sid, user);
      return send(res, 200, sessionBody(user), {
        'set-cookie': `lefi_session=${sid}; HttpOnly; SameSite=Strict; Path=/api`,
      });
    }
    if (req.method === 'POST' && path === '/auth/logout') {
      return send(res, 200, null, { 'set-cookie': 'lefi_session=; Max-Age=0; Path=/api' });
    }
    const user = sessionOf(req);
    if (!user) return fail(res, 401, 'NOT_AUTHENTICATED', 'sign in first');

    for (const [method, re, perm, handler] of routes) {
      const m = re.exec(path);
      if (!m || method !== req.method) continue;
      if (perm && !user.permissions.includes(perm))
        return fail(res, 403, 'FORBIDDEN', 'your role does not allow this', { permission: perm });
      const out = handler({
        req,
        user,
        params: m.slice(1),
        body,
        now: new Date(),
        query: url.searchParams,
      });
      return out === null ? fail(res, 404, 'NOT_FOUND', 'not found') : send(res, 200, out);
    }
    fail(res, 404, 'NOT_FOUND', 'not found');
  } catch (err) {
    if (err instanceof inc.MockError) return fail(res, err.status, err.code, err.message);
    fail(res, 500, 'MOCK_ERROR', String(err));
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`mock Brain (FAKE DATA) on http://127.0.0.1:${PORT}/api/v1`);
});
