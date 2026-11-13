/**
 * Lefi AI assistant on the development mock (ADR-067). The mock has NO model: every answer is a
 * fixed sample text that says so, so the chat UI can be developed without an AI node. Never
 * presented as an AI answer: the model field reads "mock (no AI model)".
 */
import { randomUUID } from 'node:crypto';
import { MockError } from './incidents.ts';

const MODEL = 'mock (no AI model)';

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  state: 'done';
  created_at: string;
  completed_at: string;
  model: string | null;
  error: null;
  tools: Array<{ name: string; label: string; outcome: 'ok'; arguments: Record<string, unknown> }>;
}
interface Conv {
  id: string;
  owner: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: Msg[];
}

const conversations = new Map<string, Conv>();

const TOOLS: Array<[string, string, string]> = [
  ['greenhouse_overview', 'Greenhouses and zones', 'nav.greenhouses'],
  ['zone_details', 'Zone details and crops', 'nav.greenhouses'],
  ['zone_inventory', 'Zone inventory', 'nav.zones'],
  ['list_plants', 'Plants', 'nav.greenhouses'],
  ['plant_details', 'Plant details and its sensors', 'nav.greenhouses'],
  ['current_readings', 'Current sensor readings', 'nav.environment'],
  ['sensor_history', 'Sensor history', 'nav.environment'],
  ['field_devices', 'Field devices (ESP32 boards)', 'nav.devices'],
  ['device_events', 'Device events', 'nav.devices'],
  ['crop_types', 'Crop types', 'nav.greenhouses'],
];

export function status(permissions: string[]) {
  return {
    state: 'available',
    reason: 'development mock: answers are fixed sample text, not AI',
    model: MODEL,
    kill_switch: false,
    busy: 0,
    tools: TOOLS.filter(([, , p]) => permissions.includes(p)).map(([name, label]) => ({
      name,
      label,
    })),
    can_write: false,
  };
}

const out = (c: Conv) => ({
  id: c.id,
  title: c.title,
  created_at: c.created_at,
  updated_at: c.updated_at,
  messages: c.messages,
});

export function chat(owner: string, body: { message?: string; conversation_id?: string } | null) {
  const text = String(body?.message ?? '').trim();
  if (!text) throw new MockError(422, 'INVALID_QUESTION', 'ask something');
  const now = new Date().toISOString();
  let conv = body?.conversation_id ? conversations.get(body.conversation_id) : undefined;
  if (body?.conversation_id && (!conv || conv.owner !== owner))
    throw new MockError(404, 'NOT_FOUND', 'no such conversation');
  if (!conv) {
    conv = {
      id: randomUUID(),
      owner,
      title: text.slice(0, 80),
      created_at: now,
      updated_at: now,
      messages: [],
    };
    conversations.set(conv.id, conv);
  }
  conv.updated_at = now;
  const base = { state: 'done' as const, created_at: now, completed_at: now, error: null };
  conv.messages.push(
    { ...base, id: randomUUID(), role: 'user', content: text, model: null, tools: [] },
    {
      ...base,
      id: randomUUID(),
      role: 'assistant',
      content:
        'SAMPLE ANSWER — the development mock has no AI model. Against the real Lefi Brain, ' +
        'Lefi reads the greenhouse data your role can see and answers this question.',
      model: MODEL,
      tools: [],
    },
  );
  return out(conv);
}

export function list(owner: string) {
  return [...conversations.values()]
    .filter((c) => c.owner === owner)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((c) => ({ id: c.id, title: c.title, created_at: c.created_at, updated_at: c.updated_at }));
}

export function get(owner: string, id: string) {
  const conv = conversations.get(id);
  return conv && conv.owner === owner ? out(conv) : null;
}
