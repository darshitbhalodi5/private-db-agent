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

test('metrics service emits action decision and deny reason counters for protected action paths', () => {
  const metrics = createMetricsService();

  metrics.recordHttpRequest({
    method: 'POST',
    path: '/v1/data/execute',
    action: 'data:execute',
    statusCode: 403,
    durationMs: 14,
    payload: {
      error: 'POLICY_DENIED',
      message: 'Denied by policy.'
    }
  });

  const snapshot = metrics.snapshot();
  const actionDecision = snapshot.counters.find(
    (entry) =>
      entry.name === 'action_decision_outcomes_total' &&
      entry.labels.domain === 'data' &&
      entry.labels.action === 'data:execute' &&
      entry.labels.outcome === 'deny'
  );
  assert.equal(actionDecision?.labels.reason, 'POLICY_DENIED');
  assert.equal(actionDecision?.labels.stage, 'policy');

  const denyReason = snapshot.counters.find(
    (entry) =>
      entry.name === 'action_deny_reasons_total' &&
      entry.labels.domain === 'data' &&
      entry.labels.action === 'data:execute' &&
      entry.labels.reason === 'POLICY_DENIED'
  );
  assert.equal(denyReason?.value, 1);
});

test('metrics service uses embedded decision outcome even when HTTP status is successful', () => {
  const metrics = createMetricsService();

  metrics.recordHttpRequest({
    method: 'POST',
    path: '/v1/policy/preview-decision',
    action: 'policy:preview:decision',
    statusCode: 200,
    durationMs: 9,
    payload: {
      code: 'POLICY_DECISION_PREVIEW',
      decision: {
        allowed: false,
        code: 'FALLBACK_DENY'
      }
    }
  });

  const snapshot = metrics.snapshot();
  const denyMetric = snapshot.counters.find(
    (entry) =>
      entry.name === 'action_decision_outcomes_total' &&
      entry.labels.domain === 'policy' &&
      entry.labels.action === 'policy:preview:decision' &&
      entry.labels.outcome === 'deny'
  );

  assert.equal(denyMetric?.labels.reason, 'FALLBACK_DENY');
  assert.equal(denyMetric?.labels.stage, 'policy');
});

test('metrics service does not emit protected action counters for non-protected domains', () => {
  const metrics = createMetricsService();

  metrics.recordHttpRequest({
    method: 'POST',
    path: '/v1/query',
    action: 'query:execute',
    statusCode: 403,
    durationMs: 20,
    payload: {
      error: 'POLICY_DENIED'
    }
  });

  const protectedMetrics = metrics
    .snapshot()
    .counters.filter((entry) => entry.name === 'action_decision_outcomes_total');

  assert.equal(protectedMetrics.length, 0);
});
