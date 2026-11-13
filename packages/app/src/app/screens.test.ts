import { describe, expect, it } from 'vitest';
import { servedByBrain } from '@lefi/api';
import { screens } from './screens';

describe('screens against the real Lefi Brain (ADR-049)', () => {
  it('no screen is served yet: each still reads a proposal shape the real Brain does not answer', () => {
    // When a screen is moved onto a real endpoint (same shape as the Brain's OpenAPI), take it out
    // of this list on purpose. A real route that only shares a path must never switch a screen on.
    const served = screens
      .filter((s) => s.brain && servedByBrain(s.brain.endpoint))
      .map((s) => s.id);
    // AI Control: the real Lefi Brain now answers `/ai/control` with its own shape (ADR-085). That
    // is safe only because its live version is picked first against the real Brain; the design
    // component reads the mock's shape and is never shown against the real Brain.
    // Tasks: the real Lefi Brain answers `/tasks` with its own shape (ADR-089); its live version
    // is picked first, the same way. Shift Handover: `/handover/current` (ADR-095), same way.
    // Robot Mission Center: same, with `/robots` (ADR-091); the design screen reads the mock's shape.
    expect(served).toEqual(['robots', 'tasks', 'handover', 'escalation', 'aiControl']);
    expect(screens.find((s) => s.id === 'handover')?.live?.endpoint).toBe('/handover/current');
    expect(screens.find((s) => s.id === 'tasks')?.live?.endpoint).toBe('/tasks');
    const ai = screens.find((s) => s.id === 'aiControl')!;
    expect(ai.live?.endpoint).toBe('/ai/control');
    const robots = screens.find((s) => s.id === 'robots')!;
    expect(robots.live?.endpoint).toBe('/robots');
  });
});

describe('live versions (ADR-052, ADR-064, ADR-069, ADR-070, ADR-071, ADR-084, ADR-085, ADR-086, ADR-089, ADR-091, ADR-095, ADR-096)', () => {
  it('Dashboard, Greenhouses, Zones, Environment, Plant Health, Alerts, Robot Mission Center, Tasks, Shift Handover, Escalation, Devices, AI Control, AI Knowledge Center, Workforce and Administration have one, served by the real Lefi Brain', () => {
    const live = screens.filter((s) => s.live).map((s) => [s.id, servedByBrain(s.live!.endpoint)]);
    expect(live).toEqual([
      ['dashboard', true],
      ['greenhouses', true],
      ['zones', true],
      ['environment', true],
      ['plantHealth', true],
      ['alerts', true],
      ['robots', true],
      ['tasks', true],
      ['handover', true],
      ['escalation', true],
      ['devices', true],
      ['aiControl', true],
      ['knowledge', true],
      ['workforce', true],
      ['admin', true],
    ]);
  });
});
