import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkRateLimit,
  recordAttempt,
  resetRateLimit,
  clearAllRateLimits,
  RATE_LIMIT_SIGN_IN,
  RATE_LIMIT_SIGN_OUT,
  RateLimitOptions,
} from './rate-limiter';

describe('Rate Limiter Module', () => {
  beforeEach(async () => {
    await clearAllRateLimits();
  });

  it('allows actions when within limit', async () => {
    const policy: RateLimitOptions = { maxRequests: 3, windowMs: 10_000, enforceInTest: true };
    const check = await checkRateLimit('test:action', policy);
    expect(check.allowed).toBe(true);
    expect(check.remaining).toBe(3);
    expect(check.retryAfterSeconds).toBe(0);
  });

  it('decrements remaining capacity as attempts are recorded', async () => {
    const policy: RateLimitOptions = { maxRequests: 3, windowMs: 10_000, enforceInTest: true };

    const first = await recordAttempt('test:action', policy);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(2);

    const second = await recordAttempt('test:action', policy);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(1);

    const third = await recordAttempt('test:action', policy);
    expect(third.allowed).toBe(false); // 3rd reached limit
    expect(third.remaining).toBe(0);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('enforces lockout when limit is exceeded', async () => {
    const policy: RateLimitOptions = { maxRequests: 2, windowMs: 5_000, lockoutMs: 10_000, enforceInTest: true };
    const now = 1000000;

    await recordAttempt('test:lockout', policy, now);
    await recordAttempt('test:lockout', policy, now + 100);

    const check = await checkRateLimit('test:lockout', policy, now + 200);
    expect(check.allowed).toBe(false);
    expect(check.error).toContain('Too many attempts');
    expect(check.retryAfterSeconds).toBe(10);
  });

  it('enforces cooldown gap between consecutive actions', async () => {
    const policy: RateLimitOptions = { maxRequests: 10, windowMs: 60_000, cooldownMs: 3_000, enforceInTest: true };
    const now = 1000000;

    await recordAttempt('test:cooldown', policy, now);

    // Immediate next call within 1s should fail due to cooldown
    const checkImmediate = await checkRateLimit('test:cooldown', policy, now + 1000);
    expect(checkImmediate.allowed).toBe(false);
    expect(checkImmediate.retryAfterSeconds).toBe(2);

    // After 3.5s cooldown passes, call should be allowed
    const checkAfter = await checkRateLimit('test:cooldown', policy, now + 3500);
    expect(checkAfter.allowed).toBe(true);
  });

  it('allows resetting limit after successful action', async () => {
    const policy: RateLimitOptions = { maxRequests: 2, windowMs: 5_000, enforceInTest: true };
    const now = 1000000;

    await recordAttempt('test:reset', policy, now);
    await recordAttempt('test:reset', policy, now + 100);

    let check = await checkRateLimit('test:reset', policy, now + 200);
    expect(check.allowed).toBe(false);

    // Reset after success
    await resetRateLimit('test:reset');

    check = await checkRateLimit('test:reset', policy, now + 300);
    expect(check.allowed).toBe(true);
    expect(check.remaining).toBe(2);
  });

  it('expires old attempts outside the sliding window', async () => {
    const policy: RateLimitOptions = { maxRequests: 2, windowMs: 2_000, enforceInTest: true };
    const now = 1000000;

    await recordAttempt('test:window', policy, now);
    await recordAttempt('test:window', policy, now + 1000);

    // At now + 1500, both are within 2s window
    let check = await checkRateLimit('test:window', policy, now + 1500);
    expect(check.allowed).toBe(false);

    // At now + 2500, first attempt (now) has expired, but second (now + 1000) is still active
    check = await checkRateLimit('test:window', policy, now + 2500);
    expect(check.allowed).toBe(true);
    expect(check.remaining).toBe(1);
  });

  it('configures sensible defaults for auth operations', () => {
    expect(RATE_LIMIT_SIGN_IN.maxRequests).toBe(5);
    expect(RATE_LIMIT_SIGN_IN.windowMs).toBe(60_000);
    expect(RATE_LIMIT_SIGN_OUT.cooldownMs).toBe(3_000);
  });
});
