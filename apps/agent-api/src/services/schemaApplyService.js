import { loadConfig } from '../config.js';
import { createDatabaseAdapter } from '../db/databaseAdapterFactory.js';
import { createActionAuthorizationService } from './actionAuthorizationService.js';
import { createAiDraftStore } from './aiDraftStore.js';
import { createMigrationRunnerService } from './migrationRunnerService.js';
import { createPolicyGrantStore } from './policyGrantStore.js';
import { createPolicyMutationAuthService } from './policyMutationAuthService.js';
import { validateAndCompileSchemaDsl } from './schemaDslService.js';

const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

function normalizeTenantId(rawTenantId) {
  if (typeof rawTenantId !== 'string' || rawTenantId.trim().length === 0) {
    return null;
  }

  const normalized = rawTenantId.trim().toLowerCase();
  if (!TENANT_ID_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

function containsRawSqlInput(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }

  if (typeof payload.sql === 'string' || typeof payload.rawSql === 'string') {
    return true;
  }

  return false;
}

export function createSchemaApplyService({
  migrationRunnerService,
  actionAuthorizationService,
  aiDraftStore
}) {
  if (!migrationRunnerService) {
    throw new Error('migrationRunnerService is required.');
  }

  if (!actionAuthorizationService) {
    throw new Error('actionAuthorizationService is required.');
  }

  if (!aiDraftStore) {
    throw new Error('aiDraftStore is required.');
  }

  async function apply(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {
        statusCode: 400,
        body: {
          error: 'VALIDATION_ERROR',
          message: 'Request body must be a JSON object.'
        }
      };
    }

    if (containsRawSqlInput(payload)) {
      return {
        statusCode: 400,
        body: {
          error: 'RAW_SQL_NOT_ALLOWED',
          message: 'Direct SQL input is not allowed. Use schema DSL fields only.'
        }
      };
    }

    const tenantId = normalizeTenantId(payload.tenantId);
    if (!tenantId) {
      return {
        statusCode: 400,
        body: {
          error: 'VALIDATION_ERROR',
          message: 'tenantId is required and must match [a-z0-9][a-z0-9_-]{0,62}.'
        }
      };
    }

    if (typeof payload.requestId !== 'string' || payload.requestId.trim().length === 0) {
      return {
        statusCode: 400,
        body: {
          error: 'VALIDATION_ERROR',
          message: 'requestId is required.'
        }
      };
    }

    if (typeof payload.actorWallet !== 'string' || payload.actorWallet.trim().length === 0) {
      return {
        statusCode: 400,
        body: {
          error: 'VALIDATION_ERROR',
          message: 'actorWallet is required.'
        }
      };
    }

    const authorizationResult = await actionAuthorizationService.authorize({
      requestId: payload.requestId,
      tenantId,
      actorWallet: payload.actorWallet,
      auth: payload.auth,
      action: 'schema:apply',
      actionPayload: {
        database: payload.database,
        tables: payload.tables
      },
      scopeType: 'database',
      scopeId: '*',
      operation: 'alter'
    });

    if (!authorizationResult.ok) {
      return {
        statusCode: authorizationResult.statusCode,
        body: authorizationResult.body
      };
    }

    const schemaDslResult = validateAndCompileSchemaDsl(payload);
    if (!schemaDslResult.ok) {
      return {
        statusCode: 400,
        body: schemaDslResult.error
      };
    }

    const aiApprovalGate = await validateAiApprovalForSchemaApply(payload, {
      aiDraftStore,
      tenantId,
      actorWallet: payload.actorWallet,
      compiledPlanHash: schemaDslResult.migrationPlan.planHash
    });
    if (!aiApprovalGate.ok) {
      return {
        statusCode: aiApprovalGate.statusCode,
        body: aiApprovalGate.body
      };
    }

    const migrationApply = await migrationRunnerService.applyMigrationPlan({
      tenantId,
      requestId: schemaDslResult.normalizedDsl.requestId,
      migrationPlan: schemaDslResult.migrationPlan
    });

    if (!migrationApply.ok) {
      return {
        statusCode: 500,
        body: migrationApply.error
      };
    }

    return {
      statusCode: 201,
      body: {
        code: 'SCHEMA_APPLIED',
        message: 'Schema DSL validated and migration plan applied transactionally.',
        authorization: {
          actorWallet: authorizationResult.actorWallet,
          decision: authorizationResult.decision,
          signatureHash: authorizationResult.signatureHash
        },
        aiApproval: aiApprovalGate.aiApproval,
        schema: schemaDslResult.schema,
        migrationPlan: schemaDslResult.migrationPlan,
        migration: migrationApply.data
      }
    };
  }

  return {
    apply
  };
}

const runtimeConfig = loadConfig();
let runtimeSchemaApplyServicePromise = null;

async function buildRuntimeSchemaApplyService() {
  const databaseAdapter = await createDatabaseAdapter(runtimeConfig.database);
  const migrationRunnerService = createMigrationRunnerService({ databaseAdapter });
  const grantStore = createPolicyGrantStore({ databaseAdapter });
  const aiDraftStore = createAiDraftStore({ databaseAdapter });
  await grantStore.ensureInitialized();
  await aiDraftStore.ensureInitialized();

  const mutationAuthService = createPolicyMutationAuthService({
    ...runtimeConfig.auth,
    enabled: true
  });

  return createSchemaApplyService({
    migrationRunnerService,
    actionAuthorizationService: createActionAuthorizationService({
      grantStore,
      mutationAuthService
    }),
    aiDraftStore
  });
}

async function getRuntimeSchemaApplyService() {
  if (!runtimeSchemaApplyServicePromise) {
    runtimeSchemaApplyServicePromise = buildRuntimeSchemaApplyService().catch((error) => {
      runtimeSchemaApplyServicePromise = null;
      throw error;
    });
  }

  return runtimeSchemaApplyServicePromise;
}

export async function handleSchemaApplyRequest(payload, overrides = null) {
  try {
    const service = overrides?.schemaApplyService || (await getRuntimeSchemaApplyService());
    return service.apply(payload);
  } catch (error) {
    return {
      statusCode: 503,
      body: {
        error: 'SERVICE_UNAVAILABLE',
        message: error?.message || 'Schema apply service failed to initialize.'
      }
    };
  }
}

export async function validateAiApprovalForSchemaApply(
  payload,
  { aiDraftStore, tenantId, actorWallet, compiledPlanHash }
) {
  if (!aiDraftStore) {
    throw new Error('aiDraftStore is required.');
  }

  if (!payload?.aiAssist || payload.aiAssist.source !== 'eigen-ai') {
    return {
      ok: true,
      aiApproval: null
    };
  }

  const draftId =
    typeof payload.aiAssist.draftId === 'string' && payload.aiAssist.draftId.trim().length > 0
      ? payload.aiAssist.draftId.trim()
      : null;
  const draftHash =
    typeof payload.aiAssist.draftHash === 'string' && payload.aiAssist.draftHash.trim().length > 0
      ? payload.aiAssist.draftHash.trim()
      : null;
  const approvalId =
    typeof payload.aiAssist.approvalId === 'string' && payload.aiAssist.approvalId.trim().length > 0
      ? payload.aiAssist.approvalId.trim()
      : null;
  const approvedBy =
    typeof payload.aiAssist.approvedBy === 'string' && payload.aiAssist.approvedBy.trim().length > 0
      ? payload.aiAssist.approvedBy.trim().toLowerCase()
      : null;

  if (!draftId || !draftHash || !approvalId || !approvedBy) {
    return {
      ok: false,
      statusCode: 403,
      body: {
        error: 'AI_DRAFT_APPROVAL_REQUIRED',
        message:
          'AI-assisted execution requires draftId, draftHash, approvalId, and approvedBy.'
      }
    };
  }

  if (approvedBy !== actorWallet.trim().toLowerCase()) {
    return {
      ok: false,
      statusCode: 403,
      body: {
        error: 'AI_DRAFT_APPROVAL_ACTOR_MISMATCH',
        message: 'approvedBy must match actorWallet for AI-assisted execution.'
      }
    };
  }

  const draft = await aiDraftStore.getDraft({
    tenantId,
    draftId
  });
  if (!draft) {
    return {
      ok: false,
      statusCode: 404,
      body: {
        error: 'AI_DRAFT_NOT_FOUND',
        message: 'AI draft was not found for tenant.'
      }
    };
  }

  if (draft.draftHash !== draftHash) {
    return {
      ok: false,
      statusCode: 409,
      body: {
        error: 'AI_DRAFT_HASH_MISMATCH',
        message: 'AI draft hash does not match persisted draft.'
      }
    };
  }

  if (draft.draftType !== 'schema') {
    return {
      ok: false,
      statusCode: 409,
      body: {
        error: 'AI_DRAFT_TYPE_MISMATCH',
        message: 'AI draft is not a schema draft.'
      }
    };
  }

  if (draft.planHash && draft.planHash !== compiledPlanHash) {
    return {
      ok: false,
      statusCode: 409,
      body: {
        error: 'AI_DRAFT_PLAN_HASH_MISMATCH',
        message: 'Schema payload changed after AI draft generation; approval no longer valid.'
      }
    };
  }

  const approval = await aiDraftStore.getApproval({
    tenantId,
    draftId,
    approvalId
  });

  if (!approval) {
    return {
      ok: false,
      statusCode: 403,
      body: {
        error: 'AI_DRAFT_APPROVAL_REQUIRED',
        message: 'No approval record found for AI draft execution.'
      }
    };
  }

  if (approval.draftHash !== draftHash || approval.approvedBy !== approvedBy) {
    return {
      ok: false,
      statusCode: 409,
      body: {
        error: 'AI_DRAFT_APPROVAL_MISMATCH',
        message: 'Approval metadata does not match draft or actor.'
      }
    };
  }

  return {
    ok: true,
    aiApproval: approval
  };
}
