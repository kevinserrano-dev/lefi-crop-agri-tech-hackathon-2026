import { describe, expect, it } from 'vitest';
import doc from '../openapi/brain.openapi.json';
import { BRAIN_PATHS, isMockBrain, servedByBrain } from './served';

describe('what the real Lefi Brain serves', () => {
  it('comes from the committed OpenAPI document', () => {
    expect(BRAIN_PATHS.size).toBe(Object.keys(doc.paths).length);
    expect(servedByBrain('/auth/login')).toBe(true);
    expect(servedByBrain('/devices/pair')).toBe(true);
    // Proposal only (mock Brain): must not count as served.
    expect(servedByBrain('/dashboard')).toBe(false);
    expect(servedByBrain('/incidents')).toBe(false);
  });

  it('only an explicit flag marks the mock', () => {
    expect(isMockBrain({ service: 'lefi-brain', mock: true })).toBe(true);
    expect(isMockBrain({ service: 'lefi-brain', version: '0.0.0-mock' })).toBe(false);
    expect(isMockBrain(undefined)).toBe(false);
  });
});
