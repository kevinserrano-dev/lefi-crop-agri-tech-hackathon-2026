import { describe, expect, it } from 'vitest';
import { buildApiPath } from './request';

describe('buildApiPath', () => {
  it('prefixes /api/v1 and encodes the query', () => {
    expect(
      buildApiPath({ method: 'GET', path: '/alerts', query: { status: 'open', skip: undefined } }),
    ).toBe('/api/v1/alerts?status=open');
  });

  it.each(['alerts', '//evil.example/x', 'https://evil.example/api', '/x?u=http://a'])(
    'rejects %s so the device identity cannot be sent to another host',
    (path) => {
      expect(() => buildApiPath({ method: 'GET', path })).toThrow(/Invalid API path/);
    },
  );
});
