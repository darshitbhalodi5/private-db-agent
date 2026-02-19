import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

const RUNTIME_VERIFICATION_MODES = Object.freeze(['off', 'report-only', 'enforce']);
const RUNTIME_ATTESTATION_SOURCES = Object.freeze(['config', 'file', 'url']);

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

function hashSha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function compactString(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }

  return value.trim();
}

function normalizeVerificationMode(rawMode) {
  const normalized = String(rawMode || '').trim().toLowerCase();
  return RUNTIME_VERIFICATION_MODES.includes(normalized) ? normalized : 'report-only';
}

function normalizeAttestationSource(rawSource) {
  const normalized = String(rawSource || '').trim().toLowerCase();
  return RUNTIME_ATTESTATION_SOURCES.includes(normalized) ? normalized : 'config';
}

function parseTimestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildIssue(code, message) {
  return {
    code,
    message
  };
}

function selectClaimsSource(rawPayload) {
  if (rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)) {
    const nested = rawPayload.attestation;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return nested;
    }

    return rawPayload;
  }

  return null;
}

function normalizeClaims(rawPayload) {
  const source = selectClaimsSource(rawPayload) || {};

  return {
    appId: compactString(source.appId || source.app_id),
    imageDigest: compactString(source.imageDigest || source.image_digest),
    attestationReportHash: compactString(
      source.attestationReportHash || source.attestation_report_hash || source.reportHash
    ),
    onchainDeploymentTxHash: compactString(
      source.onchainDeploymentTxHash || source.onchain_deployment_tx_hash || source.deploymentTxHash
    ),
    issuedAt: compactString(source.issuedAt || source.generatedAt || source.generated_at),
    expiresAt: compactString(source.expiresAt || source.expires_at)
  };
}

function evaluateClaimsVerification(claims, { nowMs, maxAgeSeconds }) {
  const issues = [];
  const requiredFields = ['appId', 'imageDigest', 'attestationReportHash'];

  for (const field of requiredFields) {
    if (!isNonEmptyString(claims[field])) {
      issues.push(buildIssue('MISSING_REQUIRED_CLAIM', `Missing required claim '${field}'.`));
    }
  }

  const issuedAtMs = claims.issuedAt ? parseTimestamp(claims.issuedAt) : null;
  if (claims.issuedAt && issuedAtMs === null) {
    issues.push(buildIssue('INVALID_ISSUED_AT', 'issuedAt must be a valid ISO timestamp.'));
  }

  const expiresAtMs = claims.expiresAt ? parseTimestamp(claims.expiresAt) : null;
  if (claims.expiresAt && expiresAtMs === null) {
    issues.push(buildIssue('INVALID_EXPIRES_AT', 'expiresAt must be a valid ISO timestamp.'));
  }

  if (issuedAtMs !== null && expiresAtMs !== null && expiresAtMs < issuedAtMs) {
    issues.push(buildIssue('INVALID_ATTESTATION_WINDOW', 'expiresAt cannot be earlier than issuedAt.'));
  }

  if (expiresAtMs !== null && nowMs > expiresAtMs) {
    issues.push(buildIssue('ATTESTATION_EXPIRED', 'Attestation has expired.'));
  }

  if (issuedAtMs !== null) {
    const maxAgeMs = Math.max(1, Number(maxAgeSeconds) || 0) * 1000;
    if (nowMs - issuedAtMs > maxAgeMs) {
      issues.push(
        buildIssue(
          'ATTESTATION_TOO_OLD',
          `Attestation age exceeds configured limit (${maxAgeSeconds}s).`
        )
      );
    }
  }

  return {
    verified: issues.length === 0,
    issues
  };
}

const PINNED_CLAIM_FIELDS = Object.freeze([
  'appId',
  'imageDigest',
  'attestationReportHash',
  'onchainDeploymentTxHash'
]);

function normalizeClaimForComparison(field, value) {
  if (!isNonEmptyString(value)) {
    return null;
  }

  if (
    field === 'imageDigest' ||
    field === 'attestationReportHash' ||
    field === 'onchainDeploymentTxHash'
  ) {
    return value.trim().toLowerCase();
  }

  return value.trim();
}

function formatClaimName(field) {
  if (field === 'appId') {
    return 'appId';
  }
  if (field === 'imageDigest') {
    return 'imageDigest';
  }
  if (field === 'attestationReportHash') {
    return 'attestationReportHash';
  }
  if (field === 'onchainDeploymentTxHash') {
    return 'onchainDeploymentTxHash';
  }
  return field;
}

function toIssueCodeForClaimMismatch(field) {
  if (field === 'appId') {
    return 'APP_ID_MISMATCH';
  }
  if (field === 'imageDigest') {
    return 'IMAGE_DIGEST_MISMATCH';
  }
  if (field === 'attestationReportHash') {
    return 'ATTESTATION_REPORT_HASH_MISMATCH';
  }
  if (field === 'onchainDeploymentTxHash') {
    return 'ONCHAIN_DEPLOYMENT_TX_HASH_MISMATCH';
  }
  return `CLAIM_MISMATCH_${String(field || 'unknown').toUpperCase()}`;
}

function evaluatePinnedClaimsVerification(actualClaims, expectedClaims) {
  const issues = [];
  const expected = expectedClaims || {};
  const actual = actualClaims || {};

  for (const field of PINNED_CLAIM_FIELDS) {
    const expectedValue = normalizeClaimForComparison(field, expected[field]);
    if (expectedValue === null) {
      continue;
    }

    const actualValue = normalizeClaimForComparison(field, actual[field]);
    if (actualValue === null || actualValue !== expectedValue) {
      issues.push(
        buildIssue(
          toIssueCodeForClaimMismatch(field),
          `Pinned claim '${formatClaimName(field)}' does not match expected runtime value.`
        )
      );
    }
  }

  return {
    verified: issues.length === 0,
    issues
  };
}

function buildSnapshot({
  verificationMode,
  attestationSource,
  action,
  sensitive,
  checkedAt,
  claims,
  verification
}) {
  const claimsHash = hashSha256(stableStringify(claims));

  return {
    verificationMode,
    source: attestationSource,
    action,
    sensitive,
    checkedAt,
    verified: verification.verified,
    verificationStatus: verification.verified ? 'verified' : 'unverified',
    claims,
    claimsHash,
    issues: verification.issues
  };
}

async function readAttestationFromFile(filePath, { readFile }) {
  if (!isNonEmptyString(filePath)) {
    return {
      ok: false,
      issues: [buildIssue('ATTESTATION_FILE_PATH_REQUIRED', 'Attestation file path is required.')]
    };
  }

  try {
    const fileContents = await readFile(filePath, 'utf8');
    return {
      ok: true,
      payload: JSON.parse(fileContents)
    };
  } catch (error) {
    return {
      ok: false,
      issues: [
        buildIssue(
          'ATTESTATION_FILE_READ_FAILED',
          error?.message || 'Unable to read attestation file.'
        )
      ]
    };
  }
}

async function readAttestationFromUrl(endpoint, { fetchImpl }) {
  if (!isNonEmptyString(endpoint)) {
    return {
      ok: false,
      issues: [buildIssue('ATTESTATION_ENDPOINT_REQUIRED', 'Attestation endpoint URL is required.')]
    };
  }

  if (typeof fetchImpl !== 'function') {
    return {
      ok: false,
      issues: [buildIssue('FETCH_UNAVAILABLE', 'Runtime does not provide fetch().')]
    };
  }

  try {
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: {
        accept: 'application/json'
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      return {
        ok: false,
        issues: [
          buildIssue(
            'ATTESTATION_ENDPOINT_REJECTED',
            `Attestation endpoint returned status ${response.status}.`
          )
        ]
      };
    }

    return {
      ok: true,
      payload: await response.json()
    };
  } catch (error) {
    return {
      ok: false,
      issues: [
        buildIssue(
          'ATTESTATION_ENDPOINT_UNREACHABLE',
          error?.message || 'Unable to reach attestation endpoint.'
        )
      ]
    };
  }
}

function buildReportOnlySnapshot({
  verificationMode,
  attestationSource,
  action,
  sensitive,
  checkedAt,
  claims
}) {
  const verification = evaluateClaimsVerification(claims, {
    nowMs: Date.parse(checkedAt),
    maxAgeSeconds: Number.MAX_SAFE_INTEGER
  });

  return buildSnapshot({
    verificationMode,
    attestationSource,
    action,
    sensitive,
    checkedAt,
    claims,
    verification
  });
}

export function createRuntimeAttestationService(
  proofConfig = {},
  { now = () => Date.now(), readFile = fs.readFile, fetchImpl = globalThis.fetch } = {}
) {
  const verificationMode = normalizeVerificationMode(proofConfig.runtimeVerificationMode);
  const attestationSource = normalizeAttestationSource(proofConfig.attestationSource);
  const attestationFilePath = compactString(proofConfig.attestationFilePath);
  const attestationEndpoint = compactString(proofConfig.attestationEndpoint);
  const attestationMaxAgeSeconds = Math.max(1, Number(proofConfig.attestationMaxAgeSeconds) || 900);

  async function getSnapshot({ action = 'unknown', sensitive = false } = {}) {
    const checkedAt = new Date(now()).toISOString();
    const staticClaims = normalizeClaims(proofConfig.runtime || {});

    if (verificationMode === 'off') {
      const reportOnlySnapshot = buildReportOnlySnapshot({
        verificationMode,
        attestationSource,
        action,
        sensitive,
        checkedAt,
        claims: staticClaims
      });

      return {
        ...reportOnlySnapshot,
        verified: false,
        verificationStatus: 'skipped',
        issues: [buildIssue('VERIFICATION_DISABLED', 'Runtime verification mode is off.')]
      };
    }

    let sourceResult = null;
    if (attestationSource === 'config') {
      sourceResult = {
        ok: true,
        payload: proofConfig.runtime || {}
      };
    } else if (attestationSource === 'file') {
      sourceResult = await readAttestationFromFile(attestationFilePath, { readFile });
    } else {
      sourceResult = await readAttestationFromUrl(attestationEndpoint, { fetchImpl });
    }

    if (!sourceResult.ok) {
      return buildSnapshot({
        verificationMode,
        attestationSource,
        action,
        sensitive,
        checkedAt,
        claims: staticClaims,
        verification: {
          verified: false,
          issues: sourceResult.issues
        }
      });
    }

    const normalizedClaims = normalizeClaims(sourceResult.payload);
    const freshnessVerification = evaluateClaimsVerification(normalizedClaims, {
      nowMs: Date.parse(checkedAt),
      maxAgeSeconds: attestationMaxAgeSeconds
    });
    const pinnedClaimVerification = evaluatePinnedClaimsVerification(normalizedClaims, staticClaims);
    const verification = {
      verified: freshnessVerification.verified && pinnedClaimVerification.verified,
      issues: [...freshnessVerification.issues, ...pinnedClaimVerification.issues]
    };

    return buildSnapshot({
      verificationMode,
      attestationSource,
      action,
      sensitive,
      checkedAt,
      claims: normalizedClaims,
      verification
    });
  }

  async function checkAccess({ action = 'unknown', sensitive = false } = {}) {
    const snapshot = await getSnapshot({ action, sensitive });
    const enforced = verificationMode === 'enforce' && Boolean(sensitive);

    if (enforced && !snapshot.verified) {
      return {
        allowed: false,
        statusCode: 503,
        code: 'RUNTIME_VERIFICATION_FAILED',
        message:
          'Sensitive operation denied because runtime attestation verification did not pass.',
        snapshot: {
          ...snapshot,
          enforced
        }
      };
    }

    return {
      allowed: true,
      statusCode: 200,
      code: snapshot.verified ? 'RUNTIME_VERIFIED' : 'RUNTIME_VERIFICATION_NOT_ENFORCED',
      message: snapshot.verified
        ? 'Runtime attestation verified.'
        : 'Runtime attestation verification is not enforced for this operation.',
      snapshot: {
        ...snapshot,
        enforced
      }
    };
  }

  return {
    checkAccess,
    getSnapshot
  };
}

export function createPermissiveRuntimeAttestationService() {
  function buildSnapshot(action, sensitive) {
    return {
      verificationMode: 'off',
      source: 'config',
      action,
      sensitive,
      checkedAt: new Date().toISOString(),
      verified: false,
      verificationStatus: 'skipped',
      claims: {
        appId: null,
        imageDigest: null,
        attestationReportHash: null,
        onchainDeploymentTxHash: null,
        issuedAt: null,
        expiresAt: null
      },
      claimsHash: hashSha256('null'),
      issues: [buildIssue('VERIFICATION_DISABLED', 'Runtime verification mode is off.')],
      enforced: false
    };
  }

  return {
    async checkAccess({ action = 'unknown', sensitive = false } = {}) {
      return {
        allowed: true,
        statusCode: 200,
        code: 'RUNTIME_VERIFICATION_NOT_ENFORCED',
        message: 'Runtime attestation verification is not enforced.',
        snapshot: buildSnapshot(action, sensitive)
      };
    },
    async getSnapshot({ action = 'unknown', sensitive = false } = {}) {
      return buildSnapshot(action, sensitive);
    }
  };
}
