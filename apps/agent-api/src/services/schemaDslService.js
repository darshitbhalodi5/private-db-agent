import { createHash } from 'node:crypto';
import {
  DATABASE_ENGINES,
  FIELD_TYPES,
  IDENTIFIER_PATTERN,
  RESERVED_IDENTIFIERS,
  SCHEMA_DSL_SCHEMA_ID,
  SCHEMA_DSL_VERSION,
  WALLET_ADDRESS_PATTERN
} from '@eigen-private-db-agent/shared-types';

const identifierRegex = new RegExp(IDENTIFIER_PATTERN);
const walletRegex = new RegExp(WALLET_ADDRESS_PATTERN);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function addIssue(issues, path, code, message, value = undefined) {
  issues.push({
    path,
    code,
    message,
    ...(value === undefined ? {} : { value })
  });
}

function normalizeIdentifier(rawValue, path, issues) {
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    addIssue(issues, path, 'required', 'Value is required and must be a non-empty string.', rawValue);
    return null;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (!identifierRegex.test(normalized)) {
    addIssue(
      issues,
      path,
      'invalid_identifier',
      `Identifier must match pattern ${IDENTIFIER_PATTERN}.`,
      rawValue
    );
    return null;
  }

  if (RESERVED_IDENTIFIERS.includes(normalized)) {
    addIssue(issues, path, 'forbidden_identifier', 'Identifier uses a reserved SQL keyword.', rawValue);
    return null;
  }

  return normalized;
}

function normalizeWalletAddress(rawValue, path, issues) {
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    addIssue(issues, path, 'required', 'Wallet address is required.', rawValue);
    return null;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (!walletRegex.test(normalized)) {
    addIssue(issues, path, 'invalid_wallet_address', 'Wallet address must be a 20-byte hex address.', rawValue);
    return null;
  }

  return normalized;
}

function normalizeDatabase(payload, issues) {
  if (!isObject(payload.database)) {
    addIssue(issues, 'database', 'required', 'database must be an object.', payload.database);
    return null;
  }

  const databaseName = normalizeIdentifier(payload.database.name, 'database.name', issues);

  const engine = typeof payload.database.engine === 'string' ? payload.database.engine.trim().toLowerCase() : '';
  if (!DATABASE_ENGINES.includes(engine)) {
    addIssue(
      issues,
      'database.engine',
      'unsupported_engine',
      `database.engine must be one of: ${DATABASE_ENGINES.join(', ')}.`,
      payload.database.engine
    );
  }

  const description =
    payload.database.description === undefined || payload.database.description === null
      ? null
      : String(payload.database.description).trim();

  if (!databaseName || !DATABASE_ENGINES.includes(engine)) {
    return null;
  }

  return {
    name: databaseName,
    engine,
    description: description && description.length > 0 ? description : null
  };
}

function normalizeField(field, tableIndex, fieldIndex, issues) {
  const basePath = `tables[${tableIndex}].fields[${fieldIndex}]`;

  if (!isObject(field)) {
    addIssue(issues, basePath, 'invalid_type', 'Field definition must be an object.', field);
    return null;
  }

  const name = normalizeIdentifier(field.name, `${basePath}.name`, issues);

  const type = typeof field.type === 'string' ? field.type.trim().toLowerCase() : '';
  if (!FIELD_TYPES.includes(type)) {
    addIssue(
      issues,
      `${basePath}.type`,
      'unsupported_field_type',
      `Field type must be one of: ${FIELD_TYPES.join(', ')}.`,
      field.type
    );
  }

  const primaryKey = Boolean(field.primaryKey);
  const nullable = field.nullable === undefined ? !primaryKey : Boolean(field.nullable);

  if (primaryKey && nullable) {
    addIssue(
      issues,
      basePath,
      'invalid_constraint',
      'Primary key field cannot be nullable.',
      {
        nullable,
        primaryKey
      }
    );
  }

  if (!name || !FIELD_TYPES.includes(type)) {
    return null;
  }

  return {
    name,
    type,
    nullable,
    primaryKey,
    position: fieldIndex
  };
}

function normalizeTables(payload, issues) {
  if (!Array.isArray(payload.tables) || payload.tables.length === 0) {
    addIssue(issues, 'tables', 'required', 'tables must be a non-empty array.', payload.tables);
    return [];
  }

  const normalizedTables = [];

  payload.tables.forEach((table, tableIndex) => {
    const tablePath = `tables[${tableIndex}]`;

    if (!isObject(table)) {
      addIssue(issues, tablePath, 'invalid_type', 'Table definition must be an object.', table);
      return;
    }

    const tableName = normalizeIdentifier(table.name, `${tablePath}.name`, issues);

    if (!Array.isArray(table.fields) || table.fields.length === 0) {
      addIssue(
        issues,
        `${tablePath}.fields`,
        'required',
        'Table fields must be a non-empty array.',
        table.fields
      );
      return;
    }

    const normalizedFields = table.fields
      .map((field, fieldIndex) => normalizeField(field, tableIndex, fieldIndex, issues))
      .filter(Boolean);

    if (!tableName || normalizedFields.length === 0) {
      return;
    }

    const fieldNameSet = new Set();
    normalizedFields.forEach((field) => {
      if (fieldNameSet.has(field.name)) {
        addIssue(
          issues,
          `${tablePath}.fields`,
          'duplicate_field_name',
          `Duplicate field name '${field.name}' in table '${tableName}'.`
        );
        return;
      }

      fieldNameSet.add(field.name);
    });

    const primaryKeyCount = normalizedFields.filter((field) => field.primaryKey).length;
    if (primaryKeyCount > 1) {
      addIssue(
        issues,
        `${tablePath}.fields`,
        'composite_primary_key_not_supported',
        'Multiple primary key fields are not supported in this milestone.'
      );
    }

    normalizedTables.push({
      name: tableName,
      fields: normalizedFields,
      sourceOrder: tableIndex
    });
  });

  const tableNameSet = new Set();
  normalizedTables.forEach((table) => {
    if (tableNameSet.has(table.name)) {
      addIssue(
        issues,
        'tables',
        'duplicate_table_name',
        `Duplicate table name '${table.name}' is not allowed.`
      );
      return;
    }

    tableNameSet.add(table.name);
  });

  return normalizedTables;
}

function sqlTypeForField(engine, fieldType) {
  if (engine === 'postgres') {
    const postgresMap = {
      text: 'TEXT',
      integer: 'INTEGER',
      numeric: 'NUMERIC',
      boolean: 'BOOLEAN',
      timestamp: 'TIMESTAMPTZ',
      jsonb: 'JSONB'
    };

    return postgresMap[fieldType];
  }

  const sqliteMap = {
    text: 'TEXT',
    integer: 'INTEGER',
    numeric: 'NUMERIC',
    boolean: 'INTEGER',
    timestamp: 'TEXT',
    jsonb: 'TEXT'
  };

  return sqliteMap[fieldType];
}

function compileCreateTableSql(engine, table) {
  const columnLines = table.fields
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((field) => {
      const parts = [`"${field.name}"`, sqlTypeForField(engine, field.type)];

      if (field.primaryKey) {
        parts.push('PRIMARY KEY');
      }

      if (!field.nullable || field.primaryKey) {
        parts.push('NOT NULL');
      }

      return `  ${parts.join(' ')}`;
    });

  return `CREATE TABLE IF NOT EXISTS "${table.name}" (\n${columnLines.join(',\n')}\n);`;
}

function buildPlanHash(plan) {
  const payload = JSON.stringify(plan);
  return createHash('sha256').update(payload).digest('hex');
}

export function validateSchemaDsl(payload) {
  const issues = [];

  if (!isObject(payload)) {
    addIssue(issues, '$', 'invalid_type', 'Request body must be a JSON object.', payload);
    return {
      ok: false,
      issues,
      schema: {
        id: SCHEMA_DSL_SCHEMA_ID,
        version: SCHEMA_DSL_VERSION
      }
    };
  }

  if (typeof payload.requestId !== 'string' || payload.requestId.trim().length === 0) {
    addIssue(issues, 'requestId', 'required', 'requestId is required.', payload.requestId);
  }

  if (!isObject(payload.creator)) {
    addIssue(issues, 'creator', 'required', 'creator must be an object.', payload.creator);
  }

  const creatorWalletAddress = normalizeWalletAddress(
    payload?.creator?.walletAddress,
    'creator.walletAddress',
    issues
  );

  const database = normalizeDatabase(payload, issues);
  const tables = normalizeTables(payload, issues);

  if (issues.length > 0) {
    return {
      ok: false,
      issues,
      schema: {
        id: SCHEMA_DSL_SCHEMA_ID,
        version: SCHEMA_DSL_VERSION
      }
    };
  }

  return {
    ok: true,
    normalizedDsl: {
      requestId: payload.requestId.trim(),
      creator: {
        walletAddress: creatorWalletAddress,
        chainId: payload.creator.chainId ?? null
      },
      database,
      tables
    },
    schema: {
      id: SCHEMA_DSL_SCHEMA_ID,
      version: SCHEMA_DSL_VERSION
    }
  };
}

export function compileMigrationPlan(normalizedDsl) {
  const orderedTables = normalizedDsl.tables
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));

  let stepCounter = 0;
  const nextStepId = () => `step_${String(++stepCounter).padStart(3, '0')}`;

  const steps = [
    {
      stepId: nextStepId(),
      action: 'ensure_database',
      description: `Ensure ${normalizedDsl.database.engine} database '${normalizedDsl.database.name}' is available.`,
      metadata: {
        databaseName: normalizedDsl.database.name,
        engine: normalizedDsl.database.engine
      }
    }
  ];

  orderedTables.forEach((table) => {
    const orderedFields = table.fields
      .slice()
      .sort((left, right) => left.position - right.position)
      .map(({ position, ...field }) => field);

    steps.push({
      stepId: nextStepId(),
      action: 'create_table',
      description: `Create table '${table.name}' with ${orderedFields.length} field(s).`,
      metadata: {
        tableName: table.name,
        fields: orderedFields
      },
      sql: compileCreateTableSql(normalizedDsl.database.engine, table)
    });
  });

  const canonicalPlan = {
    schemaVersion: SCHEMA_DSL_VERSION,
    engine: normalizedDsl.database.engine,
    databaseName: normalizedDsl.database.name,
    deterministicOrder: 'table_name_asc+field_position_asc',
    steps
  };

  return {
    ...canonicalPlan,
    hashAlgorithm: 'sha256',
    planHash: buildPlanHash(canonicalPlan)
  };
}

export function validateAndCompileSchemaDsl(payload) {
  const validation = validateSchemaDsl(payload);

  if (!validation.ok) {
    return {
      ok: false,
      error: {
        error: 'SCHEMA_DSL_VALIDATION_FAILED',
        message: 'Schema DSL validation failed.',
        details: {
          schema: validation.schema,
          issues: validation.issues
        }
      }
    };
  }

  return {
    ok: true,
    schema: validation.schema,
    normalizedDsl: validation.normalizedDsl,
    migrationPlan: compileMigrationPlan(validation.normalizedDsl)
  };
}
