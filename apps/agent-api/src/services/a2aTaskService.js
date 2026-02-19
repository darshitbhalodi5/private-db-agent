import { createHash } from 'node:crypto';
import { loadConfig } from '../config.js';
import { createDatabaseAdapter } from '../db/databaseAdapterFactory.js';
import { createA2aAuthService } from './a2aAuthService.js';
import { createA2aTaskStore } from './a2aTaskStore.js';
import {
  handleAiApproveDraftRequest,
  handleAiPolicyDraftRequest,
  handleAiSchemaDraftRequest
} from './eigenAiService.js';
import { handleCreatePolicyGrantRequest, handlePolicyPreviewDecisionRequest, handleRevokePolicyGrantRequest } from './policyAdminService.js';
import { handleQueryRequest } from './queryService.js';
import { handleDataOperationRequest } from './dataOperationService.js';
import { handleSchemaApplyRequest } from './schemaApplyService.js';

const SUPPORTED_TASK_TYPES = Object.freeze([
  'query.execute',
  'policy.preview-decision',
  'policy.grant.create',
  'policy.grant.revoke',
  'schema.apply',
  'data.execute',
  'ai.schema-draft',
  'ai.policy-draft',
  'ai.approve-draft'
]);

const DEFAULT_TASK_CONTRACT_VERSION = '2026-02-18';

function stableSort(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableSort(item));
  }

  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = stableSort(value[key]);
    }
    return sorted;
  }

  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableSort(value));
}

function hashPayload(value) {
  return createHash('sha256').update(stableStringify(value || {})).digest('hex');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTaskType(taskType) {
  const normalized = String(taskType || '').trim().toLowerCase();
  return SUPPORTED_TASK_TYPES.includes(normalized) ? normalized : null;
}

function normalizeIdempotencyKey(headers) {
  if (!headers) {
    return null;
  }

  const value = headers['x-idempotency-key'] ?? headers['X-Idempotency-Key'] ?? '';
  const safe = String(value || '').trim();
  if (!safe || safe.length > 256) {
    return null;
  }

  return safe;
}

function parseLimit(rawLimit) {
  const parsed = Number.parseInt(String(rawLimit || ''), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 25;
  }

  return Math.min(parsed, 200);
}

function toPublicTask(task) {
  if (!task) {
    return null;
  }

  return {
    taskId: task.taskId,
    requesterAgentId: task.requesterAgentId,
    correlationId: task.correlationId,
    idempotencyKey: task.idempotencyKey,
    payloadHash: task.payloadHash,
    taskType: task.taskType,
    contractVersion: task.contractVersion,
    status: task.status,
    input: task.input,
    output: task.output,
    error: task.error,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt
  };
}

function serviceError(statusCode, error, message, details = null) {
  return {
    statusCode,
    body: {
      error,
      message,
      ...(details ? { details } : {})
    }
  };
}

export function createA2aTaskService({
  a2aAuthService,
  a2aTaskStore,
  serviceMetadata,
  now = () => new Date().toISOString(),
  handlers = {}
}) {
  if (!a2aAuthService) {
    throw new Error('a2aAuthService is required.');
  }

  if (!a2aTaskStore) {
    throw new Error('a2aTaskStore is required.');
  }

  const taskHandlers = {
    'query.execute': handlers.queryExecute || ((input) => handleQueryRequest(input)),
    'policy.preview-decision':
      handlers.policyPreviewDecision || ((input) => handlePolicyPreviewDecisionRequest(input)),
    'policy.grant.create':
      handlers.policyGrantCreate || ((input) => handleCreatePolicyGrantRequest(input)),
    'policy.grant.revoke':
      handlers.policyGrantRevoke || ((input) => handleRevokePolicyGrantRequest(input)),
    'schema.apply': handlers.schemaApply || ((input) => handleSchemaApplyRequest(input)),
    'data.execute': handlers.dataExecute || ((input) => handleDataOperationRequest(input)),
    'ai.schema-draft': handlers.aiSchemaDraft || ((input) => handleAiSchemaDraftRequest(input)),
    'ai.policy-draft': handlers.aiPolicyDraft || ((input) => handleAiPolicyDraftRequest(input)),
    'ai.approve-draft': handlers.aiApproveDraft || ((input) => handleAiApproveDraftRequest(input))
  };

  async function authenticateA2aRequest({
    method,
    path,
    headers,
    body,
    correlationId,
    idempotencyKey
  }) {
    const authResult = await a2aAuthService.authenticate({
      method,
      path,
      headers,
      body,
      correlationId,
      idempotencyKey
    });

    if (!authResult.ok) {
      return serviceError(
        authResult.statusCode || 401,
        authResult.code || 'A2A_AUTHENTICATION_FAILED',
        authResult.message || 'A2A authentication failed.',
        authResult.details || null
      );
    }

    return {
      ok: true,
      auth: authResult
    };
  }

  async function executeTask(task) {
    const safeNow = now();
    await a2aTaskStore.updateStatus({
      taskId: task.taskId,
      status: 'running',
      output: {},
      error: {},
      startedAt: safeNow,
      updatedAt: safeNow
    });

    try {
      const handler = taskHandlers[task.taskType];
      if (!handler) {
        await a2aTaskStore.updateStatus({
          taskId: task.taskId,
          status: 'failed',
          output: {},
          error: {
            error: 'A2A_TASK_TYPE_UNSUPPORTED',
            message: `Unsupported task type '${task.taskType}'.`
          },
          completedAt: now(),
          updatedAt: now()
        });
        return;
      }

      const result = await handler(task.input);
      if (!result || typeof result.statusCode !== 'number') {
        await a2aTaskStore.updateStatus({
          taskId: task.taskId,
          status: 'failed',
          output: {},
          error: {
            error: 'A2A_TASK_HANDLER_INVALID_RESPONSE',
            message: 'Task handler returned invalid response envelope.'
          },
          completedAt: now(),
          updatedAt: now()
        });
        return;
      }

      if (result.statusCode >= 400) {
        await a2aTaskStore.updateStatus({
          taskId: task.taskId,
          status: 'failed',
          output: {},
          error: {
            statusCode: result.statusCode,
            body: result.body || {}
          },
          completedAt: now(),
          updatedAt: now()
        });
        return;
      }

      await a2aTaskStore.updateStatus({
        taskId: task.taskId,
        status: 'succeeded',
        output: {
          statusCode: result.statusCode,
          body: result.body || {}
        },
        error: {},
        completedAt: now(),
        updatedAt: now()
      });
    } catch (error) {
      await a2aTaskStore.updateStatus({
        taskId: task.taskId,
        status: 'failed',
        output: {},
        error: {
          error: 'A2A_TASK_EXECUTION_FAILED',
          message: error?.message || 'Task execution failed.'
        },
        completedAt: now(),
        updatedAt: now()
      });
    }
  }

  async function createTask({ headers, method, path, correlationId, payload }) {
    if (!isObject(payload)) {
      return serviceError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object.');
    }

    const taskType = normalizeTaskType(payload.taskType);
    if (!taskType) {
      return serviceError(400, 'VALIDATION_ERROR', `taskType must be one of: ${SUPPORTED_TASK_TYPES.join(', ')}.`);
    }

    const idempotencyKey = normalizeIdempotencyKey(headers);
    if (!idempotencyKey) {
      return serviceError(400, 'MISSING_IDEMPOTENCY_KEY', 'x-idempotency-key header is required.');
    }

    const authResult = await authenticateA2aRequest({
      method,
      path,
      headers,
      body: payload,
      correlationId,
      idempotencyKey
    });
    if (!authResult.ok) {
      return authResult;
    }

    const authorization = a2aAuthService.authorizeTaskType(authResult.auth.agentId, taskType);
    if (!authorization.ok) {
      return serviceError(
        authorization.statusCode || 403,
        authorization.code || 'A2A_AUTHORIZATION_FAILED',
        authorization.message || 'A2A task authorization failed.'
      );
    }

    const payloadHash = authResult.auth.payloadHash || hashPayload(payload);
    const existingByKey = await a2aTaskStore.findByIdempotency({
      requesterAgentId: authResult.auth.agentId,
      idempotencyKey
    });

    if (existingByKey) {
      if (existingByKey.payloadHash !== payloadHash) {
        return serviceError(
          409,
          'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
          'x-idempotency-key was already used for different payload content.',
          {
            taskId: existingByKey.taskId
          }
        );
      }

      return {
        statusCode: 200,
        body: {
          code: 'A2A_TASK_REPLAY',
          idempotentReplay: true,
          task: toPublicTask(existingByKey)
        }
      };
    }

    const safeNow = now();
    const createResult = await a2aTaskStore.createTask({
      requesterAgentId: authResult.auth.agentId,
      idempotencyKey,
      payloadHash,
      correlationId,
      taskType,
      contractVersion: payload.contractVersion || DEFAULT_TASK_CONTRACT_VERSION,
      input: isObject(payload.input) ? payload.input : {},
      now: safeNow
    });

    const task = createResult.task;
    if (!task) {
      return serviceError(500, 'TASK_PERSISTENCE_FAILED', 'Failed to persist A2A task.');
    }

    if (!createResult.created) {
      if (task.payloadHash !== payloadHash) {
        return serviceError(
          409,
          'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
          'x-idempotency-key was already used for different payload content.',
          {
            taskId: task.taskId
          }
        );
      }

      return {
        statusCode: 200,
        body: {
          code: 'A2A_TASK_REPLAY',
          idempotentReplay: true,
          task: toPublicTask(task)
        }
      };
    }

    await executeTask(task);
    const finalTask = await a2aTaskStore.findByTaskId(task.taskId);

    return {
      statusCode: 202,
      body: {
        code: 'A2A_TASK_ACCEPTED',
        idempotentReplay: false,
        task: toPublicTask(finalTask || task)
      }
    };
  }

  async function getTask({ headers, method, path, correlationId, taskId }) {
    const authResult = await authenticateA2aRequest({
      method,
      path,
      headers,
      body: {},
      correlationId,
      idempotencyKey: null
    });
    if (!authResult.ok) {
      return authResult;
    }

    const task = await a2aTaskStore.findByTaskId(taskId);
    if (!task) {
      return serviceError(404, 'A2A_TASK_NOT_FOUND', 'Task not found.');
    }

    if (!a2aAuthService.canReadTask(authResult.auth.agentId, task.requesterAgentId)) {
      return serviceError(403, 'A2A_TASK_ACCESS_DENIED', 'Agent cannot access this task.');
    }

    return {
      statusCode: 200,
      body: {
        code: 'A2A_TASK_FOUND',
        task: toPublicTask(task)
      }
    };
  }

  async function listTasks({ headers, method, path, correlationId, query }) {
    const authResult = await authenticateA2aRequest({
      method,
      path,
      headers,
      body: {},
      correlationId,
      idempotencyKey: null
    });
    if (!authResult.ok) {
      return authResult;
    }

    const status = query?.status ? String(query.status).trim().toLowerCase() : null;
    const limit = parseLimit(query?.limit);
    const tasks = await a2aTaskStore.listTasks({
      requesterAgentId: authResult.auth.agentId,
      status,
      limit
    });

    return {
      statusCode: 200,
      body: {
        code: 'A2A_TASKS_LISTED',
        tasks: tasks.map((task) => toPublicTask(task))
      }
    };
  }

  function getAgentCard() {
    const baseUrl = '/v1/a2a';
    const authMetadata =
      typeof a2aAuthService.getAuthMetadata === 'function' ? a2aAuthService.getAuthMetadata() : {};
    const signatureScheme =
      authMetadata.signatureScheme || serviceMetadata?.a2aSignatureScheme || 'hmac-sha256';

    return {
      statusCode: 200,
      body: {
        code: 'A2A_AGENT_CARD',
        agentCard: {
          name: serviceMetadata?.serviceName || 'private-db-agent-api',
          description:
            'Policy-bound database agent with signed execution and runtime verification metadata.',
          version: serviceMetadata?.version || '0.1.0',
          protocolVersion: 'a2a-2026-02-18',
          apiVersion: 'v1',
          authentication: {
            scheme: signatureScheme,
            requiredHeaders: [
              'x-agent-id',
              'x-agent-timestamp',
              'x-agent-nonce',
              'x-agent-signature',
              'x-idempotency-key'
            ],
            signerRegistrySize:
              Number.isInteger(authMetadata.signerRegistrySize) ? authMetadata.signerRegistrySize : 0
          },
          endpoints: {
            createTask: `${baseUrl}/tasks`,
            getTask: `${baseUrl}/tasks/{taskId}`,
            listTasks: `${baseUrl}/tasks`,
            agentCard: `${baseUrl}/agent-card`,
            contracts: `${baseUrl}/contracts`
          },
          supportedTaskTypes: [...SUPPORTED_TASK_TYPES]
        }
      }
    };
  }

  function getContracts() {
    return {
      statusCode: 200,
      body: {
        code: 'A2A_CONTRACTS',
        contracts: {
          taskEnvelope: {
            version: DEFAULT_TASK_CONTRACT_VERSION,
            fields: ['taskType', 'input', 'contractVersion?']
          },
          taskStatus: {
            version: DEFAULT_TASK_CONTRACT_VERSION,
            statuses: ['accepted', 'running', 'succeeded', 'failed']
          },
          idempotency: {
            keyHeader: 'x-idempotency-key',
            replayBehavior: 'same payload returns existing task; different payload returns conflict'
          }
        }
      }
    };
  }

  return {
    createTask,
    getTask,
    listTasks,
    getAgentCard,
    getContracts
  };
}

const runtimeConfig = loadConfig();
let runtimeA2aTaskServicePromise = null;

async function buildRuntimeA2aTaskService() {
  const databaseAdapter = await createDatabaseAdapter(runtimeConfig.database);
  const a2aTaskStore = createA2aTaskStore({
    databaseAdapter
  });
  await a2aTaskStore.ensureInitialized();
  const a2aAuthService = createA2aAuthService(runtimeConfig.a2a);
  const authMetadata =
    typeof a2aAuthService.getAuthMetadata === 'function' ? a2aAuthService.getAuthMetadata() : {};

  return createA2aTaskService({
    a2aAuthService,
    a2aTaskStore,
    serviceMetadata: {
      serviceName: runtimeConfig.serviceName,
      version: runtimeConfig.version,
      a2aSignatureScheme: authMetadata.signatureScheme || runtimeConfig.a2a.signatureScheme
    }
  });
}

async function getRuntimeA2aTaskService() {
  if (!runtimeA2aTaskServicePromise) {
    runtimeA2aTaskServicePromise = buildRuntimeA2aTaskService().catch((error) => {
      runtimeA2aTaskServicePromise = null;
      throw error;
    });
  }

  return runtimeA2aTaskServicePromise;
}

function serviceUnavailable(message) {
  return {
    statusCode: 503,
    body: {
      error: 'SERVICE_UNAVAILABLE',
      message: message || 'A2A task service unavailable.'
    }
  };
}

export async function handleA2aCreateTaskRequest(payload, context = {}, overrides = null) {
  try {
    const service = overrides?.a2aTaskService || (await getRuntimeA2aTaskService());
    return service.createTask({
      headers: context.headers || {},
      method: context.method || 'POST',
      path: context.path || '/v1/a2a/tasks',
      correlationId: context.correlationId || null,
      payload
    });
  } catch (error) {
    return serviceUnavailable(error?.message);
  }
}

export async function handleA2aGetTaskRequest(taskId, context = {}, overrides = null) {
  try {
    const service = overrides?.a2aTaskService || (await getRuntimeA2aTaskService());
    return service.getTask({
      headers: context.headers || {},
      method: context.method || 'GET',
      path: context.path || `/v1/a2a/tasks/${taskId}`,
      correlationId: context.correlationId || null,
      taskId
    });
  } catch (error) {
    return serviceUnavailable(error?.message);
  }
}

export async function handleA2aListTasksRequest(query = {}, context = {}, overrides = null) {
  try {
    const service = overrides?.a2aTaskService || (await getRuntimeA2aTaskService());
    return service.listTasks({
      headers: context.headers || {},
      method: context.method || 'GET',
      path: context.path || '/v1/a2a/tasks',
      correlationId: context.correlationId || null,
      query
    });
  } catch (error) {
    return serviceUnavailable(error?.message);
  }
}

export async function handleA2aAgentCardRequest(overrides = null) {
  try {
    const service = overrides?.a2aTaskService || (await getRuntimeA2aTaskService());
    return service.getAgentCard();
  } catch (error) {
    return serviceUnavailable(error?.message);
  }
}

export async function handleA2aContractsRequest(overrides = null) {
  try {
    const service = overrides?.a2aTaskService || (await getRuntimeA2aTaskService());
    return service.getContracts();
  } catch (error) {
    return serviceUnavailable(error?.message);
  }
}

export { SUPPORTED_TASK_TYPES };
