import { describe, expect, it } from 'vitest';
import { nodeOutcome, reasonText } from './erase';
import type { EraseNode } from './erase';
import type { CommandRecord } from './fleet';

const node = (over: Partial<EraseNode> = {}): EraseNode => ({
  id: 'pc-1',
  name: 'lefi-node-1',
  hostname: 'mac',
  ip: '192.0.2.5',
  erasable: true,
  reason: '',
  command_id: 'cmd-01',
  ...over,
});
const rec = (state: CommandRecord['state']) => ({ state }) as CommandRecord;

describe('erase every PC', () => {
  it('follows each PC to erased or failed, and never waits for one that was not asked', () => {
    expect(nodeOutcome(node(), undefined)).toBe('waiting');
    expect(nodeOutcome(node(), rec('delivered'))).toBe('waiting');
    expect(nodeOutcome(node(), rec('running'))).toBe('running');
    expect(nodeOutcome(node(), rec('ok'))).toBe('erased');
    for (const s of ['failed', 'expired', 'cancelled'] as const)
      expect(nodeOutcome(node(), rec(s))).toBe('failed');
    expect(nodeOutcome(node({ erasable: false, reason: 'offline' }), null)).toBe('skipped');
  });

  it('says why a PC is left for later', () => {
    expect(reasonText(node({ erasable: false, reason: 'outdated' }))).toMatch(/Update it first/);
    expect(reasonText(node({ erasable: false, reason: 'refused', message: 'x' }))).toBe('x');
  });
});
