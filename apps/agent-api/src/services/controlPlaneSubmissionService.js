import { randomUUID } from 'node:crypto';

function validationError(message, details = null) {
  return {
    statusCode: 400,
    body: {
      error: 'VALIDATION_ERROR',
      message,
      ...(details ? { details } : {})
    }
  };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function collectTableIssues(tables) {
  const issues = [];

  tables.forEach((table, tableIndex) => {
    if (!table || typeof table !== 'object' || Array.isArray(table)) {
      issues.push(`tables[${tableIndex}] must be an object.`);
      return;
    }

    if (!isNonEmptyString(table.name)) {
      issues.push(`tables[${tableIndex}].name is required.`);
    }

    if (!Array.isArray(table.fields) || table.fields.length === 0) {
      issues.push(`tables[${tableIndex}].fields must contain at least one field.`);
      return;
    }

    table.fields.forEach((field, fieldIndex) => {
      if (!field || typeof field !== 'object' || Array.isArray(field)) {
        issues.push(`tables[${tableIndex}].fields[${fieldIndex}] must be an object.`);
        return;
      }

      if (!isNonEmptyString(field.name)) {
        issues.push(`tables[${tableIndex}].fields[${fieldIndex}].name is required.`);
      }

      if (!isNonEmptyString(field.type)) {
        issues.push(`tables[${tableIndex}].fields[${fieldIndex}].type is required.`);
      }
    });
  });

  return issues;
}

export function handleControlPlaneSubmission(
  payload,
  {
    now = () => new Date().toISOString(),
    createSubmissionId = () => `sub_${randomUUID()}`
  } = {}
) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return validationError('Request body must be a JSON object.');
  }

  if (!isNonEmptyString(payload.requestId)) {
    return validationError('requestId is required.');
  }

  if (!isNonEmptyString(payload?.creator?.walletAddress)) {
    return validationError('creator.walletAddress is required.');
  }

  if (!isNonEmptyString(payload?.database?.name)) {
    return validationError('database.name is required.');
  }

  if (!Array.isArray(payload.tables) || payload.tables.length === 0) {
    return validationError('tables must contain at least one table.');
  }

  const tableIssues = collectTableIssues(payload.tables);
  if (tableIssues.length > 0) {
    return validationError('tables contain invalid entries.', {
      issues: tableIssues
    });
  }

  const grants = Array.isArray(payload.grants) ? payload.grants : [];

  return {
    statusCode: 202,
    body: {
      code: 'SCHEMA_REQUEST_ACCEPTED',
      message: 'Schema and policy payload accepted for orchestration.',
      submission: {
        submissionId: createSubmissionId(),
        requestId: payload.requestId.trim(),
        creatorWalletAddress: payload.creator.walletAddress.trim().toLowerCase(),
        databaseName: payload.database.name.trim(),
        tableCount: payload.tables.length,
        grantCount: grants.length,
        receivedAt: now()
      }
    }
  };
}
