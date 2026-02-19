function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function inferStage({ statusCode, code, outcome }) {
  const normalizedCode = String(code || '').trim().toUpperCase();

  if (
    normalizedCode.includes('VALIDATION') ||
    normalizedCode.startsWith('INVALID_') ||
    normalizedCode.includes('RAW_SQL')
  ) {
    return 'validation';
  }

  if (
    normalizedCode.includes('AUTH') ||
    normalizedCode.includes('SIGNATURE') ||
    normalizedCode.includes('SIGNER') ||
    normalizedCode.includes('NONCE')
  ) {
    return 'authentication';
  }

  if (
    normalizedCode.includes('POLICY') ||
    normalizedCode.includes('BOOTSTRAP') ||
    normalizedCode.includes('SELF_ESCALATION') ||
    normalizedCode.includes('REVOKE_NOT_AUTHORIZED') ||
    normalizedCode.includes('TAMPER')
  ) {
    return 'policy';
  }

  if (normalizedCode.includes('RUNTIME')) {
    return 'runtime';
  }

  if (normalizedCode.includes('SERVICE_UNAVAILABLE')) {
    return 'service';
  }

  if (statusCode >= 500) {
    return 'execution';
  }

  if (outcome === 'allow') {
    return 'execution';
  }

  return 'policy';
}

function inferEmbeddedDecision(body) {
  if (isObject(body?.authorization?.decision)) {
    return body.authorization.decision;
  }

  if (isObject(body?.details?.decision)) {
    return body.details.decision;
  }

  return null;
}

function normalizeDecisionEnvelope({ statusCode, body, decision }) {
  const embedded = inferEmbeddedDecision(body);
  const sourceDecision = decision || embedded;

  const fallbackOutcome = statusCode >= 200 && statusCode < 400 ? 'allow' : 'deny';
  const outcome =
    sourceDecision?.outcome ||
    (typeof sourceDecision?.allowed === 'boolean'
      ? sourceDecision.allowed
        ? 'allow'
        : 'deny'
      : fallbackOutcome);

  const code =
    sourceDecision?.code ||
    (typeof body?.error === 'string' && body.error.length > 0
      ? body.error
      : typeof body?.code === 'string' && body.code.length > 0
        ? body.code
        : `HTTP_${statusCode || 'UNKNOWN'}`);

  const message =
    sourceDecision?.message ||
    (typeof body?.message === 'string' && body.message.length > 0 ? body.message : null);

  const stage = sourceDecision?.stage || inferStage({ statusCode, code, outcome });

  return {
    outcome,
    stage,
    code,
    message
  };
}

function normalizeRequester(payload, auditContext) {
  const requesterCandidates = [
    auditContext?.requester,
    payload?.requester,
    payload?.actorWallet,
    payload?.walletAddress
  ];

  for (const candidate of requesterCandidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim().toLowerCase();
    }
  }

  return null;
}

function normalizeAuditPayload(payload, auditContext) {
  const requestId =
    (typeof payload?.requestId === 'string' && payload.requestId.trim()) ||
    (typeof auditContext?.requestId === 'string' && auditContext.requestId.trim()) ||
    null;

  const capability =
    (typeof auditContext?.action === 'string' && auditContext.action.trim()) ||
    (typeof payload?.capability === 'string' && payload.capability.trim()) ||
    (typeof payload?.operation === 'string' && payload.operation.trim()
      ? `data:${payload.operation.trim().toLowerCase()}`
      : null) ||
    'unknown';

  const queryTemplate =
    (typeof auditContext?.resource === 'string' && auditContext.resource.trim()) ||
    (typeof payload?.queryTemplate === 'string' && payload.queryTemplate.trim()) ||
    (typeof payload?.tableName === 'string' && payload.tableName.trim()) ||
    'unknown';

  return {
    requestId,
    capability,
    queryTemplate
  };
}

function createNoopReceiptService() {
  return {
    buildReceipt: () => null
  };
}

function createNoopAuditService() {
  return {
    recordDecision: async () => ({
      logged: false,
      code: 'NO_AUDIT_SERVICE'
    })
  };
}

export async function attachActionResponseEnvelope({
  payload,
  result,
  decision = null,
  auth = null,
  policy = null,
  execution = null,
  runtimeVerification = null,
  auditContext = null,
  receiptService = createNoopReceiptService(),
  auditService = createNoopAuditService(),
  databaseDialect = 'unknown'
}) {
  const safeResult = result || {
    statusCode: 500,
    body: {
      error: 'SERVICE_UNAVAILABLE',
      message: 'Action response is unavailable.'
    }
  };

  const statusCode = Number.isInteger(safeResult.statusCode) ? safeResult.statusCode : 500;
  const body = isObject(safeResult.body) ? safeResult.body : {};

  const decisionEnvelope = normalizeDecisionEnvelope({
    statusCode,
    body,
    decision
  });

  const auditPayload = normalizeAuditPayload(payload, auditContext);
  const requester = normalizeRequester(payload, auditContext);

  const receiptPayload = {
    requestId: auditPayload.requestId,
    requester,
    capability: auditPayload.capability,
    queryTemplate: auditPayload.queryTemplate,
    queryParams: isObject(payload?.queryParams)
      ? payload.queryParams
      : isObject(payload?.values)
        ? payload.values
        : isObject(payload?.filters)
          ? payload.filters
          : {},
    auth: {
      nonce: payload?.auth?.nonce || null,
      signedAt: payload?.auth?.signedAt || null
    }
  };

  const receipt = receiptService.buildReceipt({
    payload: receiptPayload,
    statusCode,
    decision: decisionEnvelope,
    auth,
    policy,
    execution,
    databaseDialect,
    runtimeVerification
  });

  let auditResult;
  try {
    auditResult = await auditService.recordDecision({
      payload: auditPayload,
      requester,
      decision: decisionEnvelope.outcome
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
      decision: decisionEnvelope,
      receipt,
      audit: normalizeAuditResult(auditResult)
    }
  };
}

export { createNoopAuditService, createNoopReceiptService };
