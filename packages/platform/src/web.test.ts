import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, BrainUnreachableError, NotSupportedError } from './errors';
import { createWebPlatform } from './web';

afterEach(() => vi.unstubAllGlobals());

describe('webPlatform.api', () => {
  it('maps a 403 body into ApiError with its code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: 'FORBIDDEN', message: 'your role does not allow this', details: {} },
            }),
            { status: 403 },
          ),
      ),
    );
    const err = await createWebPlatform()
      .api({ method: 'GET', path: '/audit' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).isForbidden).toBe(true);
    expect((err as ApiError).code).toBe('FORBIDDEN');
    expect((err as ApiError).brainMessage).toBe('your role does not allow this');
  });

  it('reports a network failure as BrainUnreachableError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(
      createWebPlatform().api({ method: 'GET', path: '/plants' }),
    ).rejects.toBeInstanceOf(BrainUnreachableError);
  });

  it('cannot pair a device', async () => {
    await expect(
      createWebPlatform().pair('https://192.0.2.1:8443', 'ABCD-EFGH-JKMN'),
    ).rejects.toBeInstanceOf(NotSupportedError);
  });
});
