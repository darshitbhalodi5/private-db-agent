import { loadConfig } from '../config.js';
import { createDatabaseAdapter } from '../db/databaseAdapterFactory.js';
import { createMigrationRunnerService } from './migrationRunnerService.js';
import { validateAndCompileSchemaDsl } from './schemaDslService.js';

const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

function normalizeTenantId(rawTenantId) {
  if (typeof rawTenantId !== 'string' || rawTenantId.trim().length === 0) {
    return null;
  }

  const normalized = rawTenantId.trim().toLowerCase();
  if (!TENANT_ID_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

function containsRawSqlInput(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }

  if (typeof payload.sql === 'string' || typeof payload.rawSql === 'string') {
    return true;
  }

  return false;
}

export function createSchemaApplyService({ migrationRunnerService }) {
  if (!migrationRunnerService) {
    throw new Error('migrationRunnerService is required.');
  }

  async function apply(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {
        statusCode: 400,
        body: {
          error: 'VALIDATION_ERROR',
          message: 'Request body must be a JSON object.'
        }
      };
    }

    if (containsRawSqlInput(payload)) {
      return {
        statusCode: 400,
        body: {
          error: 'RAW_SQL_NOT_ALLOWED',
          message: 'Direct SQL input is not allowed. Use schema DSL fields only.'
        }
      };
    }

    const tenantId = normalizeTenantId(payload.tenantId);
    if (!tenantId) {
      return {
        statusCode: 400,
        body: {
          error: 'VALIDATION_ERROR',
          message: 'tenantId is required and must match [a-z0-9][a-z0-9_-]{0,62}.'
        }
      };
    }

    const schemaDslResult = validateAndCompileSchemaDsl(payload);
    if (!schemaDslResult.ok) {
      return {
        statusCode: 400,
        body: schemaDslResult.error
      };
    }

    const migrationApply = await migrationRunnerService.applyMigrationPlan({
      tenantId,
      requestId: schemaDslResult.normalizedDsl.requestId,
      migrationPlan: schemaDslResult.migrationPlan
    });

    if (!migrationApply.ok) {
      return {
        statusCode: 500,
        body: migrationApply.error
      };
    }

    return {
      statusCode: 201,
      body: {
        code: 'SCHEMA_APPLIED',
        message: 'Schema DSL validated and migration plan applied transactionally.',
        schema: schemaDslResult.schema,
        migrationPlan: schemaDslResult.migrationPlan,
        migration: migrationApply.data
      }
    };
  }

  return {
    apply
  };
}

const runtimeConfig = loadConfig();
let runtimeSchemaApplyServicePromise = null;

async function buildRuntimeSchemaApplyService() {
  const databaseAdapter = await createDatabaseAdapter(runtimeConfig.database);
  const migrationRunnerService = createMigrationRunnerService({ databaseAdapter });

  return createSchemaApplyService({
    migrationRunnerService
  });
}

async function getRuntimeSchemaApplyService() {
  if (!runtimeSchemaApplyServicePromise) {
    runtimeSchemaApplyServicePromise = buildRuntimeSchemaApplyService().catch((error) => {
      runtimeSchemaApplyServicePromise = null;
      throw error;
    });
  }

  return runtimeSchemaApplyServicePromise;
}

export async function handleSchemaApplyRequest(payload, overrides = null) {
  try {
    const service = overrides?.schemaApplyService || (await getRuntimeSchemaApplyService());
    return service.apply(payload);
  } catch (error) {
    return {
      statusCode: 503,
      body: {
        error: 'SERVICE_UNAVAILABLE',
        message: error?.message || 'Schema apply service failed to initialize.'
      }
    };
  }
}
