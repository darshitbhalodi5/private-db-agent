import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createQueryService } from '../src/services/queryService.js';

function createStubbedQueryService({
  authResult = {
    ok: true,
    requester: '0x0000000000000000000000000000000000001234',
    signedAt: '2026-02-17T10:00:00.000Z',
    nonce: 'nonce-1'
  },
  policyResult = {
    allowed: true,
    code: 'ALLOWED',
    message: 'Capability policy matched.'
  },
  executionResult = {
    ok: true,
    statusCode: 200,
    data: {
      queryTemplate: 'wallet_balances',
      mode: 'read',
      rowCount: 1,
      rows: [{ asset_symbol: 'ETH', balance: 1.23 }],
      normalizedParams: {
        walletAddress: '0x0000000000000000000000000000000000001234',
        chainId: 1,
        limit: 50
      }
    }
  }
} = {}) {
  const receiptService = {
    buildReceipt: () => ({
      version: '1.0',
      receiptId: 'rcpt_test_receipt_1',
      createdAt: '2026-02-17T10:00:00.000Z',
      hashAlgorithm: 'sha256',
      requestHash: 'request-hash',
      decisionHash: 'decision-hash',
      verificationHash: 'verification-hash',
      verification: {
        service: {
          name: 'private-db-agent-api',
          version: '0.1.0',
          environment: 'test'
        }
      }
    })
  };

  const auditService = {
    recordDecision: async () => ({
      logged: true,
      code: 'LOGGED'
    })
  };

  return createQueryService({
    authService: {
      authenticate: async () => authResult
    },
    policyService: {
      evaluateAccess: () => policyResult
    },
    queryExecutionService: {
      execute: async () => executionResult
    },
    receiptService,
    auditService
  });
}

test('loadConfig returns default values including database settings', () => {
  const config = loadConfig({});

  assert.equal(config.serviceName, 'private-db-agent-api');
  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.port, 8080);
  assert.equal(config.version, '0.1.0');
  assert.equal(config.auth.enabled, true);
  assert.equal(config.auth.nonceTtlSeconds, 300);
  assert.equal(config.auth.maxFutureSkewSeconds, 60);
  assert.equal(config.policy.enforceCapabilityMode, true);
  assert.equal(config.proof.enabled, true);
  assert.equal(config.proof.hashAlgorithm, 'sha256');
  assert.equal(config.proof.trustModel, 'eigencompute-mainnet-alpha');
  assert.equal(config.database.driver, 'sqlite');
  assert.equal(config.database.sqlite.filePath, './data/private-db-agent.sqlite');
  assert.equal(config.database.postgres.maxPoolSize, 10);
});

test('query service returns execution result after auth and policy pass', async () => {
  const queryService = createStubbedQueryService();

  const result = await queryService.handle({
    requestId: 'req-1',
    requester: '0x0000000000000000000000000000000000001234',
    capability: 'balances:read',
    queryTemplate: 'wallet_balances',
    queryParams: { walletAddress: '0x0000000000000000000000000000000000001234', chainId: 1 }
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.requestId, 'req-1');
  assert.equal(result.body.execution.rowCount, 1);
  assert.equal(result.body.policy.code, 'ALLOWED');
  assert.equal(result.body.receipt.receiptId, 'rcpt_test_receipt_1');
  assert.equal(result.body.audit.logged, true);
});

test('query service validates required fields', async () => {
  const queryService = createStubbedQueryService();

  const result = await queryService.handle({ requestId: 'req-2' });

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, 'VALIDATION_ERROR');
  assert.match(result.body.message, /requester/);
});

test('query service rejects non-object payloads', async () => {
  const queryService = createStubbedQueryService();

  const result = await queryService.handle(null);

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, 'VALIDATION_ERROR');
  assert.match(result.body.message, /JSON object/);
});

test('query service returns policy denied with allowed templates', async () => {
  const queryService = createStubbedQueryService({
    policyResult: {
      allowed: false,
      code: 'TEMPLATE_NOT_ALLOWED',
      message: 'Template not allowed for capability.',
      allowedTemplates: ['wallet_balances']
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
  assert.equal(result.body.receipt.receiptId, 'rcpt_test_receipt_1');
});

test('query service returns execution failure details', async () => {
  const queryService = createStubbedQueryService({
    executionResult: {
      ok: false,
      statusCode: 400,
      code: 'UNKNOWN_QUERY_TEMPLATE',
      message: 'Unknown query template.',
      details: { template: 'unknown_template' }
    }
  });

  const result = await queryService.handle({
    requestId: 'req-4',
    requester: '0x0000000000000000000000000000000000001234',
    capability: 'balances:read',
    queryTemplate: 'unknown_template'
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, 'QUERY_EXECUTION_FAILED');
  assert.equal(result.body.code, 'UNKNOWN_QUERY_TEMPLATE');
});
