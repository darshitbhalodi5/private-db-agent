import { loadConfig } from '../config.js';
import { createDatabaseAdapter } from '../db/databaseAdapterFactory.js';
import { createQueryExecutionService } from '../query/queryExecutionService.js';
import { createAuthService } from './authService.js';
import { createPolicyService } from './policyService.js';

function validationError(message) {
  return {
    ok: false,
    statusCode: 400,
    body: {
      error: 'VALIDATION_ERROR',
      message
    }
  };
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return validationError('Request body must be a JSON object.');
  }

  const requiredFields = ['requestId', 'requester', 'capability', 'queryTemplate'];
  const missing = requiredFields.filter(
    (field) => typeof payload[field] !== 'string' || payload[field].trim().length === 0
  );

  if (missing.length > 0) {
    return validationError(`Missing required fields: ${missing.join(', ')}`);
  }

  if (
    payload.queryParams !== undefined &&
    (payload.queryParams === null ||
      Array.isArray(payload.queryParams) ||
      typeof payload.queryParams !== 'object')
  ) {
    return validationError('queryParams must be a JSON object when provided.');
  }

  return { ok: true };
}

export function createQueryService({
  authService,
  policyService,
  queryExecutionService
}) {
  return {
    async handle(payload) {
      const validation = validatePayload(payload);
      if (!validation.ok) {
        return {
          statusCode: validation.statusCode,
          body: validation.body
        };
      }

      const authResult = await authService.authenticate(payload);
      if (!authResult.ok) {
        return {
          statusCode: 401,
          body: {
            error: 'AUTHENTICATION_FAILED',
            code: authResult.code,
            message: authResult.message,
            requestId: payload.requestId
          }
        };
      }

      const policyResult = policyService.evaluateAccess({
        requester: authResult.requester,
        capability: payload.capability,
        queryTemplate: payload.queryTemplate
      });

      if (!policyResult.allowed) {
        return {
          statusCode: 403,
          body: {
            error: 'POLICY_DENIED',
            code: policyResult.code,
            message: policyResult.message,
            requestId: payload.requestId,
            capability: payload.capability,
            queryTemplate: payload.queryTemplate,
            details: {
              allowedTemplates: policyResult.allowedTemplates || []
            }
          }
        };
      }

      const execution = await queryExecutionService.execute({
        capability: payload.capability,
        queryTemplate: payload.queryTemplate,
        queryParams: payload.queryParams || {}
      });

      if (!execution.ok) {
        return {
          statusCode: execution.statusCode,
          body: {
            error: 'QUERY_EXECUTION_FAILED',
            code: execution.code,
            message: execution.message,
            requestId: payload.requestId,
            capability: payload.capability,
            queryTemplate: payload.queryTemplate,
            details: execution.details || {}
          }
        };
      }

      return {
        statusCode: execution.statusCode,
        body: {
          requestId: payload.requestId,
          requester: authResult.requester,
          capability: payload.capability,
          queryTemplate: payload.queryTemplate,
          execution: execution.data,
          auth: {
            signedAt: authResult.signedAt || null,
            nonce: authResult.nonce || null,
            bypassed: Boolean(authResult.authBypassed)
          },
          policy: {
            code: policyResult.code,
            message: policyResult.message
          }
        }
      };
    }
  };
}

const runtimeConfig = loadConfig();
let runtimeQueryServicePromise = null;

async function buildRuntimeQueryService() {
  const databaseAdapter = await createDatabaseAdapter(runtimeConfig.database);
  const queryExecutionService = createQueryExecutionService({
    databaseAdapter,
    enforceCapabilityMode: runtimeConfig.policy.enforceCapabilityMode
  });

  return createQueryService({
    authService: createAuthService(runtimeConfig.auth),
    policyService: createPolicyService(runtimeConfig.policy),
    queryExecutionService
  });
}

async function getRuntimeQueryService() {
  if (!runtimeQueryServicePromise) {
    runtimeQueryServicePromise = buildRuntimeQueryService().catch((error) => {
      runtimeQueryServicePromise = null;
      throw error;
    });
  }

  return runtimeQueryServicePromise;
}

export async function handleQueryRequest(payload, overrides = null) {
  if (overrides?.queryService) {
    return overrides.queryService.handle(payload);
  }

  if (overrides?.authService || overrides?.policyService || overrides?.queryExecutionService) {
    const queryService = createQueryService({
      authService: overrides.authService || createAuthService(runtimeConfig.auth),
      policyService: overrides.policyService || createPolicyService(runtimeConfig.policy),
      queryExecutionService:
        overrides.queryExecutionService ||
        createQueryExecutionService({
          databaseAdapter: {
            dialect: 'sqlite',
            execute: async () => ({ rowCount: 0, rows: [] })
          },
          enforceCapabilityMode: runtimeConfig.policy.enforceCapabilityMode
        })
    });

    return queryService.handle(payload);
  }

  try {
    const queryService = await getRuntimeQueryService();
    return queryService.handle(payload);
  } catch {
    return {
      statusCode: 503,
      body: {
        error: 'SERVICE_UNAVAILABLE',
        message: 'Query service failed to initialize database adapter.'
      }
    };
  }
}
