import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import {
  createControlPlaneSubmissionService,
  handleControlPlaneSubmission
} from '../src/services/controlPlaneSubmissionService.js';
import {
  buildPolicyMutationMessage,
  createPolicyMutationAuthService
} from '../src/services/policyMutationAuthService.js';

const fixedSignedAt = '2026-02-18T00:00:00.000Z';
const fixedNowMs = Date.parse('2026-02-18T00:00:10.000Z');
const defaultTenantId = 'tenant_demo';

function createValidPayload(actorWallet) {
  return {
    requestId: 'req_task1',
    tenantId: defaultTenantId,
    actorWallet,
    creator: {
      walletAddress: actorWallet,
      chainId: 1
    },
    database: {
      name: 'branch_ledger',
      engine: 'postgres'
    },
    tables: [
      {
        name: 'entries',
        fields: [
          {
            name: 'entry_id',
            type: 'text',
            nullable: false,
            primaryKey: true
          }
        ]
      }
    ],
    grants: [
      {
        walletAddress: actorWallet,
        scopeType: 'database',
        scopeId: '*',
        operation: 'all',
        effect: 'allow'
      }
    ],
    metadata: {
      source: 'test'
    }
  };
}

function createSubmitActionPayload(payload) {
  return {
    creator: payload.creator || null,
    database: payload.database || null,
    tables: Array.isArray(payload.tables) ? payload.tables : [],
    grants: Array.isArray(payload.grants) ? payload.grants : [],
    aiAssist: payload.aiAssist || null,
    metadata: payload.metadata || null
  };
}

async function signSubmitPayload(payload, signerWallet, nonce = 'nonce_submit_1') {
  const actorWalletLower = String(payload.actorWallet || '').trim().toLowerCase();
  const message = buildPolicyMutationMessage({
    requestId: payload.requestId,
    tenantId: payload.tenantId,
    actorWallet: actorWalletLower,
    action: 'schema:submit',
    payload: createSubmitActionPayload(payload),
    nonce,
    signedAt: fixedSignedAt
  });
  const signature = await signerWallet.signMessage(message);

  return {
    nonce,
    signedAt: fixedSignedAt,
    signature
  };
}

function createTestService() {
  return createControlPlaneSubmissionService({
    mutationAuthService: createPolicyMutationAuthService(
      {
        enabled: true,
        nonceTtlSeconds: 300,
        maxFutureSkewSeconds: 60
      },
      { now: () => fixedNowMs }
    ),
    now: () => fixedSignedAt,
    createSubmissionId: () => 'sub_test_001'
  });
}

test('rejects non-object payload', async () => {
  const result = await handleControlPlaneSubmission(null, {
    controlPlaneSubmissionService: createTestService()
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, 'VALIDATION_ERROR');
  assert.match(result.body.message, /JSON object/);
});

test('rejects unsigned control-plane submit payload', async () => {
  const signerWallet = Wallet.createRandom();
  const payload = createValidPayload(signerWallet.address);

  const result = await handleControlPlaneSubmission(payload, {
    controlPlaneSubmissionService: createTestService()
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, 'VALIDATION_ERROR');
  assert.match(result.body.message, /auth object is required/i);
});

test('rejects signer mismatch for control-plane submit payload', async () => {
  const actorWallet = Wallet.createRandom();
  const mismatchedSigner = Wallet.createRandom();
  const payload = createValidPayload(actorWallet.address);
  payload.auth = await signSubmitPayload(payload, mismatchedSigner, 'nonce_submit_mismatch');

  const result = await handleControlPlaneSubmission(payload, {
    controlPlaneSubmissionService: createTestService()
  });

  assert.equal(result.statusCode, 401);
  assert.equal(result.body.error, 'SIGNER_MISMATCH');
});

test('accepts valid signed payload and returns submission metadata', async () => {
  const signerWallet = Wallet.createRandom();
  const payload = createValidPayload(signerWallet.address);
  payload.auth = await signSubmitPayload(payload, signerWallet, 'nonce_submit_valid');

  const result = await handleControlPlaneSubmission(payload, {
    controlPlaneSubmissionService: createTestService()
  });

  assert.equal(result.statusCode, 202);
  assert.equal(result.body.code, 'SCHEMA_REQUEST_ACCEPTED');
  assert.equal(result.body.authorization.actorWallet, signerWallet.address.toLowerCase());
  assert.equal(result.body.authorization.signatureHash.length > 0, true);
  assert.equal(result.body.submission.submissionId, 'sub_test_001');
  assert.equal(result.body.submission.requestId, 'req_task1');
  assert.equal(result.body.submission.tenantId, defaultTenantId);
  assert.equal(result.body.submission.databaseName, 'branch_ledger');
  assert.equal(result.body.submission.tableCount, 1);
  assert.equal(result.body.submission.grantCount, 1);
  assert.equal(result.body.submission.receivedAt, fixedSignedAt);
  assert.equal(result.body.schema.id.includes('schema-dsl'), true);
  assert.equal(Array.isArray(result.body.migrationPlan.steps), true);
  assert.equal(result.body.migrationPlan.steps.length, 2);
});
