import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRuntimeAttestationService } from '../src/services/runtimeAttestationService.js';

test('report-only mode returns verified snapshot when required claims are present', async () => {
  const service = createRuntimeAttestationService(
    {
      runtimeVerificationMode: 'report-only',
      attestationSource: 'config',
      attestationMaxAgeSeconds: 900,
      runtime: {
        appId: 'app-demo',
        imageDigest: 'sha256:image',
        attestationReportHash: 'sha256:report',
        onchainDeploymentTxHash: '0xabc',
        issuedAt: '2026-02-18T00:00:00.000Z'
      }
    },
    {
      now: () => Date.parse('2026-02-18T00:10:00.000Z')
    }
  );

  const check = await service.checkAccess({
    action: 'query:execute',
    sensitive: false
  });

  assert.equal(check.allowed, true);
  assert.equal(check.snapshot.verified, true);
  assert.equal(check.snapshot.verificationStatus, 'verified');
  assert.equal(check.snapshot.claims.appId, 'app-demo');
});

test('enforce mode denies sensitive action when attestation claims are missing', async () => {
  const service = createRuntimeAttestationService({
    runtimeVerificationMode: 'enforce',
    attestationSource: 'config',
    runtime: {
      appId: '',
      imageDigest: '',
      attestationReportHash: ''
    }
  });

  const check = await service.checkAccess({
    action: 'schema:apply',
    sensitive: true
  });

  assert.equal(check.allowed, false);
  assert.equal(check.statusCode, 503);
  assert.equal(check.code, 'RUNTIME_VERIFICATION_FAILED');
  assert.equal(check.snapshot.verified, false);
  assert.equal(Array.isArray(check.snapshot.issues), true);
  assert.equal(check.snapshot.issues.length > 0, true);
});

test('file source reads and validates attestation document', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-attestation-test-'));
  const attestationPath = path.join(tempDir, 'attestation.json');

  await fs.writeFile(
    attestationPath,
    JSON.stringify(
      {
        attestation: {
          appId: 'app-file',
          imageDigest: 'sha256:file-image',
          attestationReportHash: 'sha256:file-report',
          onchainDeploymentTxHash: '0xdef',
          issuedAt: '2026-02-18T00:00:00.000Z',
          expiresAt: '2026-02-18T00:30:00.000Z'
        }
      },
      null,
      2
    ),
    'utf8'
  );

  try {
    const service = createRuntimeAttestationService(
      {
        runtimeVerificationMode: 'enforce',
        attestationSource: 'file',
        attestationFilePath: attestationPath,
        attestationMaxAgeSeconds: 1800,
        runtime: {}
      },
      {
        now: () => Date.parse('2026-02-18T00:10:00.000Z')
      }
    );

    const check = await service.checkAccess({
      action: 'data:insert',
      sensitive: true
    });

    assert.equal(check.allowed, true);
    assert.equal(check.snapshot.verified, true);
    assert.equal(check.snapshot.claims.appId, 'app-file');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
