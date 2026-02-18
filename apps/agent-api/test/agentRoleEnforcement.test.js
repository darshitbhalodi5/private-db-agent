import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers';
import { createSqliteAdapter } from '../src/db/adapters/sqliteAdapter.js';
import { createActionAuthorizationService } from '../src/services/actionAuthorizationService.js';
import { createDataOperationService } from '../src/services/dataOperationService.js';
import { createMigrationRunnerService } from '../src/services/migrationRunnerService.js';
import { createPolicyGrantStore } from '../src/services/policyGrantStore.js';
import {
  buildPolicyMutationMessage,
  createPolicyMutationAuthService
} from '../src/services/policyMutationAuthService.js';

const tenantId = 'tenant_demo';
const nowIso = '2026-02-18T00:00:00.000Z';
const nowMs = Date.parse('2026-02-18T00:00:30.000Z');

function createInventoryPlan() {
  return {
    planHash: 'plan_hash_role_enforcement',
    steps: [
      {
        stepId: 'step_001',
        action: 'ensure_database',
        description: 'ensure db'
      },
      {
        stepId: 'step_002',
        action: 'create_table',
        description: 'create inventory',
        metadata: {
          tableName: 'inventory'
        },
        sql: `
          CREATE TABLE IF NOT EXISTS "inventory" (
            "item_id" TEXT PRIMARY KEY NOT NULL,
            "quantity" INTEGER NOT NULL
          );
        `
      }
    ]
  };
}

async function signMutationAuth({
  wallet,
  requestId,
  action,
  payload,
  nonce,
  signedAt = nowIso
}) {
  const actorWallet = wallet.address.toLowerCase();
  const message = buildPolicyMutationMessage({
    requestId,
    tenantId,
    actorWallet,
    action,
    payload,
    nonce,
    signedAt
  });

  const signature = await wallet.signMessage(message);

  return {
    nonce,
    signedAt,
    signature
  };
}

async function withRoleEnforcementContext(testFn) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'private-db-agent-role-enforce-'));
  const dbPath = path.join(tempDir, 'role-enforce.sqlite');
  const adapter = await createSqliteAdapter({ filePath: dbPath });

  const migrationRunner = createMigrationRunnerService({
    databaseAdapter: adapter,
    now: () => nowIso
  });

  const grantStore = createPolicyGrantStore({ databaseAdapter: adapter });
  await grantStore.ensureInitialized();

  const mutationAuthService = createPolicyMutationAuthService(
    {
      enabled: true,
      nonceTtlSeconds: 300,
      maxFutureSkewSeconds: 60
    },
    {
      now: () => nowMs
    }
  );

  const actionAuthorizationService = createActionAuthorizationService({
    grantStore,
    mutationAuthService
  });

  const dataOperationService = createDataOperationService({
    databaseAdapter: adapter,
    grantStore,
    actionAuthorizationService
  });

  const managerWallet = Wallet.createRandom();

  try {
    const migrationResult = await migrationRunner.applyMigrationPlan({
      tenantId,
      requestId: 'req_prepare_inventory',
      migrationPlan: createInventoryPlan()
    });
    assert.equal(migrationResult.ok, true);

    await grantStore.createGrant({
      tenantId,
      walletAddress: managerWallet.address,
      scopeType: 'table',
      scopeId: 'inventory',
      operation: 'read',
      effect: 'allow',
      createdBy: managerWallet.address,
      createdAt: nowIso,
      signatureHash: 'seeded-grant-signature'
    });

    await testFn({
      dataOperationService,
      managerWallet
    });
  } finally {
    await adapter.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

test('agent denies data operations without signed actor auth', async () => {
  await withRoleEnforcementContext(async ({ dataOperationService, managerWallet }) => {
    const result = await dataOperationService.execute({
      requestId: 'req_no_auth',
      tenantId,
      actorWallet: managerWallet.address,
      operation: 'read',
      tableName: 'inventory',
      limit: 5
    });

    assert.equal(result.statusCode, 400);
    assert.equal(result.body.error, 'MISSING_AUTH');
  });
});

test('agent blocks explicit privilege override flags even with valid signature', async () => {
  await withRoleEnforcementContext(async ({ dataOperationService, managerWallet }) => {
    const auth = await signMutationAuth({
      wallet: managerWallet,
      requestId: 'req_override_attempt',
      action: 'data:execute',
      payload: {
        tableName: 'inventory',
        operation: 'read',
        values: null,
        filters: null,
        columns: null,
        limit: 5
      },
      nonce: 'nonce_override_1'
    });

    const result = await dataOperationService.execute({
      requestId: 'req_override_attempt',
      tenantId,
      actorWallet: managerWallet.address,
      operation: 'read',
      tableName: 'inventory',
      limit: 5,
      agentOverride: true,
      auth
    });

    assert.equal(result.statusCode, 403);
    assert.equal(result.body.error, 'AGENT_PRIVILEGE_ESCALATION_ATTEMPT');
  });
});

test('agent enforces policy and denies signed delete when wallet lacks delete grant', async () => {
  await withRoleEnforcementContext(async ({ dataOperationService, managerWallet }) => {
    const auth = await signMutationAuth({
      wallet: managerWallet,
      requestId: 'req_signed_delete',
      action: 'data:execute',
      payload: {
        tableName: 'inventory',
        operation: 'delete',
        values: null,
        filters: {
          item_id: 'item-1'
        },
        columns: null,
        limit: null,
        agentOverride: null,
        bypassPolicy: null,
        skipAuth: null,
        executeAsAgent: null,
        superuser: null,
        trustedOperator: null
      },
      nonce: 'nonce_delete_1'
    });

    const result = await dataOperationService.execute({
      requestId: 'req_signed_delete',
      tenantId,
      actorWallet: managerWallet.address,
      operation: 'delete',
      tableName: 'inventory',
      filters: {
        item_id: 'item-1'
      },
      auth
    });

    assert.equal(result.statusCode, 403);
    assert.equal(result.body.error, 'POLICY_DENIED');
  });
});
