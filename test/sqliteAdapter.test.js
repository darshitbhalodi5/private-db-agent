import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSqliteAdapter } from '../src/db/adapters/sqliteAdapter.js';
import { createQueryExecutionService } from '../src/query/queryExecutionService.js';

async function withTempSqlite(testFn) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'private-db-agent-'));
  const dbPath = path.join(tempDir, 'demo.sqlite');
  const adapter = await createSqliteAdapter({ filePath: dbPath });

  try {
    await testFn(adapter);
  } finally {
    await adapter.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

test('sqlite adapter seeds and returns wallet balances', async () => {
  await withTempSqlite(async (adapter) => {
    const executionService = createQueryExecutionService({
      databaseAdapter: adapter,
      enforceCapabilityMode: true
    });

    const result = await executionService.execute({
      capability: 'balances:read',
      queryTemplate: 'wallet_balances',
      queryParams: {
        walletAddress: '0x8ba1f109551bd432803012645ac136ddd64dba72',
        chainId: 1,
        limit: 10
      }
    });

    assert.equal(result.ok, true);
    assert.ok(result.data.rowCount > 0);
    assert.ok(Array.isArray(result.data.rows));
  });
});

test('sqlite adapter supports write template when capability is write', async () => {
  await withTempSqlite(async (adapter) => {
    const executionService = createQueryExecutionService({
      databaseAdapter: adapter,
      enforceCapabilityMode: true
    });

    const writeResult = await executionService.execute({
      capability: 'audit:write',
      queryTemplate: 'access_log_insert',
      queryParams: {
        requestId: 'req-sqlite-write-1',
        requester: '0x8ba1f109551bd432803012645ac136ddd64dba72',
        capability: 'audit:write',
        queryTemplate: 'access_log_insert',
        decision: 'allow',
        createdAt: '2026-02-17T10:00:00.000Z'
      }
    });

    assert.equal(writeResult.ok, true);

    const readResult = await executionService.execute({
      capability: 'audit:read',
      queryTemplate: 'access_log_recent',
      queryParams: { limit: 5 }
    });

    assert.equal(readResult.ok, true);
    const found = readResult.data.rows.some((row) => row.request_id === 'req-sqlite-write-1');
    assert.equal(found, true);
  });
});
