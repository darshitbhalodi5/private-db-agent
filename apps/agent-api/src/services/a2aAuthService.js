import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { NonceStore } from './authService.js';

const SIGNING_CONTEXT = 'PRIVATE_DB_AGENT_A2A_V1';
const MAX_HEADER_VALUE_LENGTH = 256;

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

function normalizeHeaderValue(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_HEADER_VALUE_LENGTH) {
    return null;
  }

  return normalized;
}

function normalizeAgentId(value) {
  const normalized = normalizeHeaderValue(value);
  if (!normalized) {
    return null;
  }

  return normalized.toLowerCase();
}

function normalizeSignature(value) {
  const normalized = normalizeHeaderValue(value);
  if (!normalized) {
    return null;
  }

  return normalized.toLowerCase();
}

function normalizeIsoTimestamp(value) {
  const normalized = normalizeHeaderValue(value);
  if (!normalized) {
    return null;
  }

  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return normalized;
}

function normalizeIdempotencyKey(value) {
  return normalizeHeaderValue(value);
}

function normalizeNonce(value) {
  return normalizeHeaderValue(value);
}

function getHeader(headers, headerName) {
  if (!headers) {
    return '';
  }

  const value = headers[headerName] ?? headers[headerName.toLowerCase()] ?? '';
  if (Array.isArray(value)) {
    return value[0] || '';
  }

  return String(value || '');
}

function normalizeAllowedSet(values = []) {
  return new Set(
    values
      .map((value) => String(value || '').trim().toLowerCase())
      .filter((value) => value.length > 0)
  );
}

function validateFreshness({ timestamp, nowMs, nonceTtlSeconds, maxFutureSkewSeconds }) {
  const timestampMs = Date.parse(timestamp);
  const ttlMs = nonceTtlSeconds * 1000;
  const maxFutureSkewMs = maxFutureSkewSeconds * 1000;

  if (timestampMs > nowMs + maxFutureSkewMs) {
    return {
      ok: false,
      code: 'A2A_TIMESTAMP_IN_FUTURE',
      message: 'x-agent-timestamp is outside allowed future clock skew.',
      statusCode: 401
    };
  }

  if (nowMs - timestampMs > ttlMs) {
    return {
      ok: false,
      code: 'A2A_SIGNATURE_EXPIRED',
      message: 'x-agent-timestamp is older than configured TTL.',
      statusCode: 401
    };
  }

  return {
    ok: true,
    expiresAtMs: timestampMs + ttlMs
  };
}

export function buildA2aSigningMessage({
  agentId,
  method,
  path,
  timestamp,
  nonce,
  correlationId,
  idempotencyKey,
  payloadHash
}) {
  const envelope = {
    agentId,
    method: String(method || '').toUpperCase(),
    path: String(path || ''),
    timestamp,
    nonce,
    correlationId: correlationId || null,
    idempotencyKey: idempotencyKey || null,
    payloadHash
  };

  return `${SIGNING_CONTEXT}\n${stableStringify(envelope)}`;
}

function signMessage(message, secret) {
  return createHmac('sha256', secret).update(message).digest('hex');
}

function safeEqualHex(left, right) {
  try {
    const leftBuffer = Buffer.from(left, 'hex');
    const rightBuffer = Buffer.from(right, 'hex');
    if (leftBuffer.length === 0 || rightBuffer.length === 0) {
      return false;
    }
    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
  } catch {
    return false;
  }
}

function authFailure(code, message, statusCode = 401, details = null) {
  return {
    ok: false,
    statusCode,
    code,
    message,
    ...(details ? { details } : {})
  };
}

export function createA2aAuthService(
  rawA2aConfig = {},
  { nonceStore = new NonceStore(), now = () => Date.now() } = {}
) {
  const authConfig = {
    enabled: rawA2aConfig.enabled !== undefined ? Boolean(rawA2aConfig.enabled) : true,
    allowUnsigned:
      rawA2aConfig.allowUnsigned !== undefined ? Boolean(rawA2aConfig.allowUnsigned) : false,
    sharedSecret: String(rawA2aConfig.sharedSecret || ''),
    allowedAgentIds: normalizeAllowedSet(rawA2aConfig.allowedAgentIds || []),
    adminAgentIds: normalizeAllowedSet(rawA2aConfig.adminAgentIds || []),
    taskAllowlist:
      rawA2aConfig.taskAllowlist && typeof rawA2aConfig.taskAllowlist === 'object'
        ? rawA2aConfig.taskAllowlist
        : {},
    nonceTtlSeconds: Number(rawA2aConfig.nonceTtlSeconds || 300),
    maxFutureSkewSeconds: Number(rawA2aConfig.maxFutureSkewSeconds || 60)
  };

  function resolveTaskAllowlist(agentId) {
    const direct = authConfig.taskAllowlist[agentId];
    const wildcard = authConfig.taskAllowlist['*'];
    const source = Array.isArray(direct) ? direct : Array.isArray(wildcard) ? wildcard : null;
    if (!source) {
      return null;
    }

    return new Set(source.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  }

  function authorizeTaskType(agentId, taskType) {
    const normalizedAgentId = normalizeAgentId(agentId);
    const normalizedTaskType = String(taskType || '').trim().toLowerCase();
    if (!normalizedAgentId || !normalizedTaskType) {
      return authFailure(
        'A2A_AUTHORIZATION_FAILED',
        'Unable to evaluate task authorization for agent.',
        403
      );
    }

    const allowlist = resolveTaskAllowlist(normalizedAgentId);
    if (!allowlist) {
      return {
        ok: true
      };
    }

    if (!allowlist.has(normalizedTaskType)) {
      return authFailure(
        'A2A_TASK_NOT_ALLOWED',
        `Agent '${normalizedAgentId}' is not allowed to execute task '${normalizedTaskType}'.`,
        403
      );
    }

    return {
      ok: true
    };
  }

  function canReadTask(agentId, ownerAgentId) {
    const safeAgentId = normalizeAgentId(agentId);
    const safeOwnerAgentId = normalizeAgentId(ownerAgentId);
    if (!safeAgentId || !safeOwnerAgentId) {
      return false;
    }

    if (safeAgentId === safeOwnerAgentId) {
      return true;
    }

    return authConfig.adminAgentIds.has(safeAgentId);
  }

  async function authenticate({
    method,
    path,
    headers,
    body,
    correlationId = null,
    idempotencyKey = null
  }) {
    if (!authConfig.enabled) {
      return {
        ok: true,
        agentId: 'anonymous-agent',
        authBypassed: true
      };
    }

    const agentId = normalizeAgentId(getHeader(headers, 'x-agent-id'));
    if (!agentId) {
      return authFailure('A2A_MISSING_AGENT_ID', 'x-agent-id header is required.', 401);
    }

    if (
      authConfig.allowedAgentIds.size > 0 &&
      !authConfig.allowedAgentIds.has(agentId) &&
      !authConfig.adminAgentIds.has(agentId)
    ) {
      return authFailure('A2A_AGENT_NOT_ALLOWED', `Agent '${agentId}' is not allowed.`, 403);
    }

    if (authConfig.allowUnsigned) {
      return {
        ok: true,
        agentId
      };
    }

    if (!authConfig.sharedSecret) {
      return authFailure(
        'A2A_AUTH_NOT_CONFIGURED',
        'A2A shared secret is not configured while unsigned mode is disabled.',
        503
      );
    }

    const signature = normalizeSignature(getHeader(headers, 'x-agent-signature'));
    const timestamp = normalizeIsoTimestamp(getHeader(headers, 'x-agent-timestamp'));
    const nonce = normalizeNonce(getHeader(headers, 'x-agent-nonce'));
    const safeIdempotencyKey =
      normalizeIdempotencyKey(idempotencyKey || getHeader(headers, 'x-idempotency-key')) || null;

    if (!signature) {
      return authFailure(
        'A2A_MISSING_SIGNATURE',
        'x-agent-signature header is required for signed A2A requests.',
        401
      );
    }
    if (!timestamp) {
      return authFailure(
        'A2A_MISSING_TIMESTAMP',
        'x-agent-timestamp header is required and must be valid ISO timestamp.',
        401
      );
    }
    if (!nonce) {
      return authFailure('A2A_MISSING_NONCE', 'x-agent-nonce header is required.', 401);
    }

    const nowMs = now();
    const freshness = validateFreshness({
      timestamp,
      nowMs,
      nonceTtlSeconds: authConfig.nonceTtlSeconds,
      maxFutureSkewSeconds: authConfig.maxFutureSkewSeconds
    });
    if (!freshness.ok) {
      return freshness;
    }

    const payloadHash = hashPayload(body || {});
    const message = buildA2aSigningMessage({
      agentId,
      method,
      path,
      timestamp,
      nonce,
      correlationId,
      idempotencyKey: safeIdempotencyKey,
      payloadHash
    });
    const expectedSignature = signMessage(message, authConfig.sharedSecret);
    if (!safeEqualHex(signature, expectedSignature)) {
      return authFailure('A2A_SIGNATURE_MISMATCH', 'A2A signature verification failed.', 401);
    }

    const nonceAccepted = nonceStore.consume(
      agentId,
      nonce,
      freshness.expiresAtMs,
      nowMs
    );
    if (!nonceAccepted) {
      return authFailure('A2A_NONCE_REPLAY', 'x-agent-nonce has already been used.', 401);
    }

    return {
      ok: true,
      agentId,
      signature,
      timestamp,
      nonce,
      payloadHash,
      idempotencyKey: safeIdempotencyKey
    };
  }

  return {
    authenticate,
    authorizeTaskType,
    canReadTask
  };
}
