import test from 'node:test';
import assert from 'node:assert/strict';
import { createPolicyService } from '../src/services/policyService.js';

test('policy allows configured capability and template', () => {
  const policyService = createPolicyService();

  const result = policyService.evaluateAccess({
    requester: '0x0000000000000000000000000000000000001234',
    capability: 'balances:read',
    queryTemplate: 'wallet_balances'
  });

  assert.equal(result.allowed, true);
  assert.equal(result.code, 'ALLOWED');
});

test('policy denies unknown capability', () => {
  const policyService = createPolicyService();

  const result = policyService.evaluateAccess({
    requester: '0x0000000000000000000000000000000000001234',
    capability: 'does:not:exist',
    queryTemplate: 'wallet_balances'
  });

  assert.equal(result.allowed, false);
  assert.equal(result.code, 'UNKNOWN_CAPABILITY');
});

test('policy denies templates not mapped to capability', () => {
  const policyService = createPolicyService();

  const result = policyService.evaluateAccess({
    requester: '0x0000000000000000000000000000000000001234',
    capability: 'balances:read',
    queryTemplate: 'wallet_transactions'
  });

  assert.equal(result.allowed, false);
  assert.equal(result.code, 'TEMPLATE_NOT_ALLOWED');
  assert.ok(Array.isArray(result.allowedTemplates));
});

test('policy supports requester-level restrictions in custom rules', () => {
  const allowedRequester = '0x0000000000000000000000000000000000001234';
  const policyService = createPolicyService({
    capabilityRules: {
      'balances:read': {
        templates: ['wallet_balances'],
        requesters: [allowedRequester]
      }
    }
  });

  const denied = policyService.evaluateAccess({
    requester: '0x0000000000000000000000000000000000009999',
    capability: 'balances:read',
    queryTemplate: 'wallet_balances'
  });

  const allowed = policyService.evaluateAccess({
    requester: allowedRequester,
    capability: 'balances:read',
    queryTemplate: 'wallet_balances'
  });

  assert.equal(denied.allowed, false);
  assert.equal(denied.code, 'REQUESTER_NOT_ALLOWED');
  assert.equal(allowed.allowed, true);
});
