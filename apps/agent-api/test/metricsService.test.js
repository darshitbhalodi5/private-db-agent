import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetricsService } from '../src/services/metricsService.js';

test('metrics service records request counters and durations', () => {
  const metrics = createMetricsService();

  metrics.recordHttpRequest({
    method: 'POST',
    path: '/v1/query',
    statusCode: 200,
    durationMs: 42,
    payload: {
      code: 'QUERY_EXECUTED'
    }
  });

  metrics.recordHttpRequest({
    method: 'POST',
    path: '/v1/query',
    statusCode: 403,
    durationMs: 19,
    payload: {
      error: 'POLICY_DENIED'
    }
  });

  const snapshot = metrics.snapshot();
  assert.equal(Array.isArray(snapshot.counters), true);
  assert.equal(Array.isArray(snapshot.durations), true);

  const httpCounter = snapshot.counters.find(
    (entry) => entry.name === 'http_requests_total' && entry.labels.statusCode === '200'
  );
  assert.equal(httpCounter?.value, 1);

  const denyCounter = snapshot.counters.find(
    (entry) => entry.name === 'decision_outcomes_total' && entry.labels.outcome === 'deny'
  );
  assert.equal(denyCounter?.labels.reason, 'POLICY_DENIED');
});

test('metrics service tracks migration duration observations', () => {
  const metrics = createMetricsService();

  metrics.observeDuration('migration_apply_duration_ms', 100, { status: 'success' });
  metrics.observeDuration('migration_apply_duration_ms', 300, { status: 'success' });

  const duration = metrics
    .snapshot()
    .durations.find(
      (entry) =>
        entry.name === 'migration_apply_duration_ms' && entry.labels.status === 'success'
    );

  assert.equal(duration?.count, 2);
  assert.equal(duration?.minMs, 100);
  assert.equal(duration?.maxMs, 300);
  assert.equal(duration?.avgMs, 200);
});
