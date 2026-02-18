import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileMigrationPlan,
  validateAndCompileSchemaDsl,
  validateSchemaDsl
} from '../src/services/schemaDslService.js';

function createValidPayload() {
  return {
    requestId: 'req_schema_1',
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
        name: 'inventory',
        fields: [
          { name: 'item_id', type: 'text', primaryKey: true, nullable: false },
          { name: 'quantity', type: 'integer', nullable: false }
        ]
      },
      {
        name: 'audit_log',
        fields: [
          { name: 'event_id', type: 'text', primaryKey: true, nullable: false },
          { name: 'payload', type: 'jsonb', nullable: true }
        ]
      }
    ]
  };
}

test('validateSchemaDsl rejects invalid identifiers and field types with structured issues', () => {
  const payload = createValidPayload();
  payload.database.name = 'drop-table';
  payload.tables[0].fields[0].type = 'uuid';

  const result = validateSchemaDsl(payload);

  assert.equal(result.ok, false);
  assert.equal(Array.isArray(result.issues), true);
  assert.equal(result.issues.length >= 2, true);
  assert.equal(result.issues.some((issue) => issue.path === 'database.name'), true);
  assert.equal(
    result.issues.some((issue) => issue.path === 'tables[0].fields[0].type'),
    true
  );
});

test('validateSchemaDsl rejects duplicate table and field names', () => {
  const payload = createValidPayload();
  payload.tables.push({
    name: 'inventory',
    fields: [{ name: 'id', type: 'text', primaryKey: true, nullable: false }]
  });
  payload.tables[0].fields.push({
    name: 'quantity',
    type: 'integer',
    nullable: false,
    primaryKey: false
  });

  const result = validateSchemaDsl(payload);

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'duplicate_table_name'), true);
  assert.equal(result.issues.some((issue) => issue.code === 'duplicate_field_name'), true);
});

test('compileMigrationPlan is deterministic across table order changes', () => {
  const payloadA = createValidPayload();
  const payloadB = createValidPayload();

  payloadB.tables = payloadB.tables.slice().reverse();

  const normalizedA = validateSchemaDsl(payloadA);
  const normalizedB = validateSchemaDsl(payloadB);

  assert.equal(normalizedA.ok, true);
  assert.equal(normalizedB.ok, true);

  const planA = compileMigrationPlan(normalizedA.normalizedDsl);
  const planB = compileMigrationPlan(normalizedB.normalizedDsl);

  assert.equal(planA.planHash, planB.planHash);
  assert.equal(planA.steps[1].metadata.tableName, 'audit_log');
  assert.equal(planA.steps[2].metadata.tableName, 'inventory');
});

test('validateAndCompileSchemaDsl returns migration plan for valid payload', () => {
  const payload = createValidPayload();

  const result = validateAndCompileSchemaDsl(payload);

  assert.equal(result.ok, true);
  assert.equal(result.schema.id.includes('schema-dsl'), true);
  assert.equal(result.normalizedDsl.database.name, 'branch_ledger');
  assert.equal(result.migrationPlan.steps.length, 3);
  assert.equal(result.migrationPlan.steps[1].sql.includes('CREATE TABLE IF NOT EXISTS'), true);
  assert.equal(typeof result.migrationPlan.planHash, 'string');
  assert.equal(result.migrationPlan.planHash.length, 64);
});
