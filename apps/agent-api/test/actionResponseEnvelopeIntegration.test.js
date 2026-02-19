import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAiApproveDraftRequest } from '../src/services/eigenAiService.js';
import { handleDataOperationRequest } from '../src/services/dataOperationService.js';
import { handleCreatePolicyGrantRequest } from '../src/services/policyAdminService.js';
import { handleSchemaApplyRequest } from '../src/services/schemaApplyService.js';

const actorWallet = '0x8ba1f109551bd432803012645ac136ddd64dba72';

function createReceiptService() {
  return {
    buildReceipt: () => ({
      version: '1.0',
      receiptId: 'rcpt_test_integration',
      createdAt: '2026-02-18T00:00:00.000Z',
      hashAlgorithm: 'sha256',
      requestHash: 'request-hash',
      decisionHash: 'decision-hash',
      verificationHash: 'verification-hash',
      verification: {
        service: {
          name: 'private-db-agent-api',
          version: '0.1.0',
          environment: 'test'
        }
      }
    })
  };
}

function createAuditService() {
  return {
    recordDecision: async () => ({
      logged: true,
      code: 'LOGGED'
    })
  };
}

test('data operation handler attaches decision, receipt, and audit envelope', async () => {
  const payload = {
    requestId: 'req_data_envelope_1',
    tenantId: 'tenant_demo',
    actorWallet,
    operation: 'insert',
    tableName: 'inventory'
  };

  const result = await handleDataOperationRequest(payload, {
    dataOperationService: {
      execute: async () => ({
        statusCode: 200,
        body: {
          code: 'DATA_OPERATION_EXECUTED',
          tableName: 'inventory',
          rowCount: 1,
          rows: [],
          authorization: {
            actorWallet,
            signatureHash: 'sig_hash_data_1',
            decision: {
              allowed: true,
              code: 'TABLE_OPERATION_ALLOW_MATCH',
              message: 'Allowed by table operation grant.'
            }
          },
          runtime: {
            verificationStatus: 'verified'
          }
        }
      })
    },
    databaseDialect: 'sqlite',
    receiptService: createReceiptService(),
    auditService: createAuditService()
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.decision.outcome, 'allow');
  assert.equal(result.body.receipt.receiptId, 'rcpt_test_integration');
  assert.equal(result.body.audit.logged, true);
});

test('schema apply handler attaches denial decision envelope metadata', async () => {
  const payload = {
    requestId: 'req_schema_envelope_1',
    tenantId: 'tenant_demo',
    actorWallet
  };

  const result = await handleSchemaApplyRequest(payload, {
    schemaApplyService: {
      apply: async () => ({
        statusCode: 403,
        body: {
          error: 'POLICY_DENIED',
          message: 'Actor is not allowed to alter schema.',
          details: {
            decision: {
              allowed: false,
              code: 'FALLBACK_DENY',
              message: 'No matching grant.'
            }
          }
        }
      })
    },
    databaseDialect: 'sqlite',
    receiptService: createReceiptService(),
    auditService: createAuditService()
  });

  assert.equal(result.statusCode, 403);
  assert.equal(result.body.decision.outcome, 'deny');
  assert.equal(result.body.decision.stage, 'policy');
  assert.equal(result.body.receipt.receiptId, 'rcpt_test_integration');
  assert.equal(result.body.audit.code, 'LOGGED');
});

test('policy grant create handler attaches envelope metadata', async () => {
  const payload = {
    requestId: 'req_policy_envelope_1',
    tenantId: 'tenant_demo',
    actorWallet,
    grant: {
      walletAddress: actorWallet,
      scopeType: 'database',
      scopeId: '*',
      operation: 'all',
      effect: 'allow'
    }
  };

  const result = await handleCreatePolicyGrantRequest(payload, {
    policyAdminService: {
      createGrant: async () => ({
        statusCode: 201,
        body: {
          code: 'GRANT_CREATED',
          message: 'Grant created.',
          actorAuthority: {
            allowed: true,
            code: 'BOOTSTRAP_ALLOWED'
          },
          grant: {
            grantId: 'grant_1'
          }
        }
      })
    },
    databaseDialect: 'sqlite',
    receiptService: createReceiptService(),
    auditService: createAuditService()
  });

  assert.equal(result.statusCode, 201);
  assert.equal(result.body.decision.outcome, 'allow');
  assert.equal(result.body.receipt.receiptId, 'rcpt_test_integration');
  assert.equal(result.body.audit.logged, true);
});

test('ai approve draft handler attaches envelope metadata', async () => {
  const payload = {
    requestId: 'req_ai_envelope_1',
    tenantId: 'tenant_demo',
    actorWallet,
    draftId: 'draft_1',
    draftHash: 'hash_1'
  };

  const result = await handleAiApproveDraftRequest(payload, {
    eigenAiService: {
      approveDraft: async () => ({
        statusCode: 201,
        body: {
          code: 'AI_DRAFT_APPROVED',
          message: 'AI draft approved for execution.',
          approval: {
            approvalId: 'approval_1',
            approvedBy: actorWallet
          },
          aiAssist: {
            source: 'eigen-ai',
            draftId: 'draft_1',
            draftHash: 'hash_1',
            approvalId: 'approval_1',
            approvedBy: actorWallet
          }
        }
      })
    },
    databaseDialect: 'sqlite',
    receiptService: createReceiptService(),
    auditService: createAuditService()
  });

  assert.equal(result.statusCode, 201);
  assert.equal(result.body.decision.outcome, 'allow');
  assert.equal(result.body.receipt.receiptId, 'rcpt_test_integration');
  assert.equal(result.body.audit.code, 'LOGGED');
});
