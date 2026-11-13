import { describe, expect, it } from 'vitest';
import { credentialsText } from './console';

describe('credentialsText', () => {
  it('lists every credential', () => {
    const t = credentialsText({
      admin: { username: 'admin', password: 'fake-admin-pass' },
      devices: [{ username: 'esp32-01', password: 'fake-device-pass' }],
    });
    expect(t).toContain('password: fake-admin-pass');
    expect(t).toContain('esp32-01: fake-device-pass');
  });

  it('copes with a PC without a Brain', () => {
    expect(credentialsText({ admin: null, devices: [] })).toBe('Lefi Crop credentials\n');
  });
});

import { isNewer } from './updates';

describe('Lefi Desktop update offer (ADR-051)', () => {
  it('only a strictly newer, well-formed version counts', () => {
    expect(isNewer('0.3.0', '0.2.0')).toBe(true);
    expect(isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('0.2.0', '0.2.0')).toBe(false);
    expect(isNewer('0.1.9', '0.2.0')).toBe(false);
    expect(isNewer(null, '0.2.0')).toBe(false);
    expect(isNewer('0.3.0', undefined)).toBe(false);
    expect(isNewer('0.3.0-beta', '0.2.0')).toBe(false);
  });
});
