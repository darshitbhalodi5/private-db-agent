import { createPostgresAdapter } from './adapters/postgresAdapter.js';
import { createSqliteAdapter } from './adapters/sqliteAdapter.js';

export async function createDatabaseAdapter(databaseConfig) {
  if (databaseConfig.driver === 'postgres') {
    return createPostgresAdapter(databaseConfig.postgres);
  }

  if (databaseConfig.driver === 'sqlite') {
    return createSqliteAdapter(databaseConfig.sqlite);
  }

  throw new Error(`Unsupported DB driver '${databaseConfig.driver}'.`);
}
