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
    async close() {
      await pool.end();
    }
  };
}
