import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { buildA2aSigningMessage, createA2aAuthService } from '../src/services/a2aAuthService.js';

const sharedSecret = 'test-shared-secret';

function sign(message) {
  return createHmac('sha256', sharedSecret).update(message).digest('hex');
}

function stableSort(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableSort(item));
  }

  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = stableSort(value[key]);
    }
    return sorted;
  }

  return value;
}

function payloadHash(value) {
  return createHash('sha256').update(JSON.stringify(stableSort(value || {}))).digest('hex');
}

function buildSignedHeaders({
  agentId = 'agent-alpha',
  method = 'POST',
  path = '/v1/a2a/tasks',
  timestamp = '2026-02-18T00:00:00.000Z',
  nonce = 'nonce-1',
  correlationId = 'corr-1',
  idempotencyKey = 'idem-1',
  body = {}
} = {}) {
  const stableHash = payloadHash(body);

  const signingMessage = buildA2aSigningMessage({
    agentId,
    method,
    path,
    timestamp,
    nonce,
    correlationId,
    idempotencyKey,
    payloadHash: stableHash
  });

  return {
    'x-agent-id': agentId,
    'x-agent-timestamp': timestamp,
    'x-agent-nonce': nonce,
    'x-agent-signature': sign(signingMessage),
    'x-idempotency-key': idempotencyKey
  };
}

test('a2a auth authenticates valid signed request', async () => {
  const service = createA2aAuthService(
    {
      enabled: true,
      allowUnsigned: false,
      sharedSecret,
      allowedAgentIds: ['agent-alpha'],
      nonceTtlSeconds: 300,
      maxFutureSkewSeconds: 60
    },
    {
      now: () => Date.parse('2026-02-18T00:00:10.000Z')
    }
  );

  const body = {
    taskType: 'query.execute',
    input: {
      requestId: 'req-1'
    }
  };
  const headers = buildSignedHeaders({
    body
  });

  const result = await service.authenticate({
    method: 'POST',
    path: '/v1/a2a/tasks',
    headers,
    body,
    correlationId: 'corr-1',
    idempotencyKey: 'idem-1'
  });

  assert.equal(result.ok, true);
  assert.equal(result.agentId, 'agent-alpha');
});

test('a2a auth rejects nonce replay', async () => {
  const service = createA2aAuthService(
    {
      enabled: true,
      allowUnsigned: false,
      sharedSecret,
      allowedAgentIds: ['agent-alpha'],
      nonceTtlSeconds: 300,
      maxFutureSkewSeconds: 60
    },
    {
      now: () => Date.parse('2026-02-18T00:00:10.000Z')
    }
  );

  const body = {
    taskType: 'query.execute',
    input: {
      requestId: 'req-1'
    }
  };
  const headers = buildSignedHeaders({
    body,
    nonce: 'nonce-replay'
  });

  const first = await service.authenticate({
    method: 'POST',
    path: '/v1/a2a/tasks',
    headers,
    body,
    correlationId: 'corr-1',
    idempotencyKey: 'idem-1'
  });
  assert.equal(first.ok, true);

  const second = await service.authenticate({
    method: 'POST',
    path: '/v1/a2a/tasks',
    headers,
    body,
    correlationId: 'corr-1',
    idempotencyKey: 'idem-1'
  });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'A2A_NONCE_REPLAY');
});

test('a2a task authorization enforces configured allowlist', () => {
  const service = createA2aAuthService({
    enabled: true,
    allowUnsigned: true,
    taskAllowlist: {
      'agent-alpha': ['query.execute']
    }
  });

  const allowed = service.authorizeTaskType('agent-alpha', 'query.execute');
  assert.equal(allowed.ok, true);

  const denied = service.authorizeTaskType('agent-alpha', 'schema.apply');
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'A2A_TASK_NOT_ALLOWED');
});
