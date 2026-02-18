import fs from 'node:fs/promises';
import path from 'node:path';
import sqlite3 from 'sqlite3';

function openDatabase(filePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(db);
    });
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }

      resolve({
        changes: Number.isFinite(this?.changes) ? this.changes : 0,
        lastID: Number.isFinite(this?.lastID) ? this.lastID : null
      });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(row || null);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows || []);
    });
  });
}

async function initializeSchema(db) {
  await run(
    db,
    `
      CREATE TABLE IF NOT EXISTS wallet_balances (
        wallet_address TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        asset_symbol TEXT NOT NULL,
        balance REAL NOT NULL,
        updated_at TEXT NOT NULL
      )
    `
  );

  await run(
    db,
    `
      CREATE TABLE IF NOT EXISTS wallet_positions (
        wallet_address TEXT NOT NULL,
        protocol TEXT NOT NULL,
        position_value_usd REAL NOT NULL,
        updated_at TEXT NOT NULL
      )
    `
  );

  await run(
    db,
    `
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        wallet_address TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        tx_hash TEXT NOT NULL,
        direction TEXT NOT NULL,
        amount REAL NOT NULL,
        created_at TEXT NOT NULL
      )
    `
  );

  await run(
    db,
    `
      CREATE TABLE IF NOT EXISTS access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        requester TEXT NOT NULL,
        capability TEXT NOT NULL,
        query_template TEXT NOT NULL,
        decision TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `
  );
}

async function seedIfNeeded(db) {
  const countRow = await get(db, 'SELECT COUNT(*) AS count FROM wallet_balances');
  const currentCount = Number(countRow?.count || 0);

  if (currentCount > 0) {
    return;
  }

  const wallet = '0x8ba1f109551bd432803012645ac136ddd64dba72';
  const now = new Date();
  const iso = now.toISOString();
  const olderIso = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

  await run(
    db,
    `
      INSERT INTO wallet_balances (wallet_address, chain_id, asset_symbol, balance, updated_at)
      VALUES
        (?, ?, ?, ?, ?),
        (?, ?, ?, ?, ?),
        (?, ?, ?, ?, ?)
    `,
    [
      wallet,
      1,
      'ETH',
      2.35,
      iso,
      wallet,
      1,
      'USDC',
      1250.12,
      olderIso,
      wallet,
      137,
      'MATIC',
      84.43,
      iso
    ]
  );

  await run(
    db,
    `
      INSERT INTO wallet_positions (wallet_address, protocol, position_value_usd, updated_at)
      VALUES
        (?, ?, ?, ?),
        (?, ?, ?, ?)
    `,
    [wallet, 'Aave', 820.4, iso, wallet, 'Uniswap V3', 491.1, olderIso]
  );

  await run(
    db,
    `
      INSERT INTO wallet_transactions (wallet_address, chain_id, tx_hash, direction, amount, created_at)
      VALUES
        (?, ?, ?, ?, ?, ?),
        (?, ?, ?, ?, ?, ?)
    `,
    [
      wallet,
      1,
      '0x41fb8f1f8809cbf7f23cb58f7f6fa53f4b95fdf3fc4b81a12a31aa4f9c037001',
      'in',
      0.5,
      iso,
      wallet,
      1,
      '0xaddab7caef90e0d4fd8c4ff2cb98a7d5a6478a63f5f7a95d02f0f90ad2d6ff77',
      'out',
      0.12,
      olderIso
    ]
  );

  await run(
    db,
    `
      INSERT INTO access_log (request_id, requester, capability, query_template, decision, created_at)
      VALUES
        (?, ?, ?, ?, ?, ?),
        (?, ?, ?, ?, ?, ?)
    `,
    [
      'seed-allow-1',
      wallet,
      'balances:read',
      'wallet_balances',
      'allow',
      iso,
      'seed-deny-1',
      wallet,
      'balances:read',
      'access_log_insert',
      'deny',
      olderIso
    ]
  );
}

export async function createSqliteAdapter(config) {
  const filePath = config?.filePath;
  if (!filePath) {
    throw new Error('SQLITE_FILE_PATH is required when DB_DRIVER=sqlite.');
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const db = await openDatabase(filePath);
  await initializeSchema(db);
  await seedIfNeeded(db);

  return {
    dialect: 'sqlite',
    async execute({ mode, sql, values }) {
      if (mode === 'read') {
        const rows = await all(db, sql, values);
        return {
          rowCount: rows.length,
          rows
        };
      }

      const writeResult = await run(db, sql, values);
      return {
        rowCount: writeResult.changes,
        rows: []
      };
    },
    async close() {
      await new Promise((resolve, reject) => {
        db.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}
