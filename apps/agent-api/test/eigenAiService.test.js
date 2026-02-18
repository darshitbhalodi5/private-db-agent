import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers';
import { createSqliteAdapter } from '../src/db/adapters/sqliteAdapter.js';
import { createAiDraftStore } from '../src/services/aiDraftStore.js';
import { createEigenAiService } from '../src/services/eigenAiService.js';
import {
  buildPolicyMutationMessage,
  createPolicyMutationAuthService
} from '../src/services/policyMutationAuthService.js';

const fixedIsoTime = '2026-02-18T00:00:00.000Z';
const fixedNowMs = Date.parse('2026-02-18T00:00:10.000Z');

async function withAiService(testFn) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'private-db-agent-ai-service-'));
  const dbPath = path.join(tempDir, 'ai.sqlite');
  const adapter = await createSqliteAdapter({ filePath: dbPath });
  const aiDraftStore = createAiDraftStore({ databaseAdapter: adapter });
  await aiDraftStore.ensureInitialized();

  const aiSignerWallet = Wallet.createRandom();
  const mutationAuthService = createPolicyMutationAuthService(
    {
      enabled: true,
      nonceTtlSeconds: 300,
      maxFutureSkewSeconds: 60
    },
    { now: () => fixedNowMs }
  );

  const eigenAiService = createEigenAiService({
    aiConfig: {
      enabled: true,
      provider: 'mock',
      model: 'eigen-ai-mock-v1',
      signerPrivateKey: aiSignerWallet.privateKey,
      signerAddress: aiSignerWallet.address
    },
    aiDraftStore,
    mutationAuthService,
    now: () => fixedIsoTime
  });

  try {
    await testFn({ eigenAiService });
  } finally {
    await adapter.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

test('schema draft endpoint returns verified signed draft with compiled plan', async () => {
  await withAiService(async ({ eigenAiService }) => {
    const actorWallet = Wallet.createRandom();

    const result = await eigenAiService.createSchemaDraft({
      requestId: 'req_ai_schema_1',
      tenantId: 'tenant_demo',
      actorWallet: actorWallet.address,
      prompt: 'Create inventory tables with audit.',
      context: {
        databaseName: 'branch_ledger',
        engine: 'sqlite',
        creatorWallet: actorWallet.address
      }
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.body.code, 'AI_SCHEMA_DRAFT_READY');
    assert.equal(result.body.draft.verification.verified, true);
    assert.equal(Array.isArray(result.body.submissionPayload.tables), true);
    assert.equal(result.body.migrationPlan.steps.length >= 2, true);
  });
});

test('policy draft endpoint returns validated grants and signature verification', async () => {
  await withAiService(async ({ eigenAiService }) => {
    const actorWallet = Wallet.createRandom();

    const result = await eigenAiService.createPolicyDraft({
      requestId: 'req_ai_policy_1',
      tenantId: 'tenant_demo',
      actorWallet: actorWallet.address,
      prompt: 'Generate read-only policy for inventory and audit tables.',
      context: {
        tableNames: ['inventory', 'inventory_audit']
      }
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.body.code, 'AI_POLICY_DRAFT_READY');
    assert.equal(result.body.draft.verification.verified, true);
    assert.equal(Array.isArray(result.body.grants), true);
    assert.equal(result.body.grants.length, 2);
  });
});

test('draft approval requires valid signed actor auth and rejects hash mismatch', async () => {
  await withAiService(async ({ eigenAiService }) => {
    const actorWallet = Wallet.createRandom();
    const schemaDraft = await eigenAiService.createSchemaDraft({
      requestId: 'req_ai_schema_approve',
      tenantId: 'tenant_demo',
      actorWallet: actorWallet.address,
      prompt: 'Create basic inventory table.',
      context: {
        databaseName: 'branch_ledger',
        engine: 'sqlite',
        creatorWallet: actorWallet.address
      }
    });

    assert.equal(schemaDraft.statusCode, 200);

    const badApproval = await eigenAiService.approveDraft({
      requestId: 'req_ai_approve_bad_hash',
      tenantId: 'tenant_demo',
      draftId: schemaDraft.body.draft.draftId,
      draftHash: 'invalid_hash',
      actorWallet: actorWallet.address,
      auth: {
        nonce: 'nonce_bad_hash',
        signedAt: fixedIsoTime,
        signature: '0x00'
      }
    });

    assert.equal(badApproval.statusCode, 409);
    assert.equal(badApproval.body.error, 'AI_DRAFT_HASH_MISMATCH');

    const approvalMessage = buildPolicyMutationMessage({
      requestId: 'req_ai_approve_ok',
      tenantId: 'tenant_demo',
      actorWallet: actorWallet.address.toLowerCase(),
      action: 'ai:draft:approve',
      payload: {
        draftId: schemaDraft.body.draft.draftId,
        draftHash: schemaDraft.body.draft.draftHash
      },
      nonce: 'nonce_ai_approve_ok',
      signedAt: fixedIsoTime
    });

    const signature = await actorWallet.signMessage(approvalMessage);
    const approvalResult = await eigenAiService.approveDraft({
      requestId: 'req_ai_approve_ok',
      tenantId: 'tenant_demo',
      draftId: schemaDraft.body.draft.draftId,
      draftHash: schemaDraft.body.draft.draftHash,
      actorWallet: actorWallet.address,
      auth: {
        nonce: 'nonce_ai_approve_ok',
        signedAt: fixedIsoTime,
        signature
      }
    });

    assert.equal(approvalResult.statusCode, 201);
    assert.equal(approvalResult.body.code, 'AI_DRAFT_APPROVED');
    assert.equal(approvalResult.body.aiAssist.source, 'eigen-ai');
  });
});
