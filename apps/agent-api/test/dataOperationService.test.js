import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSqliteAdapter } from '../src/db/adapters/sqliteAdapter.js';
import { createDataOperationService } from '../src/services/dataOperationService.js';
import { createMigrationRunnerService } from '../src/services/migrationRunnerService.js';
import { createPolicyAdminService } from '../src/services/policyAdminService.js';
import { createPolicyGrantStore } from '../src/services/policyGrantStore.js';
import { createPolicyMutationAuthService } from '../src/services/policyMutationAuthService.js';

const adminWallet = '0x8ba1f109551bd432803012645ac136ddd64dba72';
const managerWallet = '0x0000000000000000000000000000000000001234';
const tenantId = 'tenant_demo';

async function withDataOperationContext(testFn) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'private-db-agent-data-ops-'));
  const dbPath = path.join(tempDir, 'data-ops.sqlite');
  const adapter = await createSqliteAdapter({ filePath: dbPath });

  const migrationRunner = createMigrationRunnerService({
    databaseAdapter: adapter,
    now: () => '2026-02-18T00:00:00.000Z'
  });

  const grantStore = createPolicyGrantStore({ databaseAdapter: adapter });
  await grantStore.ensureInitialized();

  const policyAdminService = createPolicyAdminService({
    grantStore,
    mutationAuthService: createPolicyMutationAuthService({ enabled: false }),
    now: () => '2026-02-18T00:00:00.000Z'
  });

  const dataOperationService = createDataOperationService({
    databaseAdapter: adapter,
    grantStore
  });

  try {
    await testFn({
      migrationRunner,
      policyAdminService,
      dataOperationService
    });
  } finally {
    await adapter.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function inventoryPlan() {
  return {
    planHash: 'plan_hash_inventory',
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

async function bootstrapAndGrantManager(policyAdminService) {
  const bootstrap = await policyAdminService.createGrant({
    requestId: 'req_bootstrap',
    tenantId,
    actorWallet: adminWallet,
    grant: {
      walletAddress: adminWallet,
      scopeType: 'database',
      scopeId: '*',
      operation: 'all',
      effect: 'allow'
    }
  });
  assert.equal(bootstrap.statusCode, 201);

  const grantRead = await policyAdminService.createGrant({
    requestId: 'req_grant_read',
    tenantId,
    actorWallet: adminWallet,
    grant: {
      walletAddress: managerWallet,
      scopeType: 'table',
      scopeId: 'inventory',
      operation: 'read',
      effect: 'allow'
    }
  });
  assert.equal(grantRead.statusCode, 201);

  const grantInsert = await policyAdminService.createGrant({
    requestId: 'req_grant_insert',
    tenantId,
    actorWallet: adminWallet,
    grant: {
      walletAddress: managerWallet,
      scopeType: 'table',
      scopeId: 'inventory',
      operation: 'insert',
      effect: 'allow'
    }
  });
  assert.equal(grantInsert.statusCode, 201);

  const grantUpdate = await policyAdminService.createGrant({
    requestId: 'req_grant_update',
    tenantId,
    actorWallet: adminWallet,
    grant: {
      walletAddress: managerWallet,
      scopeType: 'table',
      scopeId: 'inventory',
      operation: 'update',
      effect: 'allow'
    }
  });
  assert.equal(grantUpdate.statusCode, 201);
}

test('data operation templates execute read/insert/update and deny delete by policy', async () => {
  await withDataOperationContext(async ({
    migrationRunner,
    policyAdminService,
    dataOperationService
  }) => {
    const migrationResult = await migrationRunner.applyMigrationPlan({
      tenantId,
      requestId: 'req_apply_inventory',
      migrationPlan: inventoryPlan()
    });
    assert.equal(migrationResult.ok, true);

    await bootstrapAndGrantManager(policyAdminService);

    const insertResult = await dataOperationService.execute({
      tenantId,
      actorWallet: managerWallet,
      operation: 'insert',
      tableName: 'inventory',
      values: {
        item_id: 'item-1',
        quantity: 4
      }
    });
    assert.equal(insertResult.statusCode, 200);
    assert.equal(insertResult.body.rowCount, 1);

    const readResult = await dataOperationService.execute({
      tenantId,
      actorWallet: managerWallet,
      operation: 'read',
      tableName: 'inventory',
      filters: {
        item_id: 'item-1'
      }
    });
    assert.equal(readResult.statusCode, 200);
    assert.equal(readResult.body.rowCount, 1);
    assert.equal(readResult.body.rows[0].quantity, 4);

    const updateResult = await dataOperationService.execute({
      tenantId,
      actorWallet: managerWallet,
      operation: 'update',
      tableName: 'inventory',
      values: {
        quantity: 9
      },
      filters: {
        item_id: 'item-1'
      }
    });
    assert.equal(updateResult.statusCode, 200);
    assert.equal(updateResult.body.rowCount, 1);

    const deleteDenied = await dataOperationService.execute({
      tenantId,
      actorWallet: managerWallet,
      operation: 'delete',
      tableName: 'inventory',
      filters: {
        item_id: 'item-1'
      }
    });
    assert.equal(deleteDenied.statusCode, 403);
    assert.equal(deleteDenied.body.error, 'POLICY_DENIED');
  });
});

test('data operation service rejects raw sql input and unmanaged tables', async () => {
  await withDataOperationContext(async ({ dataOperationService }) => {
    const rawSqlResult = await dataOperationService.execute({
      tenantId,
      actorWallet: managerWallet,
      operation: 'read',
      tableName: 'inventory',
      sql: 'SELECT * FROM inventory'
    });
    assert.equal(rawSqlResult.statusCode, 400);
    assert.equal(rawSqlResult.body.error, 'RAW_SQL_NOT_ALLOWED');

    const unmanagedTableResult = await dataOperationService.execute({
      tenantId,
      actorWallet: managerWallet,
      operation: 'read',
      tableName: 'not_managed'
    });
    assert.equal(unmanagedTableResult.statusCode, 404);
    assert.equal(unmanagedTableResult.body.error, 'TABLE_NOT_MANAGED');
  });
});
