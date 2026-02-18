import { loadConfig } from '../config.js';
import { createDatabaseAdapter } from '../db/databaseAdapterFactory.js';
import { createActionAuthorizationService } from './actionAuthorizationService.js';
import { createPolicyGrantStore } from './policyGrantStore.js';
import { createPolicyMutationAuthService } from './policyMutationAuthService.js';
import {
  createPermissiveRuntimeAttestationService,
  createRuntimeAttestationService
} from './runtimeAttestationService.js';

const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
const WALLET_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const DATA_OPERATIONS = Object.freeze(['read', 'insert', 'update', 'delete']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTenantId(rawTenantId) {
  if (typeof rawTenantId !== 'string' || rawTenantId.trim().length === 0) {
    return null;
  }

  const normalized = rawTenantId.trim().toLowerCase();
  return TENANT_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeWalletAddress(rawWalletAddress) {
  if (typeof rawWalletAddress !== 'string' || rawWalletAddress.trim().length === 0) {
    return null;
  }

  const normalized = rawWalletAddress.trim().toLowerCase();
  return WALLET_ADDRESS_PATTERN.test(normalized) ? normalized : null;
}

function normalizeIdentifier(rawValue) {
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    return null;
  }

  const normalized = rawValue.trim().toLowerCase();
  return IDENTIFIER_PATTERN.test(normalized) ? normalized : null;
}

function isPrimitiveValue(value) {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function buildPlaceholders(dialect, count, offset = 0) {
  if (dialect === 'postgres') {
    return Array.from({ length: count }, (_, index) => `$${index + 1 + offset}`);
  }

  return Array.from({ length: count }, () => '?');
}

function quoteIdentifier(identifier) {
  return `"${identifier}"`;
}

function validateBasePayload(payload) {
  if (!isObject(payload)) {
    return {
      ok: false,
      statusCode: 400,
      error: 'VALIDATION_ERROR',
      message: 'Request body must be a JSON object.'
    };
  }

  if (typeof payload.sql === 'string' || typeof payload.rawSql === 'string') {
    return {
      ok: false,
      statusCode: 400,
      error: 'RAW_SQL_NOT_ALLOWED',
      message: 'Direct SQL input is not allowed.'
    };
  }

  const tenantId = normalizeTenantId(payload.tenantId);
  if (!tenantId) {
    return {
      ok: false,
      statusCode: 400,
      error: 'VALIDATION_ERROR',
      message: 'tenantId is required and must match [a-z0-9][a-z0-9_-]{0,62}.'
    };
  }

  const actorWallet = normalizeWalletAddress(payload.actorWallet);
  if (!actorWallet) {
    return {
      ok: false,
      statusCode: 400,
      error: 'VALIDATION_ERROR',
      message: 'actorWallet must be a valid EVM wallet address.'
    };
  }

  const operation = String(payload.operation || '').trim().toLowerCase();
  if (!DATA_OPERATIONS.includes(operation)) {
    return {
      ok: false,
      statusCode: 400,
      error: 'VALIDATION_ERROR',
      message: `operation must be one of: ${DATA_OPERATIONS.join(', ')}.`
    };
  }

  const tableName = normalizeIdentifier(payload.tableName);
  if (!tableName) {
    return {
      ok: false,
      statusCode: 400,
      error: 'VALIDATION_ERROR',
      message: 'tableName is required and must match [a-z][a-z0-9_]{0,62}.'
    };
  }

  return {
    ok: true,
    normalized: {
      tenantId,
      actorWallet,
      operation,
      tableName
    }
  };
}

function normalizeObjectMap(rawValue, pathLabel) {
  if (!isObject(rawValue)) {
    return {
      ok: false,
      message: `${pathLabel} must be a JSON object.`
    };
  }

  const entries = Object.entries(rawValue);
  if (entries.length === 0) {
    return {
      ok: false,
      message: `${pathLabel} must not be empty.`
    };
  }

  const normalized = [];

  for (const [key, value] of entries) {
    const normalizedKey = normalizeIdentifier(key);
    if (!normalizedKey) {
      return {
        ok: false,
        message: `${pathLabel} contains invalid column name '${key}'.`
      };
    }

    if (!isPrimitiveValue(value)) {
      return {
        ok: false,
        message: `${pathLabel}.${key} must be primitive (string/number/boolean/null).`
      };
    }

    normalized.push([normalizedKey, value]);
  }

  normalized.sort((left, right) => left[0].localeCompare(right[0], 'en'));

  return {
    ok: true,
    entries: normalized
  };
}

function buildWhereClause({ dialect, filters = [], startingIndex = 1 }) {
  const clauses = [];
  const values = [];
  let offset = startingIndex;

  for (const [column, value] of filters) {
    if (value === null) {
      clauses.push(`${quoteIdentifier(column)} IS NULL`);
      continue;
    }

    const [placeholder] = buildPlaceholders(dialect, 1, offset - 1);
    clauses.push(`${quoteIdentifier(column)} = ${placeholder}`);
    values.push(value);
    offset += 1;
  }

  return {
    whereSql: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '',
    values,
    nextOffset: offset
  };
}

export function createDataOperationService({
  databaseAdapter,
  grantStore,
  actionAuthorizationService,
  runtimeAttestationService = createPermissiveRuntimeAttestationService()
}) {
  if (!databaseAdapter || typeof databaseAdapter.execute !== 'function') {
    throw new Error('databaseAdapter is required for data operation service.');
  }

  if (!grantStore) {
    throw new Error('grantStore is required for data operation service.');
  }

  if (!actionAuthorizationService) {
    throw new Error('actionAuthorizationService is required for data operation service.');
  }

  async function ensureManagedTable({ tenantId, tableName }) {
    try {
      const placeholders = buildPlaceholders(databaseAdapter.dialect, 2);
      const lookupSql =
        databaseAdapter.dialect === 'sqlite'
          ? `
              SELECT table_name
              FROM managed_tables
              WHERE tenant_id = ${placeholders[0]} AND table_name = ${placeholders[1]}
              LIMIT 1
            `
          : `
              SELECT table_name
              FROM managed_tables
              WHERE tenant_id = ${placeholders[0]} AND table_name = ${placeholders[1]}
              LIMIT 1
            `;

      const result = await databaseAdapter.execute({
        mode: 'read',
        sql: lookupSql,
        values: [tenantId, tableName]
      });

      return (result.rows || []).length > 0;
    } catch (error) {
      if (databaseAdapter.dialect === 'sqlite' && /no such table/i.test(error?.message || '')) {
        return false;
      }

      throw error;
    }
  }

  async function execute(payload) {
    const baseValidation = validateBasePayload(payload);
    if (!baseValidation.ok) {
      return {
        statusCode: baseValidation.statusCode,
        body: {
          error: baseValidation.error,
          message: baseValidation.message
        }
      };
    }

    const { tenantId, actorWallet, operation, tableName } = baseValidation.normalized;

    const requestId =
      typeof payload.requestId === 'string' && payload.requestId.trim().length > 0
        ? payload.requestId.trim()
        : null;
    if (!requestId) {
      return {
        statusCode: 400,
        body: {
          error: 'VALIDATION_ERROR',
          message: 'requestId is required.'
        }
      };
    }

    const runtimeCheck = await runtimeAttestationService.checkAccess({
      action: `data:${operation}`,
      sensitive: operation !== 'read'
    });
    if (!runtimeCheck.allowed) {
      return {
        statusCode: runtimeCheck.statusCode || 503,
        body: {
          error: runtimeCheck.code || 'RUNTIME_VERIFICATION_FAILED',
          message:
            runtimeCheck.message ||
            'Sensitive operation denied because runtime verification failed.',
          runtime: runtimeCheck.snapshot || null
        }
      };
    }

    const managed = await ensureManagedTable({ tenantId, tableName });
    if (!managed) {
      return {
        statusCode: 404,
        body: {
          error: 'TABLE_NOT_MANAGED',
          message: `Table '${tableName}' is not registered for tenant '${tenantId}'.`
        }
      };
    }

    const authorizationResult = await actionAuthorizationService.authorize({
      requestId,
      tenantId,
      actorWallet,
      auth: payload.auth,
      action: 'data:execute',
      actionPayload: {
        tableName,
        operation,
        values: payload.values || null,
        filters: payload.filters || null,
        columns: payload.columns || null,
        limit: payload.limit || null,
        agentOverride: payload.agentOverride || null,
        bypassPolicy: payload.bypassPolicy || null,
        skipAuth: payload.skipAuth || null,
        executeAsAgent: payload.executeAsAgent || null,
        superuser: payload.superuser || null,
        trustedOperator: payload.trustedOperator || null
      },
      scopeType: 'table',
      scopeId: tableName,
      operation,
    });
    if (!authorizationResult.ok) {
      return {
        statusCode: authorizationResult.statusCode,
        body: authorizationResult.body
      };
    }

    if (operation === 'read') {
      const limit = payload.limit === undefined ? 100 : Number.parseInt(String(payload.limit), 10);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        return {
          statusCode: 400,
          body: {
            error: 'VALIDATION_ERROR',
            message: 'limit must be an integer between 1 and 500.'
          }
        };
      }

      let selectColumns = '*';
      if (Array.isArray(payload.columns) && payload.columns.length > 0) {
        const normalizedColumns = [];
        for (const column of payload.columns) {
          const normalizedColumn = normalizeIdentifier(column);
          if (!normalizedColumn) {
            return {
              statusCode: 400,
              body: {
                error: 'VALIDATION_ERROR',
                message: `Invalid column '${column}' in columns.`
              }
            };
          }
          normalizedColumns.push(quoteIdentifier(normalizedColumn));
        }
        selectColumns = normalizedColumns.join(', ');
      }

      const filtersResult = payload.filters
        ? normalizeObjectMap(payload.filters, 'filters')
        : { ok: true, entries: [] };
      if (!filtersResult.ok) {
        return {
          statusCode: 400,
          body: {
            error: 'VALIDATION_ERROR',
            message: filtersResult.message
          }
        };
      }

      const where = buildWhereClause({
        dialect: databaseAdapter.dialect,
        filters: filtersResult.entries
      });
      const [limitPlaceholder] = buildPlaceholders(databaseAdapter.dialect, 1, where.nextOffset - 1);

      const sql = `SELECT ${selectColumns} FROM ${quoteIdentifier(tableName)}${where.whereSql} LIMIT ${limitPlaceholder}`;
      const values = [...where.values, limit];
      const result = await databaseAdapter.execute({
        mode: 'read',
        sql,
        values
      });

      return {
        statusCode: 200,
        body: {
          code: 'DATA_OPERATION_EXECUTED',
          operation,
          tableName,
          rowCount: result.rowCount,
          rows: result.rows,
          authorization: {
            actorWallet: authorizationResult.actorWallet,
            decision: authorizationResult.decision,
            signatureHash: authorizationResult.signatureHash
          },
          runtime: runtimeCheck.snapshot || null
        }
      };
    }

    if (operation === 'insert') {
      const valuesResult = normalizeObjectMap(payload.values, 'values');
      if (!valuesResult.ok) {
        return {
          statusCode: 400,
          body: {
            error: 'VALIDATION_ERROR',
            message: valuesResult.message
          }
        };
      }

      const columns = valuesResult.entries.map(([column]) => quoteIdentifier(column));
      const insertValues = valuesResult.entries.map(([, value]) => value);
      const placeholders = buildPlaceholders(databaseAdapter.dialect, insertValues.length);

      const sql = `INSERT INTO ${quoteIdentifier(tableName)} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;
      const result = await databaseAdapter.execute({
        mode: 'write',
        sql,
        values: insertValues
      });

      return {
        statusCode: 200,
        body: {
          code: 'DATA_OPERATION_EXECUTED',
          operation,
          tableName,
          rowCount: result.rowCount,
          rows: [],
          authorization: {
            actorWallet: authorizationResult.actorWallet,
            decision: authorizationResult.decision,
            signatureHash: authorizationResult.signatureHash
          },
          runtime: runtimeCheck.snapshot || null
        }
      };
    }

    if (operation === 'update') {
      const valuesResult = normalizeObjectMap(payload.values, 'values');
      if (!valuesResult.ok) {
        return {
          statusCode: 400,
          body: {
            error: 'VALIDATION_ERROR',
            message: valuesResult.message
          }
        };
      }

      const filtersResult = normalizeObjectMap(payload.filters, 'filters');
      if (!filtersResult.ok) {
        return {
          statusCode: 400,
          body: {
            error: 'VALIDATION_ERROR',
            message: filtersResult.message
          }
        };
      }

      const setPlaceholders = buildPlaceholders(databaseAdapter.dialect, valuesResult.entries.length);
      const setSql = valuesResult.entries
        .map(([column], index) => `${quoteIdentifier(column)} = ${setPlaceholders[index]}`)
        .join(', ');
      const setValues = valuesResult.entries.map(([, value]) => value);

      const where = buildWhereClause({
        dialect: databaseAdapter.dialect,
        filters: filtersResult.entries,
        startingIndex: setValues.length + 1
      });

      const sql = `UPDATE ${quoteIdentifier(tableName)} SET ${setSql}${where.whereSql}`;
      const result = await databaseAdapter.execute({
        mode: 'write',
        sql,
        values: [...setValues, ...where.values]
      });

      return {
        statusCode: 200,
        body: {
          code: 'DATA_OPERATION_EXECUTED',
          operation,
          tableName,
          rowCount: result.rowCount,
          rows: [],
          authorization: {
            actorWallet: authorizationResult.actorWallet,
            decision: authorizationResult.decision,
            signatureHash: authorizationResult.signatureHash
          },
          runtime: runtimeCheck.snapshot || null
        }
      };
    }

    const filtersResult = normalizeObjectMap(payload.filters, 'filters');
    if (!filtersResult.ok) {
      return {
        statusCode: 400,
        body: {
          error: 'VALIDATION_ERROR',
          message: filtersResult.message
        }
      };
    }

    const where = buildWhereClause({
      dialect: databaseAdapter.dialect,
      filters: filtersResult.entries
    });

    const sql = `DELETE FROM ${quoteIdentifier(tableName)}${where.whereSql}`;
    const result = await databaseAdapter.execute({
      mode: 'write',
      sql,
      values: where.values
    });

    return {
      statusCode: 200,
      body: {
        code: 'DATA_OPERATION_EXECUTED',
        operation,
        tableName,
        rowCount: result.rowCount,
        rows: [],
        authorization: {
          actorWallet: authorizationResult.actorWallet,
          decision: authorizationResult.decision,
          signatureHash: authorizationResult.signatureHash
        },
        runtime: runtimeCheck.snapshot || null
      }
    };
  }

  return {
    execute
  };
}

const runtimeConfig = loadConfig();
let runtimeDataOperationServicePromise = null;

async function buildRuntimeDataOperationService() {
  const databaseAdapter = await createDatabaseAdapter(runtimeConfig.database);
  const grantStore = createPolicyGrantStore({ databaseAdapter });
  await grantStore.ensureInitialized();
  const mutationAuthService = createPolicyMutationAuthService({
    ...runtimeConfig.auth,
    enabled: true
  });
  const runtimeAttestationService = createRuntimeAttestationService(runtimeConfig.proof);

  return createDataOperationService({
    databaseAdapter,
    grantStore,
    actionAuthorizationService: createActionAuthorizationService({
      grantStore,
      mutationAuthService
    }),
    runtimeAttestationService
  });
}

async function getRuntimeDataOperationService() {
  if (!runtimeDataOperationServicePromise) {
    runtimeDataOperationServicePromise = buildRuntimeDataOperationService().catch((error) => {
      runtimeDataOperationServicePromise = null;
      throw error;
    });
  }

  return runtimeDataOperationServicePromise;
}

export async function handleDataOperationRequest(payload, overrides = null) {
  try {
    const service = overrides?.dataOperationService || (await getRuntimeDataOperationService());
    return service.execute(payload);
  } catch (error) {
    return {
      statusCode: 503,
      body: {
        error: 'SERVICE_UNAVAILABLE',
        message: error?.message || 'Data operation service failed to initialize.'
      }
    };
  }
}
