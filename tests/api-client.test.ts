import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser API client hardening', () => {
  it('surfaces rate limiting instead of activating mock mode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Slow down.', code: 'RATE_LIMITED', retryAfter: 5 }),
      { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '7' } },
    )));

    await expect(api.health()).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      retryAfter: 5,
    });
  });

  it('rejects a non-JSON server response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      '<html>proxy error</html>',
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    )));

    await expect(api.health()).rejects.toMatchObject({
      status: 200,
      code: 'INVALID_RESPONSE',
    });
  });

  it('preserves an AbortError and never falls back to local data', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    await expect(api.health()).rejects.toBe(abortError);
  });

  it('reports an unavailable backend as a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connection refused')));

    await expect(api.health()).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    });
  });
});
