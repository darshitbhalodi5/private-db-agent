import test from 'node:test';
import assert from 'node:assert/strict';
import { createSchemaApplyService } from '../src/services/schemaApplyService.js';

function createValidPayload() {
  return {
    tenantId: 'tenant_demo',
    requestId: 'req_apply_schema',
    actorWallet: '0x8ba1f109551bd432803012645ac136ddd64dba72',
    creator: {
      walletAddress: '0x8ba1f109551bd432803012645ac136ddd64dba72',
      chainId: 1
    },
    database: {
      name: 'branch_ledger',
      engine: 'sqlite'
    },
    tables: [
      {
        name: 'inventory',
        fields: [
          {
            name: 'item_id',
            type: 'text',
            primaryKey: true,
            nullable: false
          }
        ]
      }
    ]
  };
}

function createAllowAuthorizationService() {
  return {
    authorize: async () => ({
      ok: true,
      actorWallet: '0x8ba1f109551bd432803012645ac136ddd64dba72',
      signatureHash: 'sig_hash_test',
      decision: {
        allowed: true,
        code: 'DATABASE_ALL_ALLOW_MATCH',
        message: 'Allowed by database-level all-operation rule.'
      }
    })
  };
}

test('schema apply rejects raw sql payload input', async () => {
  const schemaApplyService = createSchemaApplyService({
    actionAuthorizationService: createAllowAuthorizationService(),
    migrationRunnerService: {
      applyMigrationPlan: async () => ({
        ok: true,
        data: {}
      })
    }
  });

  const payload = createValidPayload();
  payload.rawSql = 'CREATE TABLE hacked(id text)';

  const result = await schemaApplyService.apply(payload);

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, 'RAW_SQL_NOT_ALLOWED');
});

test('schema apply returns migration apply failure safely', async () => {
  const schemaApplyService = createSchemaApplyService({
    actionAuthorizationService: createAllowAuthorizationService(),
    migrationRunnerService: {
      applyMigrationPlan: async () => ({
        ok: false,
        error: {
          error: 'MIGRATION_APPLY_FAILED',
          message: 'tx failed'
        }
      })
    }
  });

  const result = await schemaApplyService.apply(createValidPayload());

  assert.equal(result.statusCode, 500);
  assert.equal(result.body.error, 'MIGRATION_APPLY_FAILED');
});

test('schema apply returns success with compiled migration metadata', async () => {
  const schemaApplyService = createSchemaApplyService({
    actionAuthorizationService: createAllowAuthorizationService(),
    migrationRunnerService: {
      applyMigrationPlan: async () => ({
        ok: true,
        data: {
          migrationId: 'migration_1',
          tenantId: 'tenant_demo',
          requestId: 'req_apply_schema',
          stepCount: 2
        }
      })
    }
  });

  const result = await schemaApplyService.apply(createValidPayload());

  assert.equal(result.statusCode, 201);
  assert.equal(result.body.code, 'SCHEMA_APPLIED');
  assert.equal(result.body.authorization.actorWallet, '0x8ba1f109551bd432803012645ac136ddd64dba72');
  assert.equal(result.body.migration.migrationId, 'migration_1');
  assert.equal(Array.isArray(result.body.migrationPlan.steps), true);
});

test('schema apply surfaces authorization failures', async () => {
  const schemaApplyService = createSchemaApplyService({
    actionAuthorizationService: {
      authorize: async () => ({
        ok: false,
        statusCode: 403,
        body: {
          error: 'POLICY_DENIED',
          message: 'Actor is not allowed to alter schema.'
        }
      })
    },
    migrationRunnerService: {
      applyMigrationPlan: async () => ({
        ok: true,
        data: {}
      })
    }
  });

  const result = await schemaApplyService.apply(createValidPayload());

  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error, 'POLICY_DENIED');
});
