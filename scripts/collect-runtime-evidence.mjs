import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const baseUrl = process.argv[2] || process.env.RUNTIME_EVIDENCE_BASE_URL || 'http://localhost:8080';
const outputDir = process.argv[3] || process.env.RUNTIME_EVIDENCE_OUTPUT_DIR || 'submission/evidence/eigencompute';
const imageRef =
  process.env.EIGEN_IMAGE_REF || 'ghcr.io/darshitbhalodi5/private-db-agent:demo-2026-02-19';
const fallbackAppId = process.env.EIGEN_APP_ID || 'private-db-agent-demo-2026';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');

function compactString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json'
    },
    cache: 'no-store'
  });
  const text = await response.text();

  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = {
      raw: text
    };
  }

  return {
    status: response.status,
    ok: response.ok,
    body
  };
}

function writeJson(filePath, value) {
  return fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function ensureRequiredClaim(value, label) {
  const normalized = compactString(value);
  if (!normalized) {
    throw new Error(`Cannot collect runtime evidence: missing required claim '${label}'.`);
  }
  return normalized;
}

async function main() {
  const health = await fetchJson(`${baseUrl}/health`);
  if (!health.ok) {
    throw new Error(
      `Runtime evidence health check failed (${health.status}): ${JSON.stringify(health.body)}`
    );
  }

  const runtimeResponse = await fetchJson(`${baseUrl}/v1/runtime/attestation`);
  if (!runtimeResponse.ok) {
    throw new Error(
      `Runtime attestation fetch failed (${runtimeResponse.status}): ${JSON.stringify(runtimeResponse.body)}`
    );
  }

  const runtime = runtimeResponse.body?.runtime || {};
  const claims = runtime.claims || {};
  const appId = compactString(claims.appId) || fallbackAppId;
  const imageDigest = ensureRequiredClaim(claims.imageDigest, 'imageDigest');
  const attestationReportHash = ensureRequiredClaim(
    claims.attestationReportHash,
    'attestationReportHash'
  );

  const absoluteOutputDir = path.resolve(rootDir, outputDir);
  await fs.mkdir(absoluteOutputDir, { recursive: true });

  const runtimeSnapshotPath = path.join(absoluteOutputDir, 'runtime-attestation.snapshot.json');
  const runtimeSummaryPath = path.join(absoluteOutputDir, 'runtime-verification-summary.json');
  const runtimeSamplePath = path.join(absoluteOutputDir, 'runtime-attestation.sample.json');
  const manifestPath = path.join(absoluteOutputDir, 'rendered-agent-manifest.yaml');

  await writeJson(runtimeSnapshotPath, runtimeResponse.body);

  const summary = {
    capturedAt: new Date().toISOString(),
    baseUrl,
    runtimeVerification: {
      mode: runtime.verificationMode || null,
      status: runtime.verificationStatus || null,
      verified: Boolean(runtime.verified),
      source: runtime.source || null,
      claimsHash: runtime.claimsHash || null
    },
    claims: {
      appId,
      imageDigest,
      attestationReportHash,
      onchainDeploymentTxHash: compactString(claims.onchainDeploymentTxHash),
      issuedAt: compactString(claims.issuedAt),
      expiresAt: compactString(claims.expiresAt)
    }
  };
  await writeJson(runtimeSummaryPath, summary);

  await writeJson(runtimeSamplePath, {
    attestation: {
      appId,
      imageDigest,
      attestationReportHash,
      onchainDeploymentTxHash: compactString(claims.onchainDeploymentTxHash),
      issuedAt: compactString(claims.issuedAt),
      expiresAt: compactString(claims.expiresAt)
    }
  });

  const renderScriptPath = path.join(rootDir, 'scripts', 'render-eigencompute-manifest.sh');
  const renderResult = spawnSync(
    'bash',
    [renderScriptPath, imageRef, imageDigest, appId, manifestPath],
    {
      cwd: rootDir,
      env: process.env,
      encoding: 'utf-8'
    }
  );

  if (renderResult.status !== 0) {
    throw new Error(
      `Manifest render failed: ${renderResult.stderr || renderResult.stdout || 'unknown error'}`
    );
  }

  const result = {
    baseUrl,
    outputDir: path.relative(rootDir, absoluteOutputDir),
    files: {
      runtimeSnapshot: path.relative(rootDir, runtimeSnapshotPath),
      runtimeSummary: path.relative(rootDir, runtimeSummaryPath),
      runtimeSample: path.relative(rootDir, runtimeSamplePath),
      renderedManifest: path.relative(rootDir, manifestPath)
    },
    runtimeVerification: summary.runtimeVerification
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
