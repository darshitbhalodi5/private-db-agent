import { randomUUID } from 'node:crypto';

const TASK_STATUSES = Object.freeze(['accepted', 'running', 'succeeded', 'failed']);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function createPlaceholders(dialect, count, offset = 0) {
  if (dialect === 'postgres') {
    return Array.from({ length: count }, (_, index) => `$${index + 1 + offset}`);
  }

  return Array.from({ length: count }, () => '?');
}

function serializeJson(value) {
  return JSON.stringify(value ?? {});
}

function parseJson(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function normalizeStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return TASK_STATUSES.includes(normalized) ? normalized : 'accepted';
}

function toTask(row) {
  if (!row) {
    return null;
  }

  return {
    taskId: row.task_id,
    requesterAgentId: row.requester_agent_id,
    idempotencyKey: row.idempotency_key,
    payloadHash: row.payload_hash,
    correlationId: row.correlation_id,
    taskType: row.task_type,
    contractVersion: row.contract_version,
    status: normalizeStatus(row.status),
    input: parseJson(row.input_json),
    output: parseJson(row.output_json),
    error: parseJson(row.error_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null
  };
}

function normalizeTaskRecord({
  requesterAgentId,
  idempotencyKey,
  payloadHash,
  correlationId,
  taskType,
  contractVersion,
  input,
  now,
  taskId = null
}) {
  const safeNow = now || new Date().toISOString();
  return {
    taskId: taskId || randomUUID(),
    requesterAgentId: requesterAgentId.trim().toLowerCase(),
    idempotencyKey: idempotencyKey.trim(),
    payloadHash: payloadHash.trim(),
    correlationId: isNonEmptyString(correlationId) ? correlationId.trim() : null,
    taskType: taskType.trim().toLowerCase(),
    contractVersion: isNonEmptyString(contractVersion) ? contractVersion.trim() : '2026-02-18',
    status: 'accepted',
    input: input || {},
    output: {},
    error: {},
    createdAt: safeNow,
    updatedAt: safeNow,
    startedAt: null,
    completedAt: null
  };
}

function isUniqueViolation(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('unique constraint') || message.includes('duplicate key');
}

export function createA2aTaskStore({ databaseAdapter }) {
  if (!databaseAdapter || typeof databaseAdapter.execute !== 'function') {
    throw new Error('databaseAdapter is required for A2A task store.');
  }

  const dialect = databaseAdapter.dialect;
  let initPromise = null;

  async function ensureInitialized() {
    if (!initPromise) {
      initPromise = initializeSchema().catch((error) => {
        initPromise = null;
        throw error;
      });
    }

    return initPromise;
  }

  async function initializeSchema() {
    await databaseAdapter.execute({
      mode: 'write',
      sql: `
        CREATE TABLE IF NOT EXISTS a2a_tasks (
          task_id TEXT PRIMARY KEY,
          requester_agent_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          correlation_id TEXT,
          task_type TEXT NOT NULL,
          contract_version TEXT NOT NULL,
          status TEXT NOT NULL,
          input_json TEXT NOT NULL,
          output_json TEXT NOT NULL,
          error_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT
        )
      `,
      values: []
    });

    await databaseAdapter.execute({
      mode: 'write',
      sql: `
        CREATE UNIQUE INDEX IF NOT EXISTS idx_a2a_tasks_agent_idempotency
        ON a2a_tasks (requester_agent_id, idempotency_key)
      `,
      values: []
    });

    await databaseAdapter.execute({
      mode: 'write',
      sql: `
        CREATE INDEX IF NOT EXISTS idx_a2a_tasks_agent_status_time
        ON a2a_tasks (requester_agent_id, status, created_at DESC)
      `,
      values: []
    });
  }

  async function findByTaskId(taskId) {
    await ensureInitialized();
    if (!isNonEmptyString(taskId)) {
      return null;
    }

    const placeholders = createPlaceholders(dialect, 1);
    const result = await databaseAdapter.execute({
      mode: 'read',
      sql: `
        SELECT *
        FROM a2a_tasks
        WHERE task_id = ${placeholders[0]}
        LIMIT 1
      `,
      values: [taskId.trim()]
    });

    return toTask(result.rows?.[0] || null);
  }

  async function findByIdempotency({ requesterAgentId, idempotencyKey }) {
    await ensureInitialized();
    if (!isNonEmptyString(requesterAgentId) || !isNonEmptyString(idempotencyKey)) {
      return null;
    }

    const placeholders = createPlaceholders(dialect, 2);
    const result = await databaseAdapter.execute({
      mode: 'read',
      sql: `
        SELECT *
        FROM a2a_tasks
        WHERE
          requester_agent_id = ${placeholders[0]}
          AND idempotency_key = ${placeholders[1]}
        LIMIT 1
      `,
      values: [requesterAgentId.trim().toLowerCase(), idempotencyKey.trim()]
    });

    return toTask(result.rows?.[0] || null);
  }

  async function createTask(input) {
    await ensureInitialized();
    const task = normalizeTaskRecord(input);
    const placeholders = createPlaceholders(dialect, 14);

    try {
      await databaseAdapter.execute({
        mode: 'write',
        sql: `
          INSERT INTO a2a_tasks (
            task_id,
            requester_agent_id,
            idempotency_key,
            payload_hash,
            correlation_id,
            task_type,
            contract_version,
            status,
            input_json,
            output_json,
            error_json,
            created_at,
            updated_at,
            started_at
          )
          VALUES (${placeholders.join(', ')})
        `,
        values: [
          task.taskId,
          task.requesterAgentId,
          task.idempotencyKey,
          task.payloadHash,
          task.correlationId,
          task.taskType,
          task.contractVersion,
          task.status,
          serializeJson(task.input),
          serializeJson(task.output),
          serializeJson(task.error),
          task.createdAt,
          task.updatedAt,
          null
        ]
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await findByIdempotency({
          requesterAgentId: task.requesterAgentId,
          idempotencyKey: task.idempotencyKey
        });
        return {
          created: false,
          task: existing
        };
      }

      throw error;
    }

    return {
      created: true,
      task
    };
  }

  async function updateStatus({
    taskId,
    status,
    output,
    error,
    startedAt = undefined,
    completedAt = undefined,
    updatedAt = new Date().toISOString()
  }) {
    await ensureInitialized();
    if (!isNonEmptyString(taskId)) {
      return null;
    }

    const normalizedStatus = normalizeStatus(status);
    const safeStartedAt =
      startedAt === undefined ? undefined : isNonEmptyString(startedAt) ? startedAt : null;
    const safeCompletedAt =
      completedAt === undefined ? undefined : isNonEmptyString(completedAt) ? completedAt : null;

    const updateColumns = [
      {
        key: 'status',
        value: normalizedStatus
      },
      {
        key: 'output_json',
        value: serializeJson(output ?? {})
      },
      {
        key: 'error_json',
        value: serializeJson(error ?? {})
      },
      {
        key: 'updated_at',
        value: updatedAt
      }
    ];

    if (safeStartedAt !== undefined) {
      updateColumns.push({
        key: 'started_at',
        value: safeStartedAt
      });
    }

    if (safeCompletedAt !== undefined) {
      updateColumns.push({
        key: 'completed_at',
        value: safeCompletedAt
      });
    }

    const setFragments = [];
    const values = [];

    updateColumns.forEach((entry, index) => {
      const placeholders = createPlaceholders(dialect, 1, index);
      setFragments.push(`${entry.key} = ${placeholders[0]}`);
      values.push(entry.value);
    });

    const taskIdPlaceholder = createPlaceholders(dialect, 1, values.length)[0];
    values.push(taskId.trim());

    await databaseAdapter.execute({
      mode: 'write',
      sql: `
        UPDATE a2a_tasks
        SET ${setFragments.join(', ')}
        WHERE task_id = ${taskIdPlaceholder}
      `,
      values
    });

    return findByTaskId(taskId.trim());
  }

  async function listTasks({
    requesterAgentId,
    status = null,
    limit = 25
  }) {
    await ensureInitialized();

    const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 200)) : 25;
    const conditions = [];
    const values = [];

    if (isNonEmptyString(requesterAgentId)) {
      const placeholder = createPlaceholders(dialect, 1, values.length)[0];
      conditions.push(`requester_agent_id = ${placeholder}`);
      values.push(requesterAgentId.trim().toLowerCase());
    }

    if (isNonEmptyString(status)) {
      const placeholder = createPlaceholders(dialect, 1, values.length)[0];
      conditions.push(`status = ${placeholder}`);
      values.push(normalizeStatus(status));
    }

    const limitPlaceholder = createPlaceholders(dialect, 1, values.length)[0];
    values.push(safeLimit);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await databaseAdapter.execute({
      mode: 'read',
      sql: `
        SELECT *
        FROM a2a_tasks
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ${limitPlaceholder}
      `,
      values
    });

    return (result.rows || []).map((row) => toTask(row));
  }

  return {
    ensureInitialized,
    createTask,
    findByTaskId,
    findByIdempotency,
    updateStatus,
    listTasks
  };
}
