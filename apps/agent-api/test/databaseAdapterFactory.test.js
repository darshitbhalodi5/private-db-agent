import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDatabaseAdapter } from '../src/db/databaseAdapterFactory.js';

test('factory throws when postgres config is missing connection string', async () => {
  await assert.rejects(
    createDatabaseAdapter({
      driver: 'postgres',
      postgres: {
        connectionString: '',
        ssl: false,
        maxPoolSize: 2
      }
    }),
    /DATABASE_URL is required/
  );
});

test('factory creates sqlite adapter with configured file path', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'private-db-agent-factory-'));
  const dbPath = path.join(tempDir, 'factory.sqlite');

  const adapter = await createDatabaseAdapter({
    driver: 'sqlite',
    sqlite: {
      filePath: dbPath
    }
  });

  try {
    assert.equal(adapter.dialect, 'sqlite');
  } finally {
    await adapter.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
