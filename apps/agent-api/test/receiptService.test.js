import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceiptService } from '../src/services/receiptService.js';

function createProofConfig() {
  return {
    enabled: true,
    hashAlgorithm: 'sha256',
    trustModel: 'eigencompute-mainnet-alpha',
    runtime: {
      appId: 'app-123',
      imageDigest: 'sha256:image-digest',
      attestationReportHash: 'sha256:attestation',
      onchainDeploymentTxHash: '0xtxhash'
    }
  };
}

function createRuntimeMetadata() {
  return {
    serviceName: 'private-db-agent-api',
    version: '0.1.0',
    nodeEnv: 'test'
  };
}

function createPayload() {
  return {
    requestId: 'req-1',
    requester: '0x0000000000000000000000000000000000001234',
    capability: 'balances:read',
    queryTemplate: 'wallet_balances',
    queryParams: {
      walletAddress: '0x0000000000000000000000000000000000001234',
      chainId: 1
    },
    auth: {
      nonce: 'nonce-1',
      signedAt: '2026-02-17T10:00:00.000Z'
    }
  };
}

test('receipt service builds deterministic hash fields', () => {
  const receiptService = createReceiptService(createProofConfig(), createRuntimeMetadata(), {
    now: () => new Date('2026-02-17T10:01:00.000Z')
  });

  const payload = createPayload();

  const first = receiptService.buildReceipt({
    payload,
    statusCode: 200,
    decision: {
      outcome: 'allow',
      stage: 'execution',
      code: 'QUERY_EXECUTED',
      message: 'ok'
    },
    auth: {
      ok: true,
      requester: payload.requester,
      code: null
    },
    policy: {
      allowed: true,
      code: 'ALLOWED'
    },
    execution: {
      ok: true,
      data: {
        rowCount: 1,
        rows: [{ asset_symbol: 'ETH', balance: 1.23 }]
      }
    },
    databaseDialect: 'sqlite'
  });

  const second = receiptService.buildReceipt({
    payload,
    statusCode: 200,
    decision: {
      outcome: 'allow',
      stage: 'execution',
      code: 'QUERY_EXECUTED',
      message: 'ok'
    },
    auth: {
      ok: true,
      requester: payload.requester,
      code: null
    },
    policy: {
      allowed: true,
      code: 'ALLOWED'
    },
    execution: {
      ok: true,
      data: {
        rowCount: 1,
        rows: [{ asset_symbol: 'ETH', balance: 1.23 }]
      }
    },
    databaseDialect: 'sqlite'
  });

  assert.equal(first.receiptId, second.receiptId);
  assert.equal(first.hashAlgorithm, 'sha256');
  assert.equal(first.verification.runtime.databaseDialect, 'sqlite');
  assert.equal(first.verification.runtime.trustModel, 'eigencompute-mainnet-alpha');
  assert.ok(first.requestHash);
  assert.ok(first.decisionHash);
  assert.ok(first.verificationHash);
  assert.ok(first.receiptId.startsWith('rcpt_'));
});

test('receipt service returns null when disabled', () => {
  const receiptService = createReceiptService(
    {
      ...createProofConfig(),
      enabled: false
    },
    createRuntimeMetadata()
  );

  const receipt = receiptService.buildReceipt({
    payload: createPayload(),
    statusCode: 400,
    decision: {
      outcome: 'deny',
      stage: 'validation',
      code: 'VALIDATION_ERROR',
      message: 'bad request'
    },
    auth: null,
    policy: null,
    execution: null,
    databaseDialect: 'sqlite'
  });

  assert.equal(receipt, null);
});
