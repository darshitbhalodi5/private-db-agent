import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditService } from '../src/services/auditService.js';

test('audit service writes allow decision to adapter', async () => {
  const calls = [];
  const auditService = createAuditService({
    databaseAdapter: {
      dialect: 'sqlite',
      execute: async (query) => {
        calls.push(query);
        return { rowCount: 1, rows: [] };
      }
    },
    now: () => new Date('2026-02-17T10:00:00.000Z')
  });

  const result = await auditService.recordDecision({
    payload: {
      requestId: 'req-audit-1',
      requester: '0x0000000000000000000000000000000000001234',
      capability: 'balances:read',
      queryTemplate: 'wallet_balances'
    },
    requester: '0x0000000000000000000000000000000000001234',
    decision: 'allow'
  });

  assert.equal(result.logged, true);
  assert.equal(result.code, 'LOGGED');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, 'write');
  assert.ok(calls[0].sql.includes('INSERT INTO access_log'));
  assert.equal(calls[0].values[0], 'req-audit-1');
  assert.equal(calls[0].values[4], 'allow');
});

test('audit service returns unsupported for unknown dialect', async () => {
  const auditService = createAuditService({
    databaseAdapter: {
      dialect: 'unknown',
      execute: async () => ({ rowCount: 1, rows: [] })
    }
  });

  const result = await auditService.recordDecision({
    payload: {
      requestId: 'req-audit-2',
      requester: '0x0000000000000000000000000000000000001234',
      capability: 'balances:read',
      queryTemplate: 'wallet_balances'
    },
    requester: '0x0000000000000000000000000000000000001234',
    decision: 'deny'
  });

  assert.equal(result.logged, false);
  assert.equal(result.code, 'UNSUPPORTED_DIALECT');
});
