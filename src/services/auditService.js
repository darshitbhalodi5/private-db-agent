function getInsertSqlByDialect(dialect) {
  if (dialect === 'postgres') {
    return `
      INSERT INTO access_log (request_id, requester, capability, query_template, decision, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;
  }

  if (dialect === 'sqlite') {
    return `
      INSERT INTO access_log (request_id, requester, capability, query_template, decision, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
  }

  return null;
}

function normalizeDecision(value) {
  return value === 'allow' ? 'allow' : 'deny';
}

function safeString(value, fallback) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return fallback;
}

export function createAuditService({ databaseAdapter, now = () => new Date() }) {
  async function recordDecision({ payload, requester, decision }) {
    if (!databaseAdapter || typeof databaseAdapter.execute !== 'function') {
      return {
        logged: false,
        code: 'NO_DATABASE_ADAPTER'
      };
    }

    const sql = getInsertSqlByDialect(databaseAdapter.dialect);
    if (!sql) {
      return {
        logged: false,
        code: 'UNSUPPORTED_DIALECT'
      };
    }

    const values = [
      safeString(payload?.requestId, `auto-${now().getTime()}`),
      safeString(requester || payload?.requester, 'unknown'),
      safeString(payload?.capability, 'unknown'),
      safeString(payload?.queryTemplate, 'unknown'),
      normalizeDecision(decision),
      now().toISOString()
    ];

    try {
      await databaseAdapter.execute({
        mode: 'write',
        queryTemplate: 'internal_audit_log_insert',
        sql,
        values
      });

      return {
        logged: true,
        code: 'LOGGED'
      };
    } catch (error) {
      return {
        logged: false,
        code: 'WRITE_FAILED',
        message: error?.message || 'Failed to insert audit log record.'
      };
    }
  }

  return {
    recordDecision
  };
}
