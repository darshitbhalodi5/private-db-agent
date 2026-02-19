import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.js';
import { createPolicyMutationAuthService } from './policyMutationAuthService.js';
import { validateAndCompileSchemaDsl } from './schemaDslService.js';

const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

function validationError(message) {
  return {
    statusCode: 400,
    body: {
      error: 'VALIDATION_ERROR',
      message
    }
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

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeTenantId(rawTenantId) {
  if (!isNonEmptyString(rawTenantId)) {
    return null;
  }

  const normalized = rawTenantId.trim().toLowerCase();
  return TENANT_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeSubmitPayload(payload) {
  if (!isObject(payload)) {
    return {
      ok: false,
      error: validationError('Request body must be a JSON object.')
    };
  }

  const requestId = isNonEmptyString(payload.requestId) ? payload.requestId.trim() : null;
  if (!requestId) {
    return {
      ok: false,
      error: validationError('requestId is required.')
    };
  }

  const tenantId = normalizeTenantId(payload.tenantId);
  if (!tenantId) {
    return {
      ok: false,
      error: validationError('tenantId is required and must match [a-z0-9][a-z0-9_-]{0,62}.')
    };
  }

  const actorWallet = isNonEmptyString(payload.actorWallet) ? payload.actorWallet.trim() : null;
  if (!actorWallet) {
    return {
      ok: false,
      error: validationError('actorWallet is required.')
    };
  }

  if (!isObject(payload.auth)) {
    return {
      ok: false,
      error: validationError('auth object is required.')
    };
  }

  return {
    ok: true,
    normalized: {
      requestId,
      tenantId,
      actorWallet
    }
  };
}

function buildSubmitActionPayload(payload) {
  return {
    creator: payload.creator || null,
    database: payload.database || null,
    tables: Array.isArray(payload.tables) ? payload.tables : [],
    grants: Array.isArray(payload.grants) ? payload.grants : [],
    aiAssist: payload.aiAssist || null,
    metadata: payload.metadata || null
  };
}

export function createControlPlaneSubmissionService({
  mutationAuthService,
  now = () => new Date().toISOString(),
  createSubmissionId = () => `sub_${randomUUID()}`
} = {}) {
  if (!mutationAuthService) {
    throw new Error('mutationAuthService is required for control plane submission service.');
  }

  async function submit(payload) {
    const normalizedPayload = normalizeSubmitPayload(payload);
    if (!normalizedPayload.ok) {
      return normalizedPayload.error;
    }

    const authResult = await mutationAuthService.authenticate({
      requestId: normalizedPayload.normalized.requestId,
      tenantId: normalizedPayload.normalized.tenantId,
      actorWallet: normalizedPayload.normalized.actorWallet,
      action: 'schema:submit',
      payload: buildSubmitActionPayload(payload),
      auth: payload.auth
    });

    if (!authResult.ok) {
      return serviceError(
        authResult.statusCode || 401,
        authResult.code || 'AUTHENTICATION_FAILED',
        authResult.message || 'Control plane submission authentication failed.'
      );
    }

    const schemaDslResult = validateAndCompileSchemaDsl(payload);
    if (!schemaDslResult.ok) {
      return {
        statusCode: 400,
        body: schemaDslResult.error
      };
    }

    const grants = Array.isArray(payload.grants) ? payload.grants : [];
    const { normalizedDsl, schema, migrationPlan } = schemaDslResult;

    return {
      statusCode: 202,
      body: {
        code: 'SCHEMA_REQUEST_ACCEPTED',
        message: 'Schema DSL payload accepted and compiled to deterministic migration plan.',
        authorization: {
          actorWallet: authResult.actorWallet,
          signedAt: authResult.signedAt || null,
          nonce: authResult.nonce || null,
          signatureHash: authResult.signatureHash
        },
        schema,
        migrationPlan,
        submission: {
          submissionId: createSubmissionId(),
          requestId: normalizedDsl.requestId,
          tenantId: normalizedPayload.normalized.tenantId,
          creatorWalletAddress: normalizedDsl.creator.walletAddress,
          databaseName: normalizedDsl.database.name,
          tableCount: normalizedDsl.tables.length,
          grantCount: grants.length,
          receivedAt: now()
        }
      }
    };
  }

  return {
    submit
  };
}

const runtimeConfig = loadConfig();
const runtimeControlPlaneSubmissionService = createControlPlaneSubmissionService({
  mutationAuthService: createPolicyMutationAuthService({
    ...runtimeConfig.auth,
    enabled: true
  })
});

export async function handleControlPlaneSubmission(payload, overrides = null) {
  try {
    const controlPlaneSubmissionService =
      overrides?.controlPlaneSubmissionService || runtimeControlPlaneSubmissionService;
    return await controlPlaneSubmissionService.submit(payload);
  } catch (error) {
    return serviceError(
      503,
      'SERVICE_UNAVAILABLE',
      error?.message || 'Control plane submission service failed to initialize.'
    );
  }
}
