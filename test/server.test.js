import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createQueryService } from '../src/services/queryService.js';

test('loadConfig returns default values for base and auth settings', () => {
  const config = loadConfig({});

  assert.equal(config.serviceName, 'private-db-agent-api');
  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.port, 8080);
  assert.equal(config.version, '0.1.0');
  assert.equal(config.auth.enabled, true);
  assert.equal(config.auth.nonceTtlSeconds, 300);
  assert.equal(config.auth.maxFutureSkewSeconds, 60);
});

test('query service returns not implemented after auth and policy pass', async () => {
  const queryService = createQueryService({
    authService: {
      authenticate: async () => ({
        ok: true,
        requester: '0x0000000000000000000000000000000000001234',
        signedAt: '2026-02-17T10:00:00.000Z',
        nonce: 'nonce-1'
      })
    },
    policyService: {
      evaluateAccess: () => ({
        allowed: true,
        code: 'ALLOWED',
        message: 'Capability policy matched.'
      })
    }
  });

  const result = await queryService.handle({
    requestId: 'req-1',
    requester: '0x0000000000000000000000000000000000001234',
    capability: 'balances:read',
    queryTemplate: 'wallet_balances',
    queryParams: { chainId: 1 }
  });

  assert.equal(result.statusCode, 501);
  assert.equal(result.body.error, 'NOT_IMPLEMENTED');
  assert.equal(result.body.requestId, 'req-1');
  assert.equal(result.body.auth.bypassed, false);
  assert.equal(result.body.policy.code, 'ALLOWED');
});

test('query service validates required fields', async () => {
  const queryService = createQueryService({
    authService: { authenticate: async () => ({ ok: true, requester: '0x1' }) },
    policyService: { evaluateAccess: () => ({ allowed: true, code: 'ALLOWED' }) }
  });

  const result = await queryService.handle({ requestId: 'req-2' });

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, 'VALIDATION_ERROR');
  assert.match(result.body.message, /requester/);
});

test('query service rejects non-object payloads', async () => {
  const queryService = createQueryService({
    authService: { authenticate: async () => ({ ok: true, requester: '0x1' }) },
    policyService: { evaluateAccess: () => ({ allowed: true, code: 'ALLOWED' }) }
  });

  const result = await queryService.handle(null);

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, 'VALIDATION_ERROR');
  assert.match(result.body.message, /JSON object/);
});

test('query service returns policy denied with allowed templates', async () => {
  const queryService = createQueryService({
    authService: {
      authenticate: async () => ({
        ok: true,
        requester: '0x0000000000000000000000000000000000001234'
      })
    },
    policyService: {
      evaluateAccess: () => ({
        allowed: false,
        code: 'TEMPLATE_NOT_ALLOWED',
        message: 'Template not allowed for capability.',
        allowedTemplates: ['wallet_balances']
      })
    }
  });

  const result = await queryService.handle({
    requestId: 'req-3',
    requester: '0x0000000000000000000000000000000000001234',
    capability: 'balances:read',
    queryTemplate: 'wallet_transactions'
  });

  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error, 'POLICY_DENIED');
  assert.deepEqual(result.body.details.allowedTemplates, ['wallet_balances']);
});
