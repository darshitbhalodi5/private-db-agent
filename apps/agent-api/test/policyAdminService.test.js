import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSqliteAdapter } from '../src/db/adapters/sqliteAdapter.js';
import { createPolicyAdminService } from '../src/services/policyAdminService.js';
import { createPolicyGrantStore } from '../src/services/policyGrantStore.js';
import { createPolicyMutationAuthService } from '../src/services/policyMutationAuthService.js';

const adminWallet = '0x8ba1f109551bd432803012645ac136ddd64dba72';
const managerWallet = '0x0000000000000000000000000000000000001234';

async function withPolicyAdminService(testFn) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'private-db-agent-policy-admin-'));
  const dbPath = path.join(tempDir, 'policy.sqlite');
  const adapter = await createSqliteAdapter({ filePath: dbPath });

  const grantStore = createPolicyGrantStore({ databaseAdapter: adapter });
  await grantStore.ensureInitialized();

  const policyAdminService = createPolicyAdminService({
    grantStore,
    mutationAuthService: createPolicyMutationAuthService({ enabled: false }),
    now: () => '2026-02-18T00:00:00.000Z'
  });

  try {
    await testFn({ policyAdminService, grantStore });
  } finally {
    await adapter.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function bootstrapPayload() {
  return {
    requestId: 'req-bootstrap',
    tenantId: 'tenant_demo',
    actorWallet: adminWallet,
    grant: {
      walletAddress: adminWallet,
      scopeType: 'database',
      scopeId: '*',
      operation: 'all',
      effect: 'allow'
    }
  };
}

test('bootstrap grant is required for first tenant grant', async () => {
  await withPolicyAdminService(async ({ policyAdminService }) => {
    const invalidBootstrap = await policyAdminService.createGrant({
      requestId: 'req-invalid-bootstrap',
      tenantId: 'tenant_demo',
      actorWallet: managerWallet,
      grant: {
        walletAddress: managerWallet,
        scopeType: 'table',
        scopeId: 'inventory',
        operation: 'read',
        effect: 'allow'
      }
    });

    assert.equal(invalidBootstrap.statusCode, 403);
    assert.equal(invalidBootstrap.body.error, 'BOOTSTRAP_REQUIRED');

    const bootstrap = await policyAdminService.createGrant(bootstrapPayload());
    assert.equal(bootstrap.statusCode, 201);
    assert.equal(bootstrap.body.grant.scopeType, 'database');
    assert.equal(bootstrap.body.grant.operation, 'all');
  });
});

test('self-escalation is blocked for actor without required permissions', async () => {
  await withPolicyAdminService(async ({ policyAdminService }) => {
    const bootstrap = await policyAdminService.createGrant(bootstrapPayload());
    assert.equal(bootstrap.statusCode, 201);

    const escalationAttempt = await policyAdminService.createGrant({
      requestId: 'req-escalation-attempt',
      tenantId: 'tenant_demo',
      actorWallet: managerWallet,
      grant: {
        walletAddress: managerWallet,
        scopeType: 'table',
        scopeId: 'inventory',
        operation: 'read',
        effect: 'allow'
      }
    });

    assert.equal(escalationAttempt.statusCode, 403);
    assert.equal(escalationAttempt.body.error, 'SELF_ESCALATION_BLOCKED');
  });
});

test('admin can grant and revoke permission with tamper check', async () => {
  await withPolicyAdminService(async ({ policyAdminService }) => {
    const bootstrap = await policyAdminService.createGrant(bootstrapPayload());
    assert.equal(bootstrap.statusCode, 201);

    const grantResult = await policyAdminService.createGrant({
      requestId: 'req-manager-grant',
      tenantId: 'tenant_demo',
      actorWallet: adminWallet,
      grant: {
        walletAddress: managerWallet,
        scopeType: 'table',
        scopeId: 'inventory',
        operation: 'read',
        effect: 'allow'
      }
    });

    assert.equal(grantResult.statusCode, 201);
    const managerGrant = grantResult.body.grant;

    const decisionBeforeRevoke = await policyAdminService.previewDecision({
      tenantId: 'tenant_demo',
      walletAddress: managerWallet,
      scopeType: 'table',
      scopeId: 'inventory',
      operation: 'read'
    });

    assert.equal(decisionBeforeRevoke.statusCode, 200);
    assert.equal(decisionBeforeRevoke.body.decision.allowed, true);

    const tamperFailure = await policyAdminService.revokeGrant({
      requestId: 'req-revoke-tamper',
      tenantId: 'tenant_demo',
      actorWallet: adminWallet,
      grantId: managerGrant.grantId,
      expectedSignatureHash: 'invalid-signature-hash'
    });

    assert.equal(tamperFailure.statusCode, 409);
    assert.equal(tamperFailure.body.error, 'TAMPER_CHECK_FAILED');

    const revokeResult = await policyAdminService.revokeGrant({
      requestId: 'req-revoke-valid',
      tenantId: 'tenant_demo',
      actorWallet: adminWallet,
      grantId: managerGrant.grantId,
      expectedSignatureHash: managerGrant.signatureHash
    });

    assert.equal(revokeResult.statusCode, 200);
    assert.equal(revokeResult.body.grant.revokedAt, '2026-02-18T00:00:00.000Z');

    const decisionAfterRevoke = await policyAdminService.previewDecision({
      tenantId: 'tenant_demo',
      walletAddress: managerWallet,
      scopeType: 'table',
      scopeId: 'inventory',
      operation: 'read'
    });

    assert.equal(decisionAfterRevoke.statusCode, 200);
    assert.equal(decisionAfterRevoke.body.decision.allowed, false);
    assert.equal(decisionAfterRevoke.body.decision.code, 'FALLBACK_DENY');
  });
});
