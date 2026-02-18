import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSqliteAdapter } from '../src/db/adapters/sqliteAdapter.js';
import { createA2aAuthService } from '../src/services/a2aAuthService.js';
import { createA2aTaskService } from '../src/services/a2aTaskService.js';
import { createA2aTaskStore } from '../src/services/a2aTaskStore.js';

async function withA2aTaskService(testFn, { adminAgentIds = [] } = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'private-db-agent-a2a-'));
  const dbPath = path.join(tempDir, 'a2a.sqlite');
  const adapter = await createSqliteAdapter({ filePath: dbPath });
  const a2aTaskStore = createA2aTaskStore({ databaseAdapter: adapter });
  await a2aTaskStore.ensureInitialized();

  const a2aAuthService = createA2aAuthService({
    enabled: true,
    allowUnsigned: true,
    adminAgentIds
  });

  const a2aTaskService = createA2aTaskService({
    a2aAuthService,
    a2aTaskStore,
    serviceMetadata: {
      serviceName: 'private-db-agent-api',
      version: '0.1.0'
    },
    now: () => '2026-02-18T00:00:00.000Z',
    handlers: {
      queryExecute: async () => ({
        statusCode: 200,
        body: {
          code: 'QUERY_EXECUTED',
          rows: [{ ok: true }]
        }
      })
    }
  });

  try {
    await testFn({ a2aTaskService });
  } finally {
    await adapter.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function baseContext(agentId, idempotencyKey = 'idem-1') {
  return {
    headers: {
      'x-agent-id': agentId,
      'x-idempotency-key': idempotencyKey
    },
    method: 'POST',
    path: '/v1/a2a/tasks',
    correlationId: 'corr-1'
  };
}

test('a2a task service creates task and executes lifecycle to success', async () => {
  await withA2aTaskService(async ({ a2aTaskService }) => {
    const create = await a2aTaskService.createTask({
      ...baseContext('agent-alpha', 'idem-create-success'),
      payload: {
        taskType: 'query.execute',
        input: {
          requestId: 'req-a2a-1'
        }
      }
    });

    assert.equal(create.statusCode, 202);
    assert.equal(create.body.code, 'A2A_TASK_ACCEPTED');
    assert.equal(create.body.idempotentReplay, false);
    assert.equal(create.body.task.status, 'succeeded');
    assert.equal(create.body.task.output.statusCode, 200);

    const get = await a2aTaskService.getTask({
      headers: {
        'x-agent-id': 'agent-alpha'
      },
      method: 'GET',
      path: `/v1/a2a/tasks/${create.body.task.taskId}`,
      correlationId: 'corr-2',
      taskId: create.body.task.taskId
    });

    assert.equal(get.statusCode, 200);
    assert.equal(get.body.task.taskId, create.body.task.taskId);
  });
});

test('a2a task service returns idempotent replay for same agent and payload', async () => {
  await withA2aTaskService(async ({ a2aTaskService }) => {
    const first = await a2aTaskService.createTask({
      ...baseContext('agent-alpha', 'idem-replay'),
      payload: {
        taskType: 'query.execute',
        input: {
          requestId: 'req-a2a-2'
        }
      }
    });
    assert.equal(first.statusCode, 202);

    const replay = await a2aTaskService.createTask({
      ...baseContext('agent-alpha', 'idem-replay'),
      payload: {
        taskType: 'query.execute',
        input: {
          requestId: 'req-a2a-2'
        }
      }
    });

    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body.code, 'A2A_TASK_REPLAY');
    assert.equal(replay.body.idempotentReplay, true);
    assert.equal(replay.body.task.taskId, first.body.task.taskId);
  });
});

test('a2a task service rejects idempotency key reuse with different payload', async () => {
  await withA2aTaskService(async ({ a2aTaskService }) => {
    const first = await a2aTaskService.createTask({
      ...baseContext('agent-alpha', 'idem-conflict'),
      payload: {
        taskType: 'query.execute',
        input: {
          requestId: 'req-a2a-3'
        }
      }
    });
    assert.equal(first.statusCode, 202);

    const conflict = await a2aTaskService.createTask({
      ...baseContext('agent-alpha', 'idem-conflict'),
      payload: {
        taskType: 'query.execute',
        input: {
          requestId: 'req-a2a-3-different'
        }
      }
    });

    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body.error, 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
  });
});

test('a2a task read is denied for non-owner non-admin agents', async () => {
  await withA2aTaskService(async ({ a2aTaskService }) => {
    const first = await a2aTaskService.createTask({
      ...baseContext('agent-alpha', 'idem-ownership'),
      payload: {
        taskType: 'query.execute',
        input: {
          requestId: 'req-a2a-4'
        }
      }
    });
    assert.equal(first.statusCode, 202);

    const denied = await a2aTaskService.getTask({
      headers: {
        'x-agent-id': 'agent-beta'
      },
      method: 'GET',
      path: `/v1/a2a/tasks/${first.body.task.taskId}`,
      correlationId: 'corr-3',
      taskId: first.body.task.taskId
    });

    assert.equal(denied.statusCode, 403);
    assert.equal(denied.body.error, 'A2A_TASK_ACCESS_DENIED');
  });
});

test('a2a task read is allowed for admin agent', async () => {
  await withA2aTaskService(
    async ({ a2aTaskService }) => {
      const first = await a2aTaskService.createTask({
        ...baseContext('agent-alpha', 'idem-admin-read'),
        payload: {
          taskType: 'query.execute',
          input: {
            requestId: 'req-a2a-5'
          }
        }
      });
      assert.equal(first.statusCode, 202);

      const allowed = await a2aTaskService.getTask({
        headers: {
          'x-agent-id': 'agent-admin'
        },
        method: 'GET',
        path: `/v1/a2a/tasks/${first.body.task.taskId}`,
        correlationId: 'corr-4',
        taskId: first.body.task.taskId
      });

      assert.equal(allowed.statusCode, 200);
      assert.equal(allowed.body.task.taskId, first.body.task.taskId);
    },
    {
      adminAgentIds: ['agent-admin']
    }
  );
});
