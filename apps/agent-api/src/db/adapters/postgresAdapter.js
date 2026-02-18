import pg from 'pg';

const { Pool } = pg;

export function createPostgresAdapter(config) {
  if (!config?.connectionString) {
    throw new Error('DATABASE_URL is required when DB_DRIVER=postgres.');
  }

  const pool = new Pool({
    connectionString: config.connectionString,
    max: config.maxPoolSize || 10,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined
  });

  return {
    dialect: 'postgres',
    async execute({ sql, values }) {
      const result = await pool.query(sql, values);

      return {
        rowCount: Number.isFinite(result.rowCount) ? result.rowCount : result.rows.length,
        rows: result.rows || []
      };
    },
    async runInTransaction(workFn) {
      if (typeof workFn !== 'function') {
        throw new Error('runInTransaction requires a callback function.');
      }

      const client = await pool.connect();
      await client.query('BEGIN');

      const transactionalExecutor = {
        dialect: 'postgres',
        execute: async ({ sql, values }) => {
          const result = await client.query(sql, values);
          return {
            rowCount: Number.isFinite(result.rowCount) ? result.rowCount : result.rows.length,
            rows: result.rows || []
          };
        }
      };

      try {
        const response = await workFn(transactionalExecutor);
        await client.query('COMMIT');
        return response;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // keep original error as source of failure
        }

        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    }
  };
}
