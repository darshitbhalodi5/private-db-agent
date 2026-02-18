import test from 'node:test';
import assert from 'node:assert/strict';
import { handleControlPlaneSubmission } from '../src/services/controlPlaneSubmissionService.js';

function createValidPayload() {
  return {
    requestId: 'req_task1',
    creator: {
      walletAddress: '0x8ba1f109551bd432803012645ac136ddd64dba72',
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
        walletAddress: '0x8ba1f109551bd432803012645ac136ddd64dba72',
        scopeType: 'database',
        scopeId: '*',
        operation: 'all',
        effect: 'allow'
      }
    ]
  };
}

test('rejects non-object payload', () => {
  const result = handleControlPlaneSubmission(null);

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, 'SCHEMA_DSL_VALIDATION_FAILED');
  assert.equal(Array.isArray(result.body.details.issues), true);
  assert.match(result.body.details.issues[0].message, /JSON object/);
});

test('rejects payload without creator wallet', () => {
  const payload = createValidPayload();
  payload.creator.walletAddress = '';

  const result = handleControlPlaneSubmission(payload);

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, 'SCHEMA_DSL_VALIDATION_FAILED');
  assert.equal(Array.isArray(result.body.details.issues), true);
  assert.equal(
    result.body.details.issues.some((issue) => issue.path === 'creator.walletAddress'),
    true
  );
});

test('rejects payload with invalid table field', () => {
  const payload = createValidPayload();
  payload.tables[0].fields[0].name = '';

  const result = handleControlPlaneSubmission(payload);

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, 'SCHEMA_DSL_VALIDATION_FAILED');
  assert.equal(Array.isArray(result.body.details.issues), true);
  assert.equal(
    result.body.details.issues.some((issue) => issue.path === 'tables[0].fields[0].name'),
    true
  );
});

test('accepts valid payload and returns submission metadata', () => {
  const payload = createValidPayload();

  const result = handleControlPlaneSubmission(payload, {
    now: () => '2026-02-18T00:00:00.000Z',
    createSubmissionId: () => 'sub_test_001'
  });

  assert.equal(result.statusCode, 202);
  assert.equal(result.body.code, 'SCHEMA_REQUEST_ACCEPTED');
  assert.equal(result.body.submission.submissionId, 'sub_test_001');
  assert.equal(result.body.submission.requestId, 'req_task1');
  assert.equal(result.body.submission.databaseName, 'branch_ledger');
  assert.equal(result.body.submission.tableCount, 1);
  assert.equal(result.body.submission.grantCount, 1);
  assert.equal(result.body.submission.receivedAt, '2026-02-18T00:00:00.000Z');
  assert.equal(result.body.schema.id.includes('schema-dsl'), true);
  assert.equal(Array.isArray(result.body.migrationPlan.steps), true);
  assert.equal(result.body.migrationPlan.steps.length, 2);
});
