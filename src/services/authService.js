import { getAddress, verifyMessage } from 'ethers';

const SIGNING_CONTEXT = 'PRIVATE_DB_AGENT_AUTH_V1';
const DEFAULT_MAX_NONCE_ENTRIES = 50_000;
const DEFAULT_NONCE_TTL_SECONDS = 300;
const DEFAULT_MAX_FUTURE_SKEW_SECONDS = 60;
const MAX_NONCE_LENGTH = 128;

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

function normalizeAddress(address) {
  try {
    return getAddress(address);
  } catch {
    return null;
  }
}

function validateAuthEnvelope(payload) {
  if (!payload.auth || typeof payload.auth !== 'object' || Array.isArray(payload.auth)) {
    return {
      ok: false,
      code: 'MISSING_AUTH',
      message: 'auth object is required.'
    };
  }

  if (typeof payload.auth.signature !== 'string' || payload.auth.signature.length === 0) {
    return {
      ok: false,
      code: 'MISSING_SIGNATURE',
      message: 'auth.signature is required.'
    };
  }

  if (typeof payload.auth.nonce !== 'string' || payload.auth.nonce.trim().length === 0) {
    return {
      ok: false,
      code: 'MISSING_NONCE',
      message: 'auth.nonce is required.'
    };
  }

  if (payload.auth.nonce.length > MAX_NONCE_LENGTH) {
    return {
      ok: false,
      code: 'INVALID_NONCE',
      message: `auth.nonce must be <= ${MAX_NONCE_LENGTH} characters.`
    };
  }

  if (typeof payload.auth.signedAt !== 'string' || payload.auth.signedAt.length === 0) {
    return {
      ok: false,
      code: 'MISSING_SIGNED_AT',
      message: 'auth.signedAt is required.'
    };
  }

  return { ok: true };
}

function parseTimestamp(signedAt) {
  const signedAtMs = Date.parse(signedAt);

  if (!Number.isFinite(signedAtMs)) {
    return {
      ok: false,
      code: 'INVALID_SIGNED_AT',
      message: 'auth.signedAt must be a valid ISO-8601 timestamp.'
    };
  }

  return {
    ok: true,
    signedAtMs
  };
}

function validateTimestampWindow(signedAtMs, nowMs, authConfig) {
  const nonceTtlMs = authConfig.nonceTtlSeconds * 1000;
  const maxFutureSkewMs = authConfig.maxFutureSkewSeconds * 1000;

  if (signedAtMs > nowMs + maxFutureSkewMs) {
    return {
      ok: false,
      code: 'SIGNED_AT_IN_FUTURE',
      message: 'signedAt is outside allowed future clock skew.'
    };
  }

  if (nowMs - signedAtMs > nonceTtlMs) {
    return {
      ok: false,
      code: 'SIGNATURE_EXPIRED',
      message: 'signedAt is older than nonce TTL.'
    };
  }

  return {
    ok: true,
    expiresAtMs: signedAtMs + nonceTtlMs
  };
}

export class NonceStore {
  constructor(maxEntries = DEFAULT_MAX_NONCE_ENTRIES) {
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  consume(requester, nonce, expiresAtMs, nowMs) {
    this.pruneExpired(nowMs);

    const key = `${requester.toLowerCase()}:${nonce}`;
    const existingExpiry = this.entries.get(key);

    if (existingExpiry && existingExpiry > nowMs) {
      return false;
    }

    this.entries.set(key, expiresAtMs);

    if (this.entries.size > this.maxEntries) {
      this.enforceLimit();
    }

    return true;
  }

  pruneExpired(nowMs) {
    for (const [key, expiry] of this.entries) {
      if (expiry <= nowMs) {
        this.entries.delete(key);
      }
    }
  }

  enforceLimit() {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) {
        break;
      }
      this.entries.delete(oldestKey);
    }
  }
}

export function buildSignedMessage(payload) {
  const envelope = {
    requestId: payload.requestId,
    requester: payload.requester,
    capability: payload.capability,
    queryTemplate: payload.queryTemplate,
    queryParams: payload.queryParams || {},
    nonce: payload.auth.nonce,
    signedAt: payload.auth.signedAt
  };

  return `${SIGNING_CONTEXT}\n${stableStringify(envelope)}`;
}

export function createAuthService(
  rawAuthConfig = {},
  { nonceStore = new NonceStore(), now = () => Date.now() } = {}
) {
  const authConfig = {
    enabled: rawAuthConfig.enabled !== undefined ? Boolean(rawAuthConfig.enabled) : true,
    nonceTtlSeconds: rawAuthConfig.nonceTtlSeconds || DEFAULT_NONCE_TTL_SECONDS,
    maxFutureSkewSeconds:
      rawAuthConfig.maxFutureSkewSeconds || DEFAULT_MAX_FUTURE_SKEW_SECONDS
  };

  async function authenticate(payload) {
    const requester = normalizeAddress(payload.requester);
    if (!requester) {
      return {
        ok: false,
        code: 'INVALID_REQUESTER',
        message: 'requester must be a valid EVM address.'
      };
    }

    if (!authConfig.enabled) {
      return {
        ok: true,
        requester,
        authBypassed: true
      };
    }

    const envelopeValidation = validateAuthEnvelope(payload);
    if (!envelopeValidation.ok) {
      return envelopeValidation;
    }

    const timestamp = parseTimestamp(payload.auth.signedAt);
    if (!timestamp.ok) {
      return timestamp;
    }

    const nowMs = now();
    const freshness = validateTimestampWindow(timestamp.signedAtMs, nowMs, authConfig);
    if (!freshness.ok) {
      return freshness;
    }

    const signedMessage = buildSignedMessage({ ...payload, requester });

    let recoveredAddress;
    try {
      recoveredAddress = verifyMessage(signedMessage, payload.auth.signature);
    } catch {
      return {
        ok: false,
        code: 'INVALID_SIGNATURE_FORMAT',
        message: 'auth.signature is not a valid wallet signature.'
      };
    }

    const normalizedRecovered = normalizeAddress(recoveredAddress);
    if (normalizedRecovered !== requester) {
      return {
        ok: false,
        code: 'SIGNER_MISMATCH',
        message: 'Signature does not match requester address.'
      };
    }

    const nonceAccepted = nonceStore.consume(
      requester,
      payload.auth.nonce,
      freshness.expiresAtMs,
      nowMs
    );

    if (!nonceAccepted) {
      return {
        ok: false,
        code: 'NONCE_REPLAY',
        message: 'auth.nonce has already been used within TTL window.'
      };
    }

    return {
      ok: true,
      requester,
      signedAt: payload.auth.signedAt,
      nonce: payload.auth.nonce,
      signedMessage
    };
  }

  return {
    authenticate
  };
}
