import { loadConfig } from '../config.js';
import { createDatabaseAdapter } from '../db/databaseAdapterFactory.js';
import { createQueryExecutionService } from '../query/queryExecutionService.js';
import { getQueryTemplate, TEMPLATE_MODE } from '../query/templateRegistry.js';
import {
  attachActionResponseEnvelope,
  createNoopAuditService
} from './actionResponseEnvelopeService.js';
import { evaluatePolicyDecision } from './policyDecisionEngine.js';
import { createAuditService } from './auditService.js';
import { createAuthService } from './authService.js';
import { createPolicyGrantStore } from './policyGrantStore.js';
import { createPolicyService } from './policyService.js';
import { createReceiptService } from './receiptService.js';
import {
  createPermissiveRuntimeAttestationService,
  createRuntimeAttestationService
} from './runtimeAttestationService.js';

const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

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

  const requiredFields = ['requestId', 'tenantId', 'requester', 'capability', 'queryTemplate'];
  const missing = requiredFields.filter(
    (field) => typeof payload[field] !== 'string' || payload[field].trim().length === 0
  );

  if (missing.length > 0) {
    return validationError(`Missing required fields: ${missing.join(', ')}`);
  }

  const tenantId = payload.tenantId.trim().toLowerCase();
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    return validationError('tenantId must match [a-z0-9][a-z0-9_-]{0,62}.');
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

function createNoopRuntimeAttestationService() {
  return createPermissiveRuntimeAttestationService();
}

function createNoopPolicyGrantStore() {
  return {
    async listActiveGrants() {
      return [];
    }
  };
}

function normalizeTenantId(rawTenantId) {
  if (typeof rawTenantId !== 'string') {
    return null;
  }

  const normalized = rawTenantId.trim().toLowerCase();
  return TENANT_ID_PATTERN.test(normalized) ? normalized : null;
}

function resolveQueryGrantOperation({ capability, queryTemplate }) {
  const template = getQueryTemplate(queryTemplate);
  if (template?.mode === TEMPLATE_MODE.WRITE) {
    return 'insert';
  }

  if (template?.mode === TEMPLATE_MODE.READ) {
    return 'read';
  }

  if (typeof capability === 'string' && capability.endsWith(':write')) {
    return 'insert';
  }

  return 'read';
}

async function evaluateGrantPolicyDecision({
  policyGrantStore,
  tenantId,
  requester,
  capability,
  queryTemplate
}) {
  const operation = resolveQueryGrantOperation({
    capability,
    queryTemplate
  });

  const grants = await policyGrantStore.listActiveGrants({
    tenantId,
    walletAddress: requester
  });

  const decisionResult = evaluatePolicyDecision({
    tenantId,
    walletAddress: requester,
    scopeType: 'database',
    scopeId: '*',
    operation,
    grants
  });

  if (!decisionResult.ok) {
    return {
      ok: false,
      error: decisionResult.error
    };
  }

  return {
    ok: true,
    operation,
    decision: decisionResult.decision
  };
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
  auditService,
  runtimeVerification
}) {
  return attachActionResponseEnvelope({
    payload,
    result: {
      statusCode,
      body
    },
    decision,
    auth,
    policy,
    execution,
    runtimeVerification,
    auditContext: {
      action: 'query:execute',
      resource: payload?.queryTemplate || null,
      requester: auth?.requester || payload?.requester || null
    },
    receiptService,
    auditService,
    databaseDialect: queryExecutionService?.dialect || 'unknown'
  });
}

export function createQueryService({
  authService,
  policyService,
  policyGrantStore,
  queryExecutionService,
  receiptService,
  auditService,
  runtimeAttestationService
}) {
  const safeQueryExecutionService = queryExecutionService || createDefaultExecutionService();
  const safeReceiptService = receiptService || {
    buildReceipt: () => null
  };
  const safeAuditService = auditService || createNoopAuditService();
  const safePolicyGrantStore = policyGrantStore || createNoopPolicyGrantStore();
  const safeRuntimeAttestationService =
    runtimeAttestationService || createNoopRuntimeAttestationService();

  return {
    async handle(payload) {
      let runtimeCheck;
      try {
        runtimeCheck = await safeRuntimeAttestationService.checkAccess({
          action: 'query:execute',
          sensitive: false
        });
      } catch (error) {
        runtimeCheck = {
          allowed: true,
          snapshot: {
            verificationMode: 'report-only',
            source: 'service',
            action: 'query:execute',
            sensitive: false,
            checkedAt: new Date().toISOString(),
            verified: false,
            verificationStatus: 'unverified',
            claims: {
              appId: null,
              imageDigest: null,
              attestationReportHash: null,
              onchainDeploymentTxHash: null,
              issuedAt: null,
              expiresAt: null
            },
            claimsHash: null,
            issues: [
              {
                code: 'RUNTIME_VERIFICATION_SERVICE_ERROR',
                message: error?.message || 'Runtime verification service failed.'
              }
            ],
            enforced: false
          }
        };
      }

      const runtimeVerification = runtimeCheck.snapshot || null;

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
          auditService: safeAuditService,
          runtimeVerification
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
          auditService: safeAuditService,
          runtimeVerification
        });
      }

      const tenantId = normalizeTenantId(payload.tenantId);
      if (!tenantId) {
        return attachReceiptAndAudit({
          payload,
          statusCode: 400,
          body: {
            error: 'VALIDATION_ERROR',
            message: 'tenantId must match [a-z0-9][a-z0-9_-]{0,62}.'
          },
          decision: {
            outcome: 'deny',
            stage: 'validation',
            code: 'VALIDATION_ERROR',
            message: 'tenantId must match [a-z0-9][a-z0-9_-]{0,62}.'
          },
          auth: authResult,
          policy: null,
          execution: null,
          queryExecutionService: safeQueryExecutionService,
          receiptService: safeReceiptService,
          auditService: safeAuditService,
          runtimeVerification
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
          auditService: safeAuditService,
          runtimeVerification
        });
      }

      let grantPolicyResult;
      try {
        grantPolicyResult = await evaluateGrantPolicyDecision({
          policyGrantStore: safePolicyGrantStore,
          tenantId,
          requester: authResult.requester,
          capability: payload.capability,
          queryTemplate: payload.queryTemplate
        });
      } catch (error) {
        return attachReceiptAndAudit({
          payload,
          statusCode: 503,
          body: {
            error: 'POLICY_STORE_UNAVAILABLE',
            code: 'POLICY_STORE_UNAVAILABLE',
            message: error?.message || 'Unable to evaluate grant policy for request.',
            requestId: payload.requestId,
            tenantId
          },
          decision: {
            outcome: 'deny',
            stage: 'policy',
            code: 'POLICY_STORE_UNAVAILABLE',
            message: error?.message || 'Unable to evaluate grant policy for request.'
          },
          auth: authResult,
          policy: null,
          execution: null,
          queryExecutionService: safeQueryExecutionService,
          receiptService: safeReceiptService,
          auditService: safeAuditService,
          runtimeVerification
        });
      }

      if (!grantPolicyResult.ok) {
        return attachReceiptAndAudit({
          payload,
          statusCode: 400,
          body: {
            error: grantPolicyResult.error.error,
            code: grantPolicyResult.error.error,
            message: grantPolicyResult.error.message,
            requestId: payload.requestId,
            tenantId,
            details: grantPolicyResult.error.details || {}
          },
          decision: {
            outcome: 'deny',
            stage: 'policy',
            code: grantPolicyResult.error.error,
            message: grantPolicyResult.error.message
          },
          auth: authResult,
          policy: null,
          execution: null,
          queryExecutionService: safeQueryExecutionService,
          receiptService: safeReceiptService,
          auditService: safeAuditService,
          runtimeVerification
        });
      }

      if (!grantPolicyResult.decision.allowed) {
        const combinedPolicyResult = {
          allowed: false,
          code: grantPolicyResult.decision.code,
          message: grantPolicyResult.decision.message
        };

        return attachReceiptAndAudit({
          payload,
          statusCode: 403,
          body: {
            error: 'POLICY_DENIED',
            code: grantPolicyResult.decision.code,
            message: grantPolicyResult.decision.message,
            requestId: payload.requestId,
            tenantId,
            capability: payload.capability,
            queryTemplate: payload.queryTemplate,
            details: {
              capabilityPolicyCode: policyResult.code,
              capabilityPolicyMessage: policyResult.message,
              operation: grantPolicyResult.operation,
              evaluationPath: grantPolicyResult.decision.evaluationPath
            }
          },
          decision: {
            outcome: 'deny',
            stage: 'policy',
            code: grantPolicyResult.decision.code,
            message: grantPolicyResult.decision.message
          },
          auth: authResult,
          policy: combinedPolicyResult,
          execution: null,
          queryExecutionService: safeQueryExecutionService,
          receiptService: safeReceiptService,
          auditService: safeAuditService,
          runtimeVerification
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
          auditService: safeAuditService,
          runtimeVerification
        });
      }

      return attachReceiptAndAudit({
        payload,
        statusCode: execution.statusCode,
        body: {
          requestId: payload.requestId,
          tenantId,
          requester: authResult.requester,
          capability: payload.capability,
          queryTemplate: payload.queryTemplate,
          execution: execution.data,
          runtime: runtimeVerification,
          auth: {
            signedAt: authResult.signedAt || null,
            nonce: authResult.nonce || null,
            bypassed: Boolean(authResult.authBypassed)
          },
          policy: {
            code: policyResult.code,
            message: policyResult.message,
            grantCode: grantPolicyResult.decision.code,
            grantMessage: grantPolicyResult.decision.message,
            operation: grantPolicyResult.operation
          }
        },
        decision: {
          outcome: 'allow',
          stage: 'execution',
          code: 'QUERY_EXECUTED',
          message: 'Query executed through approved template.'
        },
        auth: authResult,
        policy: {
          allowed: true,
          code: grantPolicyResult.decision.code,
          message: grantPolicyResult.decision.message
        },
        execution,
        queryExecutionService: safeQueryExecutionService,
        receiptService: safeReceiptService,
        auditService: safeAuditService,
        runtimeVerification
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
const defaultRuntimeAttestationService = createRuntimeAttestationService(runtimeConfig.proof);
let runtimeQueryServicePromise = null;

async function buildRuntimeQueryService() {
  const databaseAdapter = await createDatabaseAdapter(runtimeConfig.database);
  const policyGrantStore = createPolicyGrantStore({ databaseAdapter });
  await policyGrantStore.ensureInitialized();
  const queryExecutionService = createQueryExecutionService({
    databaseAdapter,
    enforceCapabilityMode: runtimeConfig.policy.enforceCapabilityMode
  });

  return createQueryService({
    authService: createAuthService(runtimeConfig.auth),
    policyService: createPolicyService(runtimeConfig.policy),
    policyGrantStore,
    queryExecutionService,
    receiptService: defaultReceiptService,
    auditService: createAuditService({ databaseAdapter }),
    runtimeAttestationService: defaultRuntimeAttestationService
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
    overrides?.policyGrantStore ||
    overrides?.queryExecutionService ||
    overrides?.receiptService ||
    overrides?.auditService ||
    overrides?.runtimeAttestationService
  ) {
    const queryService = createQueryService({
      authService: overrides.authService || createAuthService(runtimeConfig.auth),
      policyService: overrides.policyService || createPolicyService(runtimeConfig.policy),
      policyGrantStore: overrides.policyGrantStore || createNoopPolicyGrantStore(),
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
      auditService: overrides.auditService || defaultAuditService,
      runtimeAttestationService:
        overrides.runtimeAttestationService || defaultRuntimeAttestationService
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
