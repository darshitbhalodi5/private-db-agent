import {
  OPERATION_TYPES,
  SCOPE_TYPES,
  WALLET_ADDRESS_PATTERN
} from '@eigen-private-db-agent/shared-types';
import { loadConfig } from '../config.js';
import { createDatabaseAdapter } from '../db/databaseAdapterFactory.js';
import {
  evaluatePolicyDecision,
  POLICY_REQUEST_OPERATIONS
} from './policyDecisionEngine.js';
import { createPolicyGrantStore } from './policyGrantStore.js';
import { createPolicyMutationAuthService } from './policyMutationAuthService.js';
import {
  createPermissiveRuntimeAttestationService,
  createRuntimeAttestationService
} from './runtimeAttestationService.js';

const EFFECT_TYPES = Object.freeze(['allow', 'deny']);
const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const TABLE_SCOPE_ID_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
const walletRegex = new RegExp(WALLET_ADDRESS_PATTERN);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validationError(message, issues = []) {
  return {
    statusCode: 400,
    body: {
      error: 'VALIDATION_ERROR',
      message,
      details: {
        issues
      }
    }
  };
}

function serviceError(code, message, statusCode, details = null) {
  return {
    statusCode,
    body: {
      error: code,
      message,
      ...(details ? { details } : {})
    }
  };
}

function normalizeTenantId(rawTenantId) {
  if (!isNonEmptyString(rawTenantId)) {
    return null;
  }

  const normalized = rawTenantId.trim().toLowerCase();
  if (!TENANT_ID_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeWalletAddress(rawWalletAddress) {
  if (!isNonEmptyString(rawWalletAddress)) {
    return null;
  }

  const normalized = rawWalletAddress.trim().toLowerCase();
  if (!walletRegex.test(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeScopeType(rawScopeType) {
  const normalized = String(rawScopeType || '').trim().toLowerCase();
  if (!SCOPE_TYPES.includes(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeOperation(rawOperation) {
  const normalized = String(rawOperation || '').trim().toLowerCase();
  if (!OPERATION_TYPES.includes(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeEffect(rawEffect) {
  const normalized = String(rawEffect || '').trim().toLowerCase();
  if (!EFFECT_TYPES.includes(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeScopeId(scopeType, rawScopeId) {
  if (scopeType === 'database') {
    return '*';
  }

  if (!isNonEmptyString(rawScopeId)) {
    return null;
  }

  const normalized = rawScopeId.trim().toLowerCase();
  if (!TABLE_SCOPE_ID_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeCreateGrantPayload(payload) {
  const issues = [];
  const tenantId = normalizeTenantId(payload?.tenantId);
  if (!tenantId) {
    issues.push({
      path: 'tenantId',
      code: 'invalid_tenant_id',
      message: 'tenantId is required and must match [a-z0-9][a-z0-9_-]{0,62}.'
    });
  }

  const requestId = isNonEmptyString(payload?.requestId) ? payload.requestId.trim() : null;
  if (!requestId) {
    issues.push({
      path: 'requestId',
      code: 'required',
      message: 'requestId is required.'
    });
  }

  const actorWallet = normalizeWalletAddress(payload?.actorWallet);
  if (!actorWallet) {
    issues.push({
      path: 'actorWallet',
      code: 'invalid_wallet',
      message: 'actorWallet must be a valid EVM wallet address.'
    });
  }

  const grant = payload?.grant;
  if (!grant || typeof grant !== 'object' || Array.isArray(grant)) {
    issues.push({
      path: 'grant',
      code: 'required',
      message: 'grant object is required.'
    });
  }

  const targetWallet = normalizeWalletAddress(grant?.walletAddress);
  if (!targetWallet) {
    issues.push({
      path: 'grant.walletAddress',
      code: 'invalid_wallet',
      message: 'grant.walletAddress must be a valid EVM wallet address.'
    });
  }

  const scopeType = normalizeScopeType(grant?.scopeType);
  if (!scopeType) {
    issues.push({
      path: 'grant.scopeType',
      code: 'invalid_scope_type',
      message: `grant.scopeType must be one of: ${SCOPE_TYPES.join(', ')}.`
    });
  }

  const scopeId = normalizeScopeId(scopeType, grant?.scopeId);
  if (!scopeId) {
    issues.push({
      path: 'grant.scopeId',
      code: 'invalid_scope_id',
      message: 'grant.scopeId is required for table scope and must match [a-z][a-z0-9_]{0,62}.'
    });
  }

  const operation = normalizeOperation(grant?.operation);
  if (!operation) {
    issues.push({
      path: 'grant.operation',
      code: 'invalid_operation',
      message: `grant.operation must be one of: ${OPERATION_TYPES.join(', ')}.`
    });
  }

  const effect = normalizeEffect(grant?.effect);
  if (!effect) {
    issues.push({
      path: 'grant.effect',
      code: 'invalid_effect',
      message: `grant.effect must be one of: ${EFFECT_TYPES.join(', ')}.`
    });
  }

  return {
    ok: issues.length === 0,
    issues,
    normalized: {
      requestId,
      tenantId,
      actorWallet,
      grant: {
        walletAddress: targetWallet,
        scopeType,
        scopeId,
        operation,
        effect
      }
    }
  };
}

function normalizeRevokePayload(payload) {
  const issues = [];
  const tenantId = normalizeTenantId(payload?.tenantId);
  if (!tenantId) {
    issues.push({
      path: 'tenantId',
      code: 'invalid_tenant_id',
      message: 'tenantId is required and must match [a-z0-9][a-z0-9_-]{0,62}.'
    });
  }

  const requestId = isNonEmptyString(payload?.requestId) ? payload.requestId.trim() : null;
  if (!requestId) {
    issues.push({
      path: 'requestId',
      code: 'required',
      message: 'requestId is required.'
    });
  }

  const actorWallet = normalizeWalletAddress(payload?.actorWallet);
  if (!actorWallet) {
    issues.push({
      path: 'actorWallet',
      code: 'invalid_wallet',
      message: 'actorWallet must be a valid EVM wallet address.'
    });
  }

  const grantId = isNonEmptyString(payload?.grantId) ? payload.grantId.trim() : null;
  if (!grantId) {
    issues.push({
      path: 'grantId',
      code: 'required',
      message: 'grantId is required.'
    });
  }

  const expectedSignatureHash = isNonEmptyString(payload?.expectedSignatureHash)
    ? payload.expectedSignatureHash.trim()
    : null;

  return {
    ok: issues.length === 0,
    issues,
    normalized: {
      requestId,
      tenantId,
      actorWallet,
      grantId,
      expectedSignatureHash
    }
  };
}

function normalizePreviewPayload(payload) {
  const issues = [];
  const tenantId = normalizeTenantId(payload?.tenantId);
  if (!tenantId) {
    issues.push({
      path: 'tenantId',
      code: 'invalid_tenant_id',
      message: 'tenantId is required and must match [a-z0-9][a-z0-9_-]{0,62}.'
    });
  }

  const walletAddress = normalizeWalletAddress(payload?.walletAddress);
  if (!walletAddress) {
    issues.push({
      path: 'walletAddress',
      code: 'invalid_wallet',
      message: 'walletAddress must be a valid EVM wallet address.'
    });
  }

  const scopeType = normalizeScopeType(payload?.scopeType);
  if (!scopeType) {
    issues.push({
      path: 'scopeType',
      code: 'invalid_scope_type',
      message: `scopeType must be one of: ${SCOPE_TYPES.join(', ')}.`
    });
  }

  const scopeId = normalizeScopeId(scopeType, payload?.scopeId);
  if (!scopeId) {
    issues.push({
      path: 'scopeId',
      code: 'invalid_scope_id',
      message: 'scopeId is required for table scope and must match [a-z][a-z0-9_]{0,62}.'
    });
  }

  const operation = normalizeOperation(payload?.operation);
  if (!operation || operation === 'all') {
    issues.push({
      path: 'operation',
      code: 'invalid_operation',
      message: `operation must be one of: ${POLICY_REQUEST_OPERATIONS.join(', ')}.`
    });
  }

  return {
    ok: issues.length === 0,
    issues,
    normalized: {
      tenantId,
      walletAddress,
      scopeType,
      scopeId,
      operation
    }
  };
}

function isValidBootstrapGrant({ actorWallet, grant }) {
  return (
    actorWallet === grant.walletAddress &&
    grant.scopeType === 'database' &&
    grant.scopeId === '*' &&
    grant.operation === 'all' &&
    grant.effect === 'allow'
  );
}

async function evaluateActorAuthorityForGrant({ grantStore, tenantId, actorWallet, grant }) {
  const actorGrants = await grantStore.listActiveGrants({
    tenantId,
    walletAddress: actorWallet
  });

  const operationsToCheck =
    grant.operation === 'all' ? POLICY_REQUEST_OPERATIONS : [grant.operation];

  const evaluation = [];
  for (const operation of operationsToCheck) {
    const decisionResult = evaluatePolicyDecision({
      tenantId,
      walletAddress: actorWallet,
      scopeType: grant.scopeType,
      scopeId: grant.scopeId,
      operation,
      grants: actorGrants
    });

    if (!decisionResult.ok) {
      return {
        allowed: false,
        code: 'AUTHORITY_EVALUATION_FAILED',
        message: 'Unable to evaluate actor authority for policy mutation.',
        evaluation
      };
    }

    evaluation.push({
      operation,
      decision: decisionResult.decision
    });

    if (!decisionResult.decision.allowed) {
      return {
        allowed: false,
        code: 'SELF_ESCALATION_BLOCKED',
        message: `Actor does not hold '${operation}' permission required for this mutation.`,
        evaluation
      };
    }
  }

  return {
    allowed: true,
    code: 'ACTOR_AUTHORIZED',
    message: 'Actor holds all required permissions for this mutation.',
    evaluation
  };
}

export function createPolicyAdminService({
  grantStore,
  mutationAuthService,
  runtimeAttestationService = createPermissiveRuntimeAttestationService(),
  now = () => new Date().toISOString()
}) {
  if (!grantStore) {
    throw new Error('grantStore is required.');
  }

  if (!mutationAuthService) {
    throw new Error('mutationAuthService is required.');
  }

  async function createGrant(payload) {
    const normalizedPayload = normalizeCreateGrantPayload(payload);
    if (!normalizedPayload.ok) {
      return validationError('Invalid grant mutation payload.', normalizedPayload.issues);
    }

    const runtimeCheck = await runtimeAttestationService.checkAccess({
      action: 'policy:grant:create',
      sensitive: true
    });
    if (!runtimeCheck.allowed) {
      return serviceError(
        runtimeCheck.code || 'RUNTIME_VERIFICATION_FAILED',
        runtimeCheck.message ||
          'Sensitive operation denied because runtime verification failed.',
        runtimeCheck.statusCode || 503,
        {
          runtime: runtimeCheck.snapshot || null
        }
      );
    }

    const authResult = await mutationAuthService.authenticate({
      requestId: normalizedPayload.normalized.requestId,
      tenantId: normalizedPayload.normalized.tenantId,
      actorWallet: normalizedPayload.normalized.actorWallet,
      action: 'grant:create',
      payload: payload.grant,
      auth: payload.auth
    });

    if (!authResult.ok) {
      return serviceError(authResult.code, authResult.message, authResult.statusCode || 401);
    }

    const activeGrantCount = await grantStore.countActiveGrants(
      normalizedPayload.normalized.tenantId
    );

    let authorityResult;
    if (activeGrantCount === 0) {
      if (!isValidBootstrapGrant(normalizedPayload.normalized)) {
        return serviceError(
          'BOOTSTRAP_REQUIRED',
          'First tenant grant must be self-issued database all allow grant.',
          403
        );
      }

      authorityResult = {
        allowed: true,
        code: 'BOOTSTRAP_ALLOWED',
        message: 'Bootstrap policy-admin grant accepted for empty tenant.',
        evaluation: []
      };
    } else {
      authorityResult = await evaluateActorAuthorityForGrant({
        grantStore,
        tenantId: normalizedPayload.normalized.tenantId,
        actorWallet: authResult.actorWallet,
        grant: normalizedPayload.normalized.grant
      });

      if (!authorityResult.allowed) {
        return serviceError(
          authorityResult.code,
          authorityResult.message,
          403,
          {
            actorAuthority: authorityResult
          }
        );
      }
    }

    const existingGrant = await grantStore.findActiveEquivalent({
      tenantId: normalizedPayload.normalized.tenantId,
      ...normalizedPayload.normalized.grant
    });

    if (existingGrant) {
      return serviceError(
        'GRANT_ALREADY_ACTIVE',
        'Equivalent active grant already exists.',
        409,
        { grant: existingGrant }
      );
    }

    const createdAt = now();
    const createdGrant = await grantStore.createGrant({
      tenantId: normalizedPayload.normalized.tenantId,
      ...normalizedPayload.normalized.grant,
      createdBy: authResult.actorWallet,
      createdAt,
      signatureHash: authResult.signatureHash
    });

    return {
      statusCode: 201,
      body: {
        code: 'GRANT_CREATED',
        message: 'Grant created.',
        grant: createdGrant,
        actorAuthority: authorityResult,
        runtime: runtimeCheck.snapshot || null
      }
    };
  }

  async function revokeGrant(payload) {
    const normalizedPayload = normalizeRevokePayload(payload);
    if (!normalizedPayload.ok) {
      return validationError('Invalid revoke payload.', normalizedPayload.issues);
    }

    const runtimeCheck = await runtimeAttestationService.checkAccess({
      action: 'policy:grant:revoke',
      sensitive: true
    });
    if (!runtimeCheck.allowed) {
      return serviceError(
        runtimeCheck.code || 'RUNTIME_VERIFICATION_FAILED',
        runtimeCheck.message ||
          'Sensitive operation denied because runtime verification failed.',
        runtimeCheck.statusCode || 503,
        {
          runtime: runtimeCheck.snapshot || null
        }
      );
    }

    const authResult = await mutationAuthService.authenticate({
      requestId: normalizedPayload.normalized.requestId,
      tenantId: normalizedPayload.normalized.tenantId,
      actorWallet: normalizedPayload.normalized.actorWallet,
      action: 'grant:revoke',
      payload: {
        grantId: normalizedPayload.normalized.grantId,
        expectedSignatureHash: normalizedPayload.normalized.expectedSignatureHash
      },
      auth: payload.auth
    });

    if (!authResult.ok) {
      return serviceError(authResult.code, authResult.message, authResult.statusCode || 401);
    }

    const existingGrant = await grantStore.getGrantById({
      tenantId: normalizedPayload.normalized.tenantId,
      grantId: normalizedPayload.normalized.grantId
    });

    if (!existingGrant) {
      return serviceError('GRANT_NOT_FOUND', 'Grant was not found for tenant.', 404);
    }

    if (existingGrant.revokedAt) {
      return serviceError('GRANT_ALREADY_REVOKED', 'Grant is already revoked.', 409, {
        grant: existingGrant
      });
    }

    if (
      normalizedPayload.normalized.expectedSignatureHash &&
      normalizedPayload.normalized.expectedSignatureHash !== existingGrant.signatureHash
    ) {
      return serviceError(
        'TAMPER_CHECK_FAILED',
        'Grant signature hash does not match expected value.',
        409
      );
    }

    const authorityResult = await evaluateActorAuthorityForGrant({
      grantStore,
      tenantId: normalizedPayload.normalized.tenantId,
      actorWallet: authResult.actorWallet,
      grant: {
        scopeType: existingGrant.scopeType,
        scopeId: existingGrant.scopeId,
        operation: existingGrant.operation,
        effect: existingGrant.effect
      }
    });

    if (!authorityResult.allowed) {
      return serviceError(
        'REVOKE_NOT_AUTHORIZED',
        'Actor is not authorized to revoke this grant.',
        403,
        {
          actorAuthority: authorityResult
        }
      );
    }

    const revokedAt = now();
    const revoked = await grantStore.revokeGrant({
      tenantId: normalizedPayload.normalized.tenantId,
      grantId: normalizedPayload.normalized.grantId,
      revokedBy: authResult.actorWallet,
      revokedAt
    });

    if (!revoked) {
      return serviceError('REVOKE_CONFLICT', 'Grant revocation conflicted with current state.', 409);
    }

    const updatedGrant = await grantStore.getGrantById({
      tenantId: normalizedPayload.normalized.tenantId,
      grantId: normalizedPayload.normalized.grantId
    });

    return {
      statusCode: 200,
      body: {
        code: 'GRANT_REVOKED',
        message: 'Grant revoked.',
        grant: updatedGrant,
        actorAuthority: authorityResult,
        runtime: runtimeCheck.snapshot || null
      }
    };
  }

  async function listGrants({ tenantId, walletAddress = null }) {
    const safeTenantId = normalizeTenantId(tenantId);
    if (!safeTenantId) {
      return validationError('Invalid query parameters.', [
        {
          path: 'tenantId',
          code: 'invalid_tenant_id',
          message: 'tenantId is required and must match [a-z0-9][a-z0-9_-]{0,62}.'
        }
      ]);
    }

    const safeWallet = walletAddress ? normalizeWalletAddress(walletAddress) : null;
    if (walletAddress && !safeWallet) {
      return validationError('Invalid query parameters.', [
        {
          path: 'walletAddress',
          code: 'invalid_wallet',
          message: 'walletAddress must be a valid EVM wallet address when provided.'
        }
      ]);
    }

    const grants = await grantStore.listActiveGrants({
      tenantId: safeTenantId,
      walletAddress: safeWallet
    });

    return {
      statusCode: 200,
      body: {
        code: 'GRANTS_LISTED',
        grants
      }
    };
  }

  async function previewDecision(payload) {
    const normalizedPayload = normalizePreviewPayload(payload);
    if (!normalizedPayload.ok) {
      return validationError('Invalid policy preview payload.', normalizedPayload.issues);
    }

    const grants = await grantStore.listActiveGrants({
      tenantId: normalizedPayload.normalized.tenantId,
      walletAddress: normalizedPayload.normalized.walletAddress
    });

    const decisionResult = evaluatePolicyDecision({
      ...normalizedPayload.normalized,
      grants
    });

    if (!decisionResult.ok) {
      return serviceError(
        decisionResult.error.error,
        decisionResult.error.message,
        400,
        decisionResult.error.details || null
      );
    }

    return {
      statusCode: 200,
      body: {
        code: 'POLICY_DECISION_PREVIEW',
        decision: decisionResult.decision
      }
    };
  }

  return {
    createGrant,
    revokeGrant,
    listGrants,
    previewDecision
  };
}

const runtimeConfig = loadConfig();
let runtimePolicyAdminServicePromise = null;

async function buildRuntimePolicyAdminService() {
  const databaseAdapter = await createDatabaseAdapter(runtimeConfig.database);
  const grantStore = createPolicyGrantStore({ databaseAdapter });
  await grantStore.ensureInitialized();

  return createPolicyAdminService({
    grantStore,
    mutationAuthService: createPolicyMutationAuthService({
      ...runtimeConfig.auth,
      enabled: true
    }),
    runtimeAttestationService: createRuntimeAttestationService(runtimeConfig.proof)
  });
}

async function getRuntimePolicyAdminService() {
  if (!runtimePolicyAdminServicePromise) {
    runtimePolicyAdminServicePromise = buildRuntimePolicyAdminService().catch((error) => {
      runtimePolicyAdminServicePromise = null;
      throw error;
    });
  }

  return runtimePolicyAdminServicePromise;
}

function serviceUnavailable(message) {
  return serviceError(
    'SERVICE_UNAVAILABLE',
    message || 'Policy admin service failed to initialize database adapter.',
    503
  );
}

export async function handleCreatePolicyGrantRequest(payload, overrides = null) {
  try {
    const service = overrides?.policyAdminService || (await getRuntimePolicyAdminService());
    return await service.createGrant(payload);
  } catch (error) {
    return serviceUnavailable(error?.message);
  }
}

export async function handleRevokePolicyGrantRequest(payload, overrides = null) {
  try {
    const service = overrides?.policyAdminService || (await getRuntimePolicyAdminService());
    return await service.revokeGrant(payload);
  } catch (error) {
    return serviceUnavailable(error?.message);
  }
}

export async function handleListPolicyGrantsRequest(query = {}, overrides = null) {
  try {
    const service = overrides?.policyAdminService || (await getRuntimePolicyAdminService());
    return await service.listGrants(query);
  } catch (error) {
    return serviceUnavailable(error?.message);
  }
}

export async function handlePolicyPreviewDecisionRequest(payload, overrides = null) {
  try {
    const service = overrides?.policyAdminService || (await getRuntimePolicyAdminService());
    return await service.previewDecision(payload);
  } catch (error) {
    return serviceUnavailable(error?.message);
  }
}
