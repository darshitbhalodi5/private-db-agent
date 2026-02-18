import { randomUUID } from 'node:crypto';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function createPlaceholders(dialect, count, offset = 0) {
  if (dialect === 'postgres') {
    return Array.from({ length: count }, (_, index) => `$${index + 1 + offset}`);
  }

  return Array.from({ length: count }, () => '?');
}

function validateMigrationPlan(migrationPlan) {
  const issues = [];

  if (!migrationPlan || typeof migrationPlan !== 'object' || Array.isArray(migrationPlan)) {
    issues.push({
      path: 'migrationPlan',
      code: 'required',
      message: 'migrationPlan must be an object.'
    });
    return {
      ok: false,
      issues
    };
  }

  if (!Array.isArray(migrationPlan.steps) || migrationPlan.steps.length === 0) {
    issues.push({
      path: 'migrationPlan.steps',
      code: 'required',
      message: 'migrationPlan.steps must be a non-empty array.'
    });
  } else {
    migrationPlan.steps.forEach((step, index) => {
      if (!step || typeof step !== 'object' || Array.isArray(step)) {
        issues.push({
          path: `migrationPlan.steps[${index}]`,
          code: 'invalid_step',
          message: 'Each migration step must be an object.'
        });
        return;
      }

      if (!isNonEmptyString(step.action)) {
        issues.push({
          path: `migrationPlan.steps[${index}].action`,
          code: 'required',
          message: 'step.action is required.'
        });
      }

      if (step.action === 'create_table' && !isNonEmptyString(step.sql)) {
        issues.push({
          path: `migrationPlan.steps[${index}].sql`,
          code: 'required',
          message: 'create_table step must include sql.'
        });
      }
    });
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

async function ensureMetadataTables(executor, dialect) {
  await executor.execute({
    mode: 'write',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migration_history (
        migration_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        plan_hash TEXT NOT NULL,
        step_count INTEGER NOT NULL,
        status TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `,
    values: []
  });

  await executor.execute({
    mode: 'write',
    sql: `
      CREATE TABLE IF NOT EXISTS managed_tables (
        tenant_id TEXT NOT NULL,
        table_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, table_name)
      )
    `,
    values: []
  });

  await executor.execute({
    mode: 'write',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_managed_tables_lookup
      ON managed_tables (tenant_id, table_name)
    `,
    values: []
  });

  if (dialect === 'postgres') {
    await executor.execute({
      mode: 'write',
      sql: `
        CREATE INDEX IF NOT EXISTS idx_schema_migration_history_lookup
        ON schema_migration_history (tenant_id, request_id, applied_at DESC)
      `,
      values: []
    });
  }
}

async function insertManagedTable(executor, dialect, { tenantId, tableName, createdAt }) {
  const placeholders = createPlaceholders(dialect, 3);

  if (dialect === 'sqlite') {
    await executor.execute({
      mode: 'write',
      sql: `
        INSERT OR IGNORE INTO managed_tables (tenant_id, table_name, created_at)
        VALUES (${placeholders.join(', ')})
      `,
      values: [tenantId, tableName, createdAt]
    });
    return;
  }

  await executor.execute({
    mode: 'write',
    sql: `
      INSERT INTO managed_tables (tenant_id, table_name, created_at)
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (tenant_id, table_name) DO NOTHING
    `,
    values: [tenantId, tableName, createdAt]
  });
}

async function insertMigrationHistory(
  executor,
  dialect,
  { migrationId, tenantId, requestId, planHash, stepCount, status, appliedAt }
) {
  const placeholders = createPlaceholders(dialect, 7);

  await executor.execute({
    mode: 'write',
    sql: `
      INSERT INTO schema_migration_history (
        migration_id,
        tenant_id,
        request_id,
        plan_hash,
        step_count,
        status,
        applied_at
      )
      VALUES (${placeholders.join(', ')})
    `,
    values: [migrationId, tenantId, requestId, planHash, stepCount, status, appliedAt]
  });
}

function extractManagedTables(migrationPlan) {
  return (migrationPlan.steps || [])
    .filter((step) => step.action === 'create_table' && isNonEmptyString(step?.metadata?.tableName))
    .map((step) => step.metadata.tableName);
}

export function createMigrationRunnerService({
  databaseAdapter,
  now = () => new Date().toISOString()
}) {
  if (!databaseAdapter || typeof databaseAdapter.execute !== 'function') {
    throw new Error('databaseAdapter is required for migration runner.');
  }

  if (typeof databaseAdapter.runInTransaction !== 'function') {
    throw new Error('databaseAdapter must support runInTransaction for migration runner.');
  }

  async function applyMigrationPlan({ tenantId, requestId, migrationPlan }) {
    if (!isNonEmptyString(tenantId) || !isNonEmptyString(requestId)) {
      return {
        ok: false,
        error: {
          error: 'INVALID_MIGRATION_REQUEST',
          message: 'tenantId and requestId are required.'
        }
      };
    }

    const validation = validateMigrationPlan(migrationPlan);
    if (!validation.ok) {
      return {
        ok: false,
        error: {
          error: 'INVALID_MIGRATION_PLAN',
          message: 'Migration plan validation failed.',
          details: {
            issues: validation.issues
          }
        }
      };
    }

    const safeTenantId = tenantId.trim().toLowerCase();
    const safeRequestId = requestId.trim();
    const migrationId = randomUUID();
    const appliedAt = now();
    const managedTables = extractManagedTables(migrationPlan);
    const migrationSteps = migrationPlan.steps || [];

    try {
      await databaseAdapter.runInTransaction(async (executor) => {
        await ensureMetadataTables(executor, databaseAdapter.dialect);

        for (const step of migrationSteps) {
          if (step.action === 'ensure_database') {
            continue;
          }

          if (step.action === 'create_table') {
            await executor.execute({
              mode: 'write',
              sql: step.sql,
              values: []
            });
            continue;
          }

          throw new Error(`Unsupported migration step action '${step.action}'.`);
        }

        for (const tableName of managedTables) {
          await insertManagedTable(executor, databaseAdapter.dialect, {
            tenantId: safeTenantId,
            tableName,
            createdAt: appliedAt
          });
        }

        await insertMigrationHistory(executor, databaseAdapter.dialect, {
          migrationId,
          tenantId: safeTenantId,
          requestId: safeRequestId,
          planHash: migrationPlan.planHash || 'unknown-plan-hash',
          stepCount: migrationSteps.length,
          status: 'applied',
          appliedAt
        });
      });
    } catch (error) {
      return {
        ok: false,
        error: {
          error: 'MIGRATION_APPLY_FAILED',
          message: error?.message || 'Migration apply failed.'
        }
      };
    }

    return {
      ok: true,
      data: {
        migrationId,
        tenantId: safeTenantId,
        requestId: safeRequestId,
        planHash: migrationPlan.planHash || 'unknown-plan-hash',
        stepCount: migrationSteps.length,
        appliedAt,
        managedTables
      }
    };
  }

  return {
    applyMigrationPlan
  };
}
