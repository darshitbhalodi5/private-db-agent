import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { Wallet } from 'ethers';
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

test('a2a auth authenticates valid evm personal-sign request', async () => {
  const signerWallet = Wallet.createRandom();
  const service = createA2aAuthService(
    {
      enabled: true,
      allowUnsigned: false,
      signatureScheme: 'evm-personal-sign',
      allowedAgentIds: ['agent-evm'],
      agentSignerRegistry: {
        'agent-evm': signerWallet.address
      },
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
      requestId: 'req-evm-1'
    }
  };
  const message = buildA2aSigningMessage({
    agentId: 'agent-evm',
    method: 'POST',
    path: '/v1/a2a/tasks',
    timestamp: '2026-02-18T00:00:00.000Z',
    nonce: 'nonce-evm-1',
    correlationId: 'corr-evm-1',
    idempotencyKey: 'idem-evm-1',
    payloadHash: payloadHash(body)
  });
  const signature = await signerWallet.signMessage(message);

  const result = await service.authenticate({
    method: 'POST',
    path: '/v1/a2a/tasks',
    headers: {
      'x-agent-id': 'agent-evm',
      'x-agent-timestamp': '2026-02-18T00:00:00.000Z',
      'x-agent-nonce': 'nonce-evm-1',
      'x-agent-signature': signature,
      'x-idempotency-key': 'idem-evm-1'
    },
    body,
    correlationId: 'corr-evm-1',
    idempotencyKey: 'idem-evm-1'
  });

  assert.equal(result.ok, true);
  assert.equal(result.signatureScheme, 'evm-personal-sign');
  assert.equal(result.signerAddress, signerWallet.address.toLowerCase());
});

test('a2a auth rejects evm signature when signer does not match registry', async () => {
  const expectedWallet = Wallet.createRandom();
  const wrongWallet = Wallet.createRandom();
  const service = createA2aAuthService(
    {
      enabled: true,
      allowUnsigned: false,
      signatureScheme: 'evm-personal-sign',
      allowedAgentIds: ['agent-evm'],
      agentSignerRegistry: {
        'agent-evm': expectedWallet.address
      },
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
      requestId: 'req-evm-2'
    }
  };
  const message = buildA2aSigningMessage({
    agentId: 'agent-evm',
    method: 'POST',
    path: '/v1/a2a/tasks',
    timestamp: '2026-02-18T00:00:00.000Z',
    nonce: 'nonce-evm-2',
    correlationId: 'corr-evm-2',
    idempotencyKey: 'idem-evm-2',
    payloadHash: payloadHash(body)
  });
  const signature = await wrongWallet.signMessage(message);

  const result = await service.authenticate({
    method: 'POST',
    path: '/v1/a2a/tasks',
    headers: {
      'x-agent-id': 'agent-evm',
      'x-agent-timestamp': '2026-02-18T00:00:00.000Z',
      'x-agent-nonce': 'nonce-evm-2',
      'x-agent-signature': signature,
      'x-idempotency-key': 'idem-evm-2'
    },
    body,
    correlationId: 'corr-evm-2',
    idempotencyKey: 'idem-evm-2'
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'A2A_SIGNATURE_MISMATCH');
});

test('a2a auth rejects evm mode when signer registry entry is missing', async () => {
  const signerWallet = Wallet.createRandom();
  const service = createA2aAuthService(
    {
      enabled: true,
      allowUnsigned: false,
      signatureScheme: 'evm-personal-sign',
      allowedAgentIds: ['agent-evm'],
      agentSignerRegistry: {},
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
      requestId: 'req-evm-3'
    }
  };
  const message = buildA2aSigningMessage({
    agentId: 'agent-evm',
    method: 'POST',
    path: '/v1/a2a/tasks',
    timestamp: '2026-02-18T00:00:00.000Z',
    nonce: 'nonce-evm-3',
    correlationId: 'corr-evm-3',
    idempotencyKey: 'idem-evm-3',
    payloadHash: payloadHash(body)
  });
  const signature = await signerWallet.signMessage(message);

  const result = await service.authenticate({
    method: 'POST',
    path: '/v1/a2a/tasks',
    headers: {
      'x-agent-id': 'agent-evm',
      'x-agent-timestamp': '2026-02-18T00:00:00.000Z',
      'x-agent-nonce': 'nonce-evm-3',
      'x-agent-signature': signature,
      'x-idempotency-key': 'idem-evm-3'
    },
    body,
    correlationId: 'corr-evm-3',
    idempotencyKey: 'idem-evm-3'
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'A2A_SIGNER_NOT_CONFIGURED');
});
