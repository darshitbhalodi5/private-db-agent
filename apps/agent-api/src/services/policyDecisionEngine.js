import { OPERATION_TYPES, SCOPE_TYPES } from '@eigen-private-db-agent/shared-types';

const REQUEST_OPERATION_TYPES = OPERATION_TYPES.filter((operation) => operation !== 'all');
const EFFECT_TYPES = Object.freeze(['allow', 'deny']);

export const POLICY_REQUEST_OPERATIONS = Object.freeze(REQUEST_OPERATION_TYPES);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeScopeType(rawValue) {
  const normalized = String(rawValue || '').trim().toLowerCase();
  if (!SCOPE_TYPES.includes(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeOperation(rawValue, { allowAll }) {
  const normalized = String(rawValue || '').trim().toLowerCase();
  const allowedOperations = allowAll ? OPERATION_TYPES : REQUEST_OPERATION_TYPES;
  if (!allowedOperations.includes(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeEffect(rawValue) {
  const normalized = String(rawValue || '').trim().toLowerCase();
  if (!EFFECT_TYPES.includes(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeScopeId(rawScopeType, rawScopeId) {
  if (rawScopeType === 'database') {
    return '*';
  }

  if (!isNonEmptyString(rawScopeId)) {
    return null;
  }

  return rawScopeId.trim().toLowerCase();
}

function normalizeGrant(grant) {
  if (!grant || typeof grant !== 'object' || Array.isArray(grant)) {
    return null;
  }

  const scopeType = normalizeScopeType(grant.scopeType || grant.scope_type);
  const scopeId = normalizeScopeId(scopeType, grant.scopeId || grant.scope_id);
  const operation = normalizeOperation(grant.operation, { allowAll: true });
  const effect = normalizeEffect(grant.effect);

  if (
    !isNonEmptyString(grant.grantId || grant.grant_id) ||
    !isNonEmptyString(grant.walletAddress || grant.wallet_address) ||
    !isNonEmptyString(grant.tenantId || grant.tenant_id) ||
    !scopeType ||
    !scopeId ||
    !operation ||
    !effect
  ) {
    return null;
  }

  return {
    grantId: (grant.grantId || grant.grant_id).trim(),
    tenantId: (grant.tenantId || grant.tenant_id).trim(),
    walletAddress: (grant.walletAddress || grant.wallet_address).trim().toLowerCase(),
    scopeType,
    scopeId,
    operation,
    effect,
    createdAt: isNonEmptyString(grant.createdAt || grant.created_at)
      ? (grant.createdAt || grant.created_at).trim()
      : null
  };
}

function sortGrantsForDeterministicMatching(grants) {
  return grants
    .slice()
    .sort((left, right) => {
      const leftCreatedAt = left.createdAt || '';
      const rightCreatedAt = right.createdAt || '';
      if (leftCreatedAt !== rightCreatedAt) {
        return rightCreatedAt.localeCompare(leftCreatedAt, 'en');
      }

      return right.grantId.localeCompare(left.grantId, 'en');
    });
}

function validateDecisionInput(input) {
  const issues = [];

  if (!isNonEmptyString(input.tenantId)) {
    issues.push({
      path: 'tenantId',
      code: 'required',
      message: 'tenantId is required.'
    });
  }

  if (!isNonEmptyString(input.walletAddress)) {
    issues.push({
      path: 'walletAddress',
      code: 'required',
      message: 'walletAddress is required.'
    });
  }

  const scopeType = normalizeScopeType(input.scopeType);
  if (!scopeType) {
    issues.push({
      path: 'scopeType',
      code: 'invalid_scope_type',
      message: `scopeType must be one of: ${SCOPE_TYPES.join(', ')}.`
    });
  }

  const operation = normalizeOperation(input.operation, { allowAll: false });
  if (!operation) {
    issues.push({
      path: 'operation',
      code: 'invalid_operation',
      message: `operation must be one of: ${REQUEST_OPERATION_TYPES.join(', ')}.`
    });
  }

  const scopeId = normalizeScopeId(scopeType, input.scopeId);
  if (!scopeId) {
    issues.push({
      path: 'scopeId',
      code: 'invalid_scope_id',
      message: 'scopeId is required for table scope and must be a non-empty string.'
    });
  }

  return {
    ok: issues.length === 0,
    issues,
    normalized: {
      tenantId: String(input.tenantId || '').trim(),
      walletAddress: String(input.walletAddress || '').trim().toLowerCase(),
      scopeType,
      scopeId,
      operation
    }
  };
}

function findMatchingGrant(grants, { scopeType, scopeId, operation, effect }) {
  return (
    grants.find((grant) => {
      if (grant.scopeType !== scopeType) {
        return false;
      }

      if (grant.scopeId !== scopeId) {
        return false;
      }

      if (grant.operation !== operation) {
        return false;
      }

      if (grant.effect !== effect) {
        return false;
      }

      return true;
    }) || null
  );
}

function evaluationSequenceForScope(scopeType, scopeId, operation) {
  const baseSequence = [
    {
      step: 'DATABASE_OPERATION_DENY',
      criteria: {
        scopeType: 'database',
        scopeId: '*',
        operation,
        effect: 'deny'
      },
      decision: {
        allowed: false,
        code: 'DATABASE_OPERATION_DENY_MATCH',
        message: 'Denied by database-level operation rule.'
      }
    },
    {
      step: 'DATABASE_OPERATION_ALLOW',
      criteria: {
        scopeType: 'database',
        scopeId: '*',
        operation,
        effect: 'allow'
      },
      decision: {
        allowed: true,
        code: 'DATABASE_OPERATION_ALLOW_MATCH',
        message: 'Allowed by database-level operation rule.'
      }
    },
    {
      step: 'DATABASE_ALL_DENY',
      criteria: {
        scopeType: 'database',
        scopeId: '*',
        operation: 'all',
        effect: 'deny'
      },
      decision: {
        allowed: false,
        code: 'DATABASE_ALL_DENY_MATCH',
        message: 'Denied by database-level all-operation rule.'
      }
    },
    {
      step: 'DATABASE_ALL_ALLOW',
      criteria: {
        scopeType: 'database',
        scopeId: '*',
        operation: 'all',
        effect: 'allow'
      },
      decision: {
        allowed: true,
        code: 'DATABASE_ALL_ALLOW_MATCH',
        message: 'Allowed by database-level all-operation rule.'
      }
    }
  ];

  if (scopeType === 'database') {
    return baseSequence;
  }

  return [
    {
      step: 'TABLE_OPERATION_DENY',
      criteria: {
        scopeType: 'table',
        scopeId,
        operation,
        effect: 'deny'
      },
      decision: {
        allowed: false,
        code: 'TABLE_OPERATION_DENY_MATCH',
        message: 'Denied by table-level operation rule.'
      }
    },
    {
      step: 'TABLE_OPERATION_ALLOW',
      criteria: {
        scopeType: 'table',
        scopeId,
        operation,
        effect: 'allow'
      },
      decision: {
        allowed: true,
        code: 'TABLE_OPERATION_ALLOW_MATCH',
        message: 'Allowed by table-level operation rule.'
      }
    },
    ...baseSequence.slice(0, 2),
    {
      step: 'TABLE_ALL_DENY',
      criteria: {
        scopeType: 'table',
        scopeId,
        operation: 'all',
        effect: 'deny'
      },
      decision: {
        allowed: false,
        code: 'TABLE_ALL_DENY_MATCH',
        message: 'Denied by table-level all-operation rule.'
      }
    },
    {
      step: 'TABLE_ALL_ALLOW',
      criteria: {
        scopeType: 'table',
        scopeId,
        operation: 'all',
        effect: 'allow'
      },
      decision: {
        allowed: true,
        code: 'TABLE_ALL_ALLOW_MATCH',
        message: 'Allowed by table-level all-operation rule.'
      }
    },
    ...baseSequence.slice(2)
  ];
}

export function evaluatePolicyDecision({
  tenantId,
  walletAddress,
  scopeType,
  scopeId,
  operation,
  grants = []
}) {
  const inputValidation = validateDecisionInput({
    tenantId,
    walletAddress,
    scopeType,
    scopeId,
    operation
  });

  if (!inputValidation.ok) {
    return {
      ok: false,
      error: {
        error: 'INVALID_POLICY_DECISION_REQUEST',
        message: 'Invalid policy decision input.',
        details: {
          issues: inputValidation.issues
        }
      }
    };
  }

  const normalizedInput = inputValidation.normalized;

  const normalizedGrants = sortGrantsForDeterministicMatching(
    grants
      .map((grant) => normalizeGrant(grant))
      .filter(
        (grant) =>
          Boolean(grant) &&
          grant.tenantId === normalizedInput.tenantId &&
          grant.walletAddress === normalizedInput.walletAddress
      )
  );

  const evaluationPath = [];
  const sequence = evaluationSequenceForScope(
    normalizedInput.scopeType,
    normalizedInput.scopeId,
    normalizedInput.operation
  );

  for (const rule of sequence) {
    const matchedGrant = findMatchingGrant(normalizedGrants, rule.criteria);
    evaluationPath.push({
      step: rule.step,
      matched: Boolean(matchedGrant),
      grantId: matchedGrant?.grantId || null
    });

    if (!matchedGrant) {
      continue;
    }

    return {
      ok: true,
      decision: {
        allowed: rule.decision.allowed,
        code: rule.decision.code,
        message: rule.decision.message,
        matchedGrant,
        evaluationPath
      }
    };
  }

  return {
    ok: true,
    decision: {
      allowed: false,
      code: 'FALLBACK_DENY',
      message: 'No matching grant found. Default deny applies.',
      matchedGrant: null,
      evaluationPath
    }
  };
}
