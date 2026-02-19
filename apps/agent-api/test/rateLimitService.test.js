import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimitService } from '../src/services/rateLimitService.js';

test('rate limit service blocks requests above threshold inside window', () => {
  let nowMs = Date.parse('2026-02-18T00:00:00.000Z');
  const limiter = createRateLimitService(
    {
      enabled: true,
      windowMs: 60_000,
      maxRequests: 2
    },
    {
      now: () => nowMs
    }
  );

  const first = limiter.consume('client:/v1/query');
  assert.equal(first.allowed, true);

  const second = limiter.consume('client:/v1/query');
  assert.equal(second.allowed, true);

  const third = limiter.consume('client:/v1/query');
  assert.equal(third.allowed, false);
  assert.equal(third.remaining, 0);

  nowMs += 60_100;

  const afterWindow = limiter.consume('client:/v1/query');
  assert.equal(afterWindow.allowed, true);
});

test('rate limiter allows requests when disabled', () => {
  const limiter = createRateLimitService({
    enabled: false
  });

  const result = limiter.consume('any');
  assert.equal(result.allowed, true);
});
