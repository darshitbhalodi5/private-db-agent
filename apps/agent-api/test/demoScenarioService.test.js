import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService } from '../src/services/authService.js';
import { createDemoScenarioService } from '../src/services/demoScenarioService.js';

function createDemoConfig(overrides = {}) {
  return {
    enabled: true,
    signerPrivateKey: '',
    altSignerPrivateKey: '',
    targetWalletAddress: '0x8ba1f109551bd432803012645ac136ddd64dba72',
    defaultChainId: 1,
    ...overrides
  };
}

test('demo service lists scenarios', () => {
  const demoService = createDemoScenarioService(createDemoConfig());
  const scenarios = demoService.listScenarios();

  assert.equal(Array.isArray(scenarios), true);
  assert.equal(scenarios.length, 3);
  assert.ok(scenarios.some((scenario) => scenario.id === 'allow-balance-read'));
  assert.ok(scenarios.some((scenario) => scenario.id === 'deny-policy-write-attempt'));
  assert.ok(scenarios.some((scenario) => scenario.id === 'deny-auth-signer-mismatch'));
});

test('allow scenario generates valid signature', async () => {
  const nowIso = '2026-02-17T10:00:00.000Z';
  const demoService = createDemoScenarioService(createDemoConfig(), {
    now: () => new Date(nowIso)
  });

  const result = await demoService.buildScenarioPayload('allow-balance-read');
  assert.equal(result.ok, true);

  const authService = createAuthService(
    {
      enabled: true,
      nonceTtlSeconds: 300,
      maxFutureSkewSeconds: 60
    },
    {
      now: () => Date.parse('2026-02-17T10:00:30.000Z')
    }
  );

  const authResult = await authService.authenticate(result.payload);

  assert.equal(authResult.ok, true);
  assert.equal(result.payload.capability, 'balances:read');
  assert.equal(result.payload.queryTemplate, 'wallet_balances');
});

test('auth mismatch scenario fails authentication with signer mismatch', async () => {
  const nowIso = '2026-02-17T10:00:00.000Z';
  const demoService = createDemoScenarioService(createDemoConfig(), {
    now: () => new Date(nowIso)
  });

  const result = await demoService.buildScenarioPayload('deny-auth-signer-mismatch');
  assert.equal(result.ok, true);

  const authService = createAuthService(
    {
      enabled: true,
      nonceTtlSeconds: 300,
      maxFutureSkewSeconds: 60
    },
    {
      now: () => Date.parse('2026-02-17T10:00:30.000Z')
    }
  );

  const authResult = await authService.authenticate(result.payload);

  assert.equal(authResult.ok, false);
  assert.equal(authResult.code, 'SIGNER_MISMATCH');
});

test('unknown scenario returns explicit error', async () => {
  const demoService = createDemoScenarioService(createDemoConfig());
  const result = await demoService.buildScenarioPayload('unknown-scenario');

  assert.equal(result.ok, false);
  assert.equal(result.code, 'UNKNOWN_SCENARIO');
});
