import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueryExecutionService } from '../src/query/queryExecutionService.js';

function createFakeAdapter({ dialect = 'sqlite', executeResult = { rowCount: 0, rows: [] } } = {}) {
  const calls = [];

  return {
    dialect,
    calls,
    async execute(payload) {
      calls.push(payload);
      return executeResult;
    }
  };
}

test('execution rejects unknown query template', async () => {
  const adapter = createFakeAdapter();
  const executionService = createQueryExecutionService({
    databaseAdapter: adapter,
    enforceCapabilityMode: true
  });

  const result = await executionService.execute({
    capability: 'balances:read',
    queryTemplate: 'does_not_exist',
    queryParams: {}
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'UNKNOWN_QUERY_TEMPLATE');
});

test('execution rejects unknown parameters', async () => {
  const adapter = createFakeAdapter();
  const executionService = createQueryExecutionService({
    databaseAdapter: adapter,
    enforceCapabilityMode: true
  });

  const result = await executionService.execute({
    capability: 'balances:read',
    queryTemplate: 'wallet_balances',
    queryParams: {
      walletAddress: '0x0000000000000000000000000000000000001234',
      chainId: 1,
      invalidField: 'x'
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'UNKNOWN_PARAM');
});

test('execution enforces read/write capability separation', async () => {
  const adapter = createFakeAdapter();
  const executionService = createQueryExecutionService({
    databaseAdapter: adapter,
    enforceCapabilityMode: true
  });

  const result = await executionService.execute({
    capability: 'audit:read',
    queryTemplate: 'access_log_insert',
    queryParams: {
      requestId: 'req-1',
      requester: '0x0000000000000000000000000000000000001234',
      capability: 'balances:read',
      queryTemplate: 'wallet_balances',
      decision: 'allow',
      createdAt: '2026-02-17T10:00:00.000Z'
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'CAPABILITY_MODE_MISMATCH');
});

test('execution normalizes params and forwards sql/bind values to adapter', async () => {
  const adapter = createFakeAdapter({
    executeResult: {
      rowCount: 1,
      rows: [{ asset_symbol: 'ETH', balance: 1.23 }]
    }
  });

  const executionService = createQueryExecutionService({
    databaseAdapter: adapter,
    enforceCapabilityMode: true
  });

  const result = await executionService.execute({
    capability: 'balances:read',
    queryTemplate: 'wallet_balances',
    queryParams: {
      walletAddress: '0x0000000000000000000000000000000000001234',
      chainId: '1'
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.rowCount, 1);
  assert.equal(adapter.calls.length, 1);
  assert.equal(adapter.calls[0].mode, 'read');
  assert.ok(adapter.calls[0].sql.includes('FROM wallet_balances'));
  assert.deepEqual(adapter.calls[0].values, [
    '0x0000000000000000000000000000000000001234',
    1,
    50
  ]);
});
