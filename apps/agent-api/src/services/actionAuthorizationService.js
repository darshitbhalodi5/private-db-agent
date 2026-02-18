import { OPERATION_TYPES, SCOPE_TYPES } from '@eigen-private-db-agent/shared-types';
import { evaluatePolicyDecision } from './policyDecisionEngine.js';

const REQUEST_OPERATIONS = OPERATION_TYPES.filter((operation) => operation !== 'all');
const FORBIDDEN_OVERRIDE_KEYS = Object.freeze([
  'agentOverride',
  'bypassPolicy',
  'skipAuth',
  'executeAsAgent',
  'superuser',
  'trustedOperator'
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeScopeType(rawScopeType) {
  const normalized = String(rawScopeType || '').trim().toLowerCase();
  return SCOPE_TYPES.includes(normalized) ? normalized : null;
}

function normalizeOperation(rawOperation) {
  const normalized = String(rawOperation || '').trim().toLowerCase();
  return REQUEST_OPERATIONS.includes(normalized) ? normalized : null;
}

function normalizeScopeId(scopeType, rawScopeId) {
  if (scopeType === 'database') {
    return '*';
  }

  if (!isNonEmptyString(rawScopeId)) {
    return null;
  }

  return rawScopeId.trim().toLowerCase();
}

function containsForbiddenOverride(payload) {
  if (!isObject(payload)) {
    return null;
  }

  for (const key of FORBIDDEN_OVERRIDE_KEYS) {
    if (!Object.hasOwn(payload, key)) {
      continue;
    }

    const value = payload[key];
    if (value === false || value === null || value === undefined || value === '') {
      continue;
    }

    return key;
  }

  return null;
}

function validationFailure(message, issues) {
  return {
    ok: false,
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

function authorizationFailure(code, message, statusCode = 403, details = null) {
  return {
    ok: false,
    statusCode,
    body: {
      error: code,
      message,
      ...(details ? { details } : {})
    }
  };
}

export function createActionAuthorizationService({ grantStore, mutationAuthService }) {
  if (!grantStore) {
    throw new Error('grantStore is required.');
  }

  if (!mutationAuthService) {
    throw new Error('mutationAuthService is required.');
  }

  async function authorize({
    requestId,
    tenantId,
    actorWallet,
    auth,
    action,
    actionPayload,
    scopeType,
    scopeId,
    operation
  }) {
    const issues = [];

    if (!isNonEmptyString(requestId)) {
      issues.push({
        path: 'requestId',
        code: 'required',
        message: 'requestId is required.'
      });
    }

    if (!isNonEmptyString(tenantId)) {
      issues.push({
        path: 'tenantId',
        code: 'required',
        message: 'tenantId is required.'
      });
    }

    if (!isNonEmptyString(actorWallet)) {
      issues.push({
        path: 'actorWallet',
        code: 'required',
        message: 'actorWallet is required.'
      });
    }

    if (!isNonEmptyString(action)) {
      issues.push({
        path: 'action',
        code: 'required',
        message: 'action is required.'
      });
    }

    const normalizedScopeType = normalizeScopeType(scopeType);
    if (!normalizedScopeType) {
      issues.push({
        path: 'scopeType',
        code: 'invalid_scope_type',
        message: `scopeType must be one of: ${SCOPE_TYPES.join(', ')}.`
      });
    }

    const normalizedOperation = normalizeOperation(operation);
    if (!normalizedOperation) {
      issues.push({
        path: 'operation',
        code: 'invalid_operation',
        message: `operation must be one of: ${REQUEST_OPERATIONS.join(', ')}.`
      });
    }

    const normalizedScopeId = normalizeScopeId(normalizedScopeType, scopeId);
    if (!normalizedScopeId) {
      issues.push({
        path: 'scopeId',
        code: 'invalid_scope_id',
        message: 'scopeId is required for table scope.'
      });
    }

    if (issues.length > 0) {
      return validationFailure('Invalid authorization request.', issues);
    }

    const forbiddenKey = containsForbiddenOverride(actionPayload);
    if (forbiddenKey) {
      return authorizationFailure(
        'AGENT_PRIVILEGE_ESCALATION_ATTEMPT',
        `Forbidden override flag '${forbiddenKey}' is not allowed.`
      );
    }

    const authResult = await mutationAuthService.authenticate({
      requestId: requestId.trim(),
      tenantId: tenantId.trim().toLowerCase(),
      actorWallet: actorWallet.trim().toLowerCase(),
      action: action.trim(),
      payload: actionPayload || {},
      auth
    });

    if (!authResult.ok) {
      return authorizationFailure(
        authResult.code || 'AUTHENTICATION_FAILED',
        authResult.message || 'Authentication failed.',
        authResult.statusCode || 401
      );
    }

    const grants = await grantStore.listActiveGrants({
      tenantId: tenantId.trim().toLowerCase(),
      walletAddress: authResult.actorWallet
    });

    const decisionResult = evaluatePolicyDecision({
      tenantId: tenantId.trim().toLowerCase(),
      walletAddress: authResult.actorWallet,
      scopeType: normalizedScopeType,
      scopeId: normalizedScopeId,
      operation: normalizedOperation,
      grants
    });

    if (!decisionResult.ok) {
      return authorizationFailure(
        decisionResult.error.error || 'POLICY_DECISION_FAILED',
        decisionResult.error.message || 'Policy decision failed.',
        400,
        decisionResult.error.details || null
      );
    }

    if (!decisionResult.decision.allowed) {
      return authorizationFailure('POLICY_DENIED', decisionResult.decision.message, 403, {
        decision: decisionResult.decision
      });
    }

    return {
      ok: true,
      actorWallet: authResult.actorWallet,
      signatureHash: authResult.signatureHash,
      decision: decisionResult.decision
    };
  }

  return {
    authorize
  };
}
