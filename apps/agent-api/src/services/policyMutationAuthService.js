import { createHash } from 'node:crypto';
import { getAddress, verifyMessage } from 'ethers';
import { NonceStore } from './authService.js';

const SIGNING_CONTEXT = 'PRIVATE_DB_AGENT_POLICY_MUTATION_V1';
const MAX_NONCE_LENGTH = 128;
const DEFAULT_NONCE_TTL_SECONDS = 300;
const DEFAULT_MAX_FUTURE_SKEW_SECONDS = 60;

function normalizeAddress(address) {
  try {
    return getAddress(address).toLowerCase();
  } catch {
    return null;
  }
}

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

function parseSignedAt(rawSignedAt) {
  const signedAtMs = Date.parse(rawSignedAt);
  if (!Number.isFinite(signedAtMs)) {
    return {
      ok: false,
      code: 'INVALID_SIGNED_AT',
      message: 'auth.signedAt must be a valid ISO-8601 timestamp.',
      statusCode: 400
    };
  }

  return {
    ok: true,
    signedAtMs
  };
}

function validateTimeWindow({ signedAtMs, nowMs, nonceTtlSeconds, maxFutureSkewSeconds }) {
  const ttlMs = nonceTtlSeconds * 1000;
  const maxFutureSkewMs = maxFutureSkewSeconds * 1000;

  if (signedAtMs > nowMs + maxFutureSkewMs) {
    return {
      ok: false,
      code: 'SIGNED_AT_IN_FUTURE',
      message: 'signedAt is outside allowed future clock skew.',
      statusCode: 401
    };
  }

  if (nowMs - signedAtMs > ttlMs) {
    return {
      ok: false,
      code: 'SIGNATURE_EXPIRED',
      message: 'signedAt is older than nonce TTL.',
      statusCode: 401
    };
  }

  return {
    ok: true,
    expiresAtMs: signedAtMs + ttlMs
  };
}

export function buildPolicyMutationMessage({
  requestId,
  tenantId,
  actorWallet,
  action,
  payload,
  nonce,
  signedAt
}) {
  const envelope = {
    requestId,
    tenantId,
    actorWallet,
    action,
    payload: payload || {},
    nonce,
    signedAt
  };

  return `${SIGNING_CONTEXT}\n${stableStringify(envelope)}`;
}

function hashSignature(signature) {
  return createHash('sha256').update(String(signature)).digest('hex');
}

export function createPolicyMutationAuthService(
  rawAuthConfig = {},
  { nonceStore = new NonceStore(), now = () => Date.now() } = {}
) {
  const authConfig = {
    enabled: rawAuthConfig.enabled !== undefined ? Boolean(rawAuthConfig.enabled) : true,
    nonceTtlSeconds: rawAuthConfig.nonceTtlSeconds || DEFAULT_NONCE_TTL_SECONDS,
    maxFutureSkewSeconds:
      rawAuthConfig.maxFutureSkewSeconds || DEFAULT_MAX_FUTURE_SKEW_SECONDS
  };

  async function authenticate({ requestId, tenantId, actorWallet, action, payload, auth }) {
    const normalizedActor = normalizeAddress(actorWallet);
    if (!normalizedActor) {
      return {
        ok: false,
        statusCode: 400,
        code: 'INVALID_ACTOR_WALLET',
        message: 'actorWallet must be a valid EVM address.'
      };
    }

    if (!authConfig.enabled) {
      return {
        ok: true,
        actorWallet: normalizedActor,
        signedAt: null,
        nonce: null,
        signatureHash: 'auth-disabled'
      };
    }

    if (!auth || typeof auth !== 'object' || Array.isArray(auth)) {
      return {
        ok: false,
        statusCode: 400,
        code: 'MISSING_AUTH',
        message: 'auth object is required.'
      };
    }

    if (typeof auth.signature !== 'string' || auth.signature.trim().length === 0) {
      return {
        ok: false,
        statusCode: 400,
        code: 'MISSING_SIGNATURE',
        message: 'auth.signature is required.'
      };
    }

    if (typeof auth.nonce !== 'string' || auth.nonce.trim().length === 0) {
      return {
        ok: false,
        statusCode: 400,
        code: 'MISSING_NONCE',
        message: 'auth.nonce is required.'
      };
    }

    if (auth.nonce.length > MAX_NONCE_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        code: 'INVALID_NONCE',
        message: `auth.nonce must be <= ${MAX_NONCE_LENGTH} characters.`
      };
    }

    if (typeof auth.signedAt !== 'string' || auth.signedAt.trim().length === 0) {
      return {
        ok: false,
        statusCode: 400,
        code: 'MISSING_SIGNED_AT',
        message: 'auth.signedAt is required.'
      };
    }

    const timestamp = parseSignedAt(auth.signedAt);
    if (!timestamp.ok) {
      return timestamp;
    }

    const nowMs = now();
    const freshness = validateTimeWindow({
      signedAtMs: timestamp.signedAtMs,
      nowMs,
      nonceTtlSeconds: authConfig.nonceTtlSeconds,
      maxFutureSkewSeconds: authConfig.maxFutureSkewSeconds
    });
    if (!freshness.ok) {
      return freshness;
    }

    const signedMessage = buildPolicyMutationMessage({
      requestId,
      tenantId,
      actorWallet: normalizedActor,
      action,
      payload,
      nonce: auth.nonce,
      signedAt: auth.signedAt
    });

    let recoveredAddress;
    try {
      recoveredAddress = verifyMessage(signedMessage, auth.signature);
    } catch {
      return {
        ok: false,
        statusCode: 401,
        code: 'INVALID_SIGNATURE_FORMAT',
        message: 'auth.signature is not a valid wallet signature.'
      };
    }

    const normalizedRecovered = normalizeAddress(recoveredAddress);
    if (normalizedRecovered !== normalizedActor) {
      return {
        ok: false,
        statusCode: 401,
        code: 'SIGNER_MISMATCH',
        message: 'Signature does not match actorWallet.'
      };
    }

    const nonceAccepted = nonceStore.consume(
      normalizedActor,
      auth.nonce,
      freshness.expiresAtMs,
      nowMs
    );

    if (!nonceAccepted) {
      return {
        ok: false,
        statusCode: 401,
        code: 'NONCE_REPLAY',
        message: 'auth.nonce has already been used within TTL window.'
      };
    }

    return {
      ok: true,
      actorWallet: normalizedActor,
      signedAt: auth.signedAt,
      nonce: auth.nonce,
      signatureHash: hashSignature(auth.signature),
      signedMessage
    };
  }

  return {
    authenticate
  };
}
