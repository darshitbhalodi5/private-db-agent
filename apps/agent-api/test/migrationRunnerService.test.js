import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSqliteAdapter } from '../src/db/adapters/sqliteAdapter.js';
import { createMigrationRunnerService } from '../src/services/migrationRunnerService.js';

async function withTempSqlite(testFn) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'private-db-agent-migration-'));
  const dbPath = path.join(tempDir, 'migration.sqlite');
  const adapter = await createSqliteAdapter({ filePath: dbPath });

  try {
    await testFn(adapter);
  } finally {
    await adapter.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function createPlan({ withInvalidStep = false } = {}) {
  const steps = [
    {
      stepId: 'step_001',
      action: 'ensure_database',
      description: 'Ensure database exists.'
    },
    {
      stepId: 'step_002',
      action: 'create_table',
      description: 'Create orders table.',
      metadata: {
        tableName: 'orders'
      },
      sql: `
        CREATE TABLE IF NOT EXISTS "orders" (
          "order_id" TEXT PRIMARY KEY NOT NULL,
          "amount" NUMERIC NOT NULL
        );
      `
    }
  ];

  if (withInvalidStep) {
    steps.push({
      stepId: 'step_003',
      action: 'create_table',
      description: 'Invalid SQL statement to trigger rollback.',
      metadata: {
        tableName: 'bad_table'
      },
      sql: 'CREATE TABL "bad_table" ("id" TEXT);'
    });
  }

  return {
    planHash: 'plan_hash_test',
    steps
  };
}

test('applies migration plan transactionally and records metadata', async () => {
  await withTempSqlite(async (adapter) => {
    const runner = createMigrationRunnerService({
      databaseAdapter: adapter,
      now: () => '2026-02-18T00:00:00.000Z'
    });

    const result = await runner.applyMigrationPlan({
      tenantId: 'tenant_demo',
      requestId: 'req_migration_ok',
      migrationPlan: createPlan()
    });

    assert.equal(result.ok, true);
    assert.equal(result.data.managedTables.includes('orders'), true);

    const managedTableLookup = await adapter.execute({
      mode: 'read',
      sql: 'SELECT table_name FROM managed_tables WHERE tenant_id = ? AND table_name = ?',
      values: ['tenant_demo', 'orders']
    });
    assert.equal(managedTableLookup.rows.length, 1);

    const historyLookup = await adapter.execute({
      mode: 'read',
      sql: 'SELECT request_id, status FROM schema_migration_history WHERE request_id = ?',
      values: ['req_migration_ok']
    });
    assert.equal(historyLookup.rows.length, 1);
    assert.equal(historyLookup.rows[0].status, 'applied');
  });
});

test('rolls back partial migration when one step fails', async () => {
  await withTempSqlite(async (adapter) => {
    const runner = createMigrationRunnerService({
      databaseAdapter: adapter,
      now: () => '2026-02-18T00:00:00.000Z'
    });

    const result = await runner.applyMigrationPlan({
      tenantId: 'tenant_demo',
      requestId: 'req_migration_fail',
      migrationPlan: createPlan({ withInvalidStep: true })
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.error, 'MIGRATION_APPLY_FAILED');

    const ordersLookup = await adapter.execute({
      mode: 'read',
      sql: `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
      `,
      values: ['orders']
    });
    assert.equal(ordersLookup.rows.length, 0);

    const historyTableLookup = await adapter.execute({
      mode: 'read',
      sql: `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
      `,
      values: ['schema_migration_history']
    });
    assert.equal(historyTableLookup.rows.length, 0);
  });
});
