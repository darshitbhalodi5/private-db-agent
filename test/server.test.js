import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { handleQueryRequest } from '../src/services/queryService.js';

test('loadConfig returns default values when env is empty', () => {
  const config = loadConfig({});

  assert.equal(config.serviceName, 'private-db-agent-api');
  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.port, 8080);
  assert.equal(config.version, '0.1.0');
});

test('handleQueryRequest returns not implemented with request context', async () => {
  const result = await handleQueryRequest({
    requestId: 'req-1',
    requester: '0xabc',
    capability: 'balances:read',
    queryTemplate: 'wallet_balances'
  });

  assert.equal(result.statusCode, 501);
  assert.equal(result.body.error, 'NOT_IMPLEMENTED');
  assert.equal(result.body.requestId, 'req-1');
});

test('handleQueryRequest validates required fields', async () => {
  const result = await handleQueryRequest({ requestId: 'req-2' });

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, 'VALIDATION_ERROR');
  assert.match(result.body.message, /requester/);
});
