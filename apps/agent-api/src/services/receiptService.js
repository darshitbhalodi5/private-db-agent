import { createHash } from 'node:crypto';

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

function hashSha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function compactValue(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return value;
}

function buildVerificationMetadata({
  runtimeMetadata,
  databaseDialect,
  proofConfig,
  decision,
  runtimeVerification
}) {
  const claims = runtimeVerification?.claims || {};

  return {
    service: {
      name: runtimeMetadata.serviceName,
      version: runtimeMetadata.version,
      environment: runtimeMetadata.nodeEnv
    },
    runtime: {
      trustModel: proofConfig.trustModel,
      databaseDialect,
      verification: {
        mode: runtimeVerification?.verificationMode || proofConfig.runtimeVerificationMode || 'unknown',
        status: runtimeVerification?.verificationStatus || 'unknown',
        source: runtimeVerification?.source || proofConfig.attestationSource || 'unknown',
        checkedAt: runtimeVerification?.checkedAt || null,
        enforced: Boolean(runtimeVerification?.enforced),
        verified: Boolean(runtimeVerification?.verified),
        issues: Array.isArray(runtimeVerification?.issues) ? runtimeVerification.issues : []
      },
      attestation: {
        appId: compactValue(claims.appId || proofConfig.runtime.appId),
        imageDigest: compactValue(claims.imageDigest || proofConfig.runtime.imageDigest),
        attestationReportHash: compactValue(
          claims.attestationReportHash || proofConfig.runtime.attestationReportHash
        ),
        onchainDeploymentTxHash: compactValue(
          claims.onchainDeploymentTxHash || proofConfig.runtime.onchainDeploymentTxHash
        ),
        claimsHash: compactValue(runtimeVerification?.claimsHash || null)
      },
    },
    decision: {
      outcome: decision.outcome,
      stage: decision.stage,
      code: decision.code
    }
  };
}

export function createReceiptService(
  proofConfig,
  runtimeMetadata,
  { now = () => new Date() } = {}
) {
  function buildReceipt({
    payload,
    statusCode,
    decision,
    auth,
    policy,
    execution,
    databaseDialect,
    runtimeVerification
  }) {
    if (!proofConfig.enabled) {
      return null;
    }

    const createdAt = now().toISOString();

    const requestEnvelope = {
      requestId: payload?.requestId || null,
      requester: payload?.requester || null,
      capability: payload?.capability || null,
      queryTemplate: payload?.queryTemplate || null,
      queryParams: payload?.queryParams || {},
      auth: {
        nonce: payload?.auth?.nonce || null,
        signedAt: payload?.auth?.signedAt || null
      }
    };

    const decisionEnvelope = {
      statusCode,
      outcome: decision.outcome,
      stage: decision.stage,
      code: decision.code,
      message: decision.message,
      auth: {
        ok: Boolean(auth?.ok),
        code: auth?.code || null,
        requester: auth?.requester || null
      },
      policy: {
        allowed: policy ? Boolean(policy.allowed) : null,
        code: policy?.code || null
      },
      execution: {
        ok: execution ? Boolean(execution.ok) : null,
        code: execution?.code || null,
        rowCount: execution?.data?.rowCount || 0,
        rowsHash:
          execution?.data?.rows && Array.isArray(execution.data.rows)
            ? hashSha256Hex(stableStringify(execution.data.rows))
            : null
      }
    };

    const verificationMetadata = buildVerificationMetadata({
      runtimeMetadata,
      databaseDialect,
      proofConfig,
      decision,
      runtimeVerification
    });

    const requestHash = hashSha256Hex(stableStringify(requestEnvelope));
    const decisionHash = hashSha256Hex(stableStringify(decisionEnvelope));
    const verificationHash = hashSha256Hex(stableStringify(verificationMetadata));

    const receiptIdSeed = stableStringify({
      requestHash,
      decisionHash,
      verificationHash,
      createdAt
    });
    const receiptId = `rcpt_${hashSha256Hex(receiptIdSeed).slice(0, 32)}`;

    return {
      version: '1.0',
      receiptId,
      createdAt,
      hashAlgorithm: proofConfig.hashAlgorithm,
      requestHash,
      decisionHash,
      verificationHash,
      verification: verificationMetadata
    };
  }

  return {
    buildReceipt
  };
}
