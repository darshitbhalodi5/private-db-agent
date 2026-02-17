import { loadConfig } from '../config.js';
import { createDatabaseAdapter } from '../db/databaseAdapterFactory.js';
import { createQueryExecutionService } from '../query/queryExecutionService.js';
import { createAuditService } from './auditService.js';
import { createAuthService } from './authService.js';
import { createPolicyService } from './policyService.js';
import { createReceiptService } from './receiptService.js';

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

function createNoopAuditService() {
  return {
    recordDecision: async () => ({
      logged: false,
      code: 'NO_AUDIT_SERVICE'
    })
  };
}

function createDefaultExecutionService() {
  return {
    dialect: 'unknown',
    execute: async () => ({
      ok: false,
      statusCode: 503,
      code: 'EXECUTION_SERVICE_NOT_CONFIGURED',
      message: 'Query execution service is not configured.',
      details: {}
    })
  };
}

function normalizeAuditResult(auditResult) {
  if (!auditResult) {
    return {
      logged: false,
      code: 'UNKNOWN_AUDIT_RESULT',
      message: null
    };
  }

  return {
    logged: Boolean(auditResult.logged),
    code: auditResult.code || 'UNKNOWN_AUDIT_RESULT',
    message: auditResult.message || null
  };
}

function getRequesterForAudit(payload, authResult) {
  if (authResult?.requester) {
    return authResult.requester;
  }

  if (payload && typeof payload.requester === 'string' && payload.requester.trim().length > 0) {
    return payload.requester.trim();
  }

  return null;
}

async function attachReceiptAndAudit({
  payload,
  statusCode,
  body,
  decision,
  auth,
  policy,
  execution,
  queryExecutionService,
  receiptService,
  auditService
}) {
  const receipt = receiptService.buildReceipt({
    payload,
    statusCode,
    decision,
    auth,
    policy,
    execution,
    databaseDialect: queryExecutionService?.dialect || 'unknown'
  });

  let auditResult;
  try {
    auditResult = await auditService.recordDecision({
      payload,
      requester: getRequesterForAudit(payload, auth),
      decision: decision.outcome
    });
  } catch (error) {
    auditResult = {
      logged: false,
      code: 'AUDIT_WRITE_FAILED',
      message: error?.message || 'Audit logging failed.'
    };
  }

  return {
    statusCode,
    body: {
      ...body,
      receipt,
      audit: normalizeAuditResult(auditResult)
    }
  };
}

export function createQueryService({
  authService,
  policyService,
  queryExecutionService,
  receiptService,
  auditService
}) {
  const safeQueryExecutionService = queryExecutionService || createDefaultExecutionService();
  const safeReceiptService = receiptService || {
    buildReceipt: () => null
  };
  const safeAuditService = auditService || createNoopAuditService();

  return {
    async handle(payload) {
      const validation = validatePayload(payload);
      if (!validation.ok) {
        return attachReceiptAndAudit({
          payload,
          statusCode: validation.statusCode,
          body: validation.body,
          decision: {
            outcome: 'deny',
            stage: 'validation',
            code: validation.body.error,
            message: validation.body.message
          },
          auth: null,
          policy: null,
          execution: null,
          queryExecutionService: safeQueryExecutionService,
          receiptService: safeReceiptService,
          auditService: safeAuditService
        });
      }

      const authResult = await authService.authenticate(payload);
      if (!authResult.ok) {
        return attachReceiptAndAudit({
          payload,
          statusCode: 401,
          body: {
            error: 'AUTHENTICATION_FAILED',
            code: authResult.code,
            message: authResult.message,
            requestId: payload.requestId
          },
          decision: {
            outcome: 'deny',
            stage: 'authentication',
            code: authResult.code,
            message: authResult.message
          },
          auth: authResult,
          policy: null,
          execution: null,
          queryExecutionService: safeQueryExecutionService,
          receiptService: safeReceiptService,
          auditService: safeAuditService
        });
      }

      const policyResult = policyService.evaluateAccess({
        requester: authResult.requester,
        capability: payload.capability,
        queryTemplate: payload.queryTemplate
      });

      if (!policyResult.allowed) {
        return attachReceiptAndAudit({
          payload,
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
          },
          decision: {
            outcome: 'deny',
            stage: 'policy',
            code: policyResult.code,
            message: policyResult.message
          },
          auth: authResult,
          policy: policyResult,
          execution: null,
          queryExecutionService: safeQueryExecutionService,
          receiptService: safeReceiptService,
          auditService: safeAuditService
        });
      }

      const execution = await safeQueryExecutionService.execute({
        capability: payload.capability,
        queryTemplate: payload.queryTemplate,
        queryParams: payload.queryParams || {}
      });

      if (!execution.ok) {
        return attachReceiptAndAudit({
          payload,
          statusCode: execution.statusCode,
          body: {
            error: 'QUERY_EXECUTION_FAILED',
            code: execution.code,
            message: execution.message,
            requestId: payload.requestId,
            capability: payload.capability,
            queryTemplate: payload.queryTemplate,
            details: execution.details || {}
          },
          decision: {
            outcome: 'deny',
            stage: 'execution',
            code: execution.code,
            message: execution.message
          },
          auth: authResult,
          policy: policyResult,
          execution,
          queryExecutionService: safeQueryExecutionService,
          receiptService: safeReceiptService,
          auditService: safeAuditService
        });
      }

      return attachReceiptAndAudit({
        payload,
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
        },
        decision: {
          outcome: 'allow',
          stage: 'execution',
          code: 'QUERY_EXECUTED',
          message: 'Query executed through approved template.'
        },
        auth: authResult,
        policy: policyResult,
        execution,
        queryExecutionService: safeQueryExecutionService,
        receiptService: safeReceiptService,
        auditService: safeAuditService
      });
    }
  };
}

const runtimeConfig = loadConfig();
const runtimeMetadata = {
  serviceName: runtimeConfig.serviceName,
  version: runtimeConfig.version,
  nodeEnv: runtimeConfig.nodeEnv
};
const defaultReceiptService = createReceiptService(runtimeConfig.proof, runtimeMetadata);
const defaultAuditService = createNoopAuditService();
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
    queryExecutionService,
    receiptService: defaultReceiptService,
    auditService: createAuditService({ databaseAdapter })
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

function buildServiceUnavailableResponse(payload, reason = null) {
  const body = {
    error: 'SERVICE_UNAVAILABLE',
    message: 'Query service failed to initialize database adapter.'
  };

  return attachReceiptAndAudit({
    payload,
    statusCode: 503,
    body,
    decision: {
      outcome: 'deny',
      stage: 'service',
      code: 'SERVICE_UNAVAILABLE',
      message: reason || body.message
    },
    auth: null,
    policy: null,
    execution: null,
    queryExecutionService: createDefaultExecutionService(),
    receiptService: defaultReceiptService,
    auditService: defaultAuditService
  });
}

export async function handleQueryRequest(payload, overrides = null) {
  if (overrides?.queryService) {
    return overrides.queryService.handle(payload);
  }

  if (
    overrides?.authService ||
    overrides?.policyService ||
    overrides?.queryExecutionService ||
    overrides?.receiptService ||
    overrides?.auditService
  ) {
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
        }),
      receiptService: overrides.receiptService || defaultReceiptService,
      auditService: overrides.auditService || defaultAuditService
    });

    return queryService.handle(payload);
  }

  try {
    const queryService = await getRuntimeQueryService();
    return queryService.handle(payload);
  } catch (error) {
    return buildServiceUnavailableResponse(payload, error?.message || null);
  }
}
