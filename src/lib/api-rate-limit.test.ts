import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const limit = vi.fn();
vi.mock('@upstash/redis', () => ({ Redis: class {} }));
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow() {
      return {};
    }
    limit = limit;
  },
}));

import { isRateLimitedDurable } from '../../api/generate';

describe('isRateLimitedDurable', () => {
  beforeEach(() => {
    limit.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('uses the in-memory limiter without Upstash env', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    let refused = 0;
    for (let i = 0; i < 12; i++) if (await isRateLimitedDurable('1.2.3.4')) refused++;
    expect(refused).toBe(2);
    expect(limit).not.toHaveBeenCalled();
  });

  it('allows when both per-IP and global windows allow', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.invalid');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'x');
    limit.mockResolvedValue({ success: true });
    expect(await isRateLimitedDurable('a')).toBe(false);
    expect(limit).toHaveBeenCalledTimes(2);
  });

  it('refuses when the global window is exhausted', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.invalid');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'x');
    limit.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false });
    expect(await isRateLimitedDurable('b')).toBe(true);
  });

  it('fails closed on store error or timeout', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.invalid');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'x');
    limit.mockRejectedValueOnce(new Error('down'));
    expect(await isRateLimitedDurable('c')).toBe(true);
    limit.mockResolvedValueOnce({ success: true, reason: 'timeout' });
    expect(await isRateLimitedDurable('c')).toBe(true);
  });
});
