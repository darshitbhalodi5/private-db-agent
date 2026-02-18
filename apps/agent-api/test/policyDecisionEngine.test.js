import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePolicyDecision } from '../src/services/policyDecisionEngine.js';

const tenantId = 'tenant_demo';
const walletAddress = '0x8ba1f109551bd432803012645ac136ddd64dba72';

function createGrant({
  grantId,
  scopeType,
  scopeId,
  operation,
  effect,
  createdAt = '2026-02-18T00:00:00.000Z'
}) {
  return {
    grantId,
    tenantId,
    walletAddress,
    scopeType,
    scopeId,
    operation,
    effect,
    createdAt
  };
}

test('policy decision follows precedence and denies on table-operation deny first', () => {
  const grants = [
    createGrant({
      grantId: 'grant-db-all-allow',
      scopeType: 'database',
      scopeId: '*',
      operation: 'all',
      effect: 'allow'
    }),
    createGrant({
      grantId: 'grant-table-read-allow',
      scopeType: 'table',
      scopeId: 'inventory',
      operation: 'read',
      effect: 'allow'
    }),
    createGrant({
      grantId: 'grant-table-read-deny',
      scopeType: 'table',
      scopeId: 'inventory',
      operation: 'read',
      effect: 'deny',
      createdAt: '2026-02-18T00:01:00.000Z'
    })
  ];

  const result = evaluatePolicyDecision({
    tenantId,
    walletAddress,
    scopeType: 'table',
    scopeId: 'inventory',
    operation: 'read',
    grants
  });

  assert.equal(result.ok, true);
  assert.equal(result.decision.allowed, false);
  assert.equal(result.decision.code, 'TABLE_OPERATION_DENY_MATCH');
  assert.equal(result.decision.matchedGrant.grantId, 'grant-table-read-deny');
});

test('database operation allow precedes table all deny based on evaluation order', () => {
  const grants = [
    createGrant({
      grantId: 'grant-db-insert-allow',
      scopeType: 'database',
      scopeId: '*',
      operation: 'insert',
      effect: 'allow'
    }),
    createGrant({
      grantId: 'grant-table-all-deny',
      scopeType: 'table',
      scopeId: 'inventory',
      operation: 'all',
      effect: 'deny'
    })
  ];

  const result = evaluatePolicyDecision({
    tenantId,
    walletAddress,
    scopeType: 'table',
    scopeId: 'inventory',
    operation: 'insert',
    grants
  });

  assert.equal(result.ok, true);
  assert.equal(result.decision.allowed, true);
  assert.equal(result.decision.code, 'DATABASE_OPERATION_ALLOW_MATCH');
});

test('policy decision returns fallback deny when no grant matches', () => {
  const result = evaluatePolicyDecision({
    tenantId,
    walletAddress,
    scopeType: 'table',
    scopeId: 'inventory',
    operation: 'delete',
    grants: []
  });

  assert.equal(result.ok, true);
  assert.equal(result.decision.allowed, false);
  assert.equal(result.decision.code, 'FALLBACK_DENY');
  assert.equal(result.decision.matchedGrant, null);
});
