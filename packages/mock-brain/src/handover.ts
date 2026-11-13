/**
 * Mock shift handover (Day → Evening, prototype content). The summary is a fixture flagged
 * `simulated` — never presented as AI output — and is withheld while AI is stopped.
 * Signing is a recorded human act: the outgoing supervisor signs, then the incoming one
 * acknowledges.
 */
import { BRIEFING } from './design-data.ts';
import type { MockState } from './fixtures.ts';
import { MockError } from './incidents.ts';
import { shiftMissions } from './robotSim.ts';

interface Actor {
  name: string;
  permissions: string[];
}
const can = (a: Actor, p: string) => a.permissions.includes(p);
const OK = { allowed: true, reason: null as string | null };
const no = (reason: string) => ({ allowed: false, reason });

const ho = {
  signedBy: null as string | null,
  signedAt: null as string | null,
  ackBy: null as string | null,
  ackAt: null as string | null,
};
const clock = () => new Date().toTimeString().slice(0, 5);

export function view(s: MockState, a: Actor) {
  return {
    title: 'Day shift → Evening shift',
    outgoing: { name: 'Marcus Okafor', role_id: 'supervisor', shift: 'Outgoing · Day 06:00–14:30' },
    incoming: {
      name: 'Owen MacLeod',
      role_id: 'supervisor',
      shift: 'Incoming · Evening 14:00–22:30',
    },
    signed: ho.signedBy ? { by: ho.signedBy, at: ho.signedAt } : null,
    acknowledged: ho.ackBy ? { by: ho.ackBy, at: ho.ackAt } : null,
    summary: s.halted
      ? { state: 'disabled', happened: null, why: null, done: [], next: [], simulated: true }
      : {
          state: 'available',
          simulated: true,
          ...BRIEFING,
          next: [
            ...BRIEFING.next,
            'Review 2 unconfirmed AI detections (tipburn, aphids)',
            'Keep HAF fans on overnight in GH2-Z2 — RH peaked at 77 %',
          ],
        },
    environment: [
      { label: 'Zone B substrate moisture', value: '56 % avg · in range', tone: 'ok' },
      { label: 'GH2-Z3 EC', value: '2.31 → 1.92 mS/cm · improving', tone: 'warn' },
      { label: 'GH2-Z2 relative humidity', value: '77 % peak · warning', tone: 'warn' },
      { label: 'Air temperature, all zones', value: '20.1–23.6 °C · in range', tone: 'ok' },
    ],
    plants: [
      { label: 'Facility health score', value: '90 → 89', tone: 'warn' },
      { label: 'Warning plants', value: '31,640 (+1,120)', tone: 'warn' },
      { label: 'Critical plants', value: '5,630', tone: 'crit' },
      { label: 'Harvested today', value: 'B-2611 · 29,270 plants', tone: 'ok' },
    ],
    missions: shiftMissions(),
    origin: 'SIMULATED',
    actions: {
      sign: ho.signedBy
        ? no(`Already signed by ${ho.signedBy}.`)
        : can(a, 'handover.sign')
          ? OK
          : no('Requires permission: Sign shift handover'),
      acknowledge: ho.ackBy
        ? no(`Already acknowledged by ${ho.ackBy}.`)
        : !ho.signedBy
          ? no('The outgoing supervisor must sign first.')
          : !can(a, 'handover.ack')
            ? no('Requires permission: Acknowledge shift handover')
            : ho.signedBy === a.name
              ? no('The person who signed cannot also acknowledge — the incoming shift does.')
              : OK,
    },
  };
}

export function sign(s: MockState, a: Actor) {
  const av = view(s, a).actions.sign;
  if (!av.allowed)
    throw new MockError(
      can(a, 'handover.sign') ? 409 : 403,
      can(a, 'handover.sign') ? 'invalid_state' : 'forbidden',
      av.reason ?? 'Not allowed.',
    );
  ho.signedBy = a.name;
  ho.signedAt = clock();
  return {
    item: view(s, a),
    message: 'Handover signed. The incoming shift can now acknowledge it.',
  };
}

export function acknowledge(s: MockState, a: Actor) {
  const av = view(s, a).actions.acknowledge;
  if (!av.allowed)
    throw new MockError(
      can(a, 'handover.ack') ? 409 : 403,
      can(a, 'handover.ack') ? 'invalid_state' : 'forbidden',
      av.reason ?? 'Not allowed.',
    );
  ho.ackBy = a.name;
  ho.ackAt = clock();
  return { item: view(s, a), message: 'Incoming shift acknowledged the handover.' };
}
