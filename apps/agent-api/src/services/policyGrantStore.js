import { randomUUID } from 'node:crypto';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function toCamelCaseGrant(row) {
  if (!row) {
    return null;
  }

  return {
    grantId: row.grant_id,
    tenantId: row.tenant_id,
    walletAddress: row.wallet_address,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    operation: row.operation,
    effect: row.effect,
    createdBy: row.created_by,
    createdAt: row.created_at,
    signatureHash: row.signature_hash,
    revokedAt: row.revoked_at || null,
    revokedBy: row.revoked_by || null
  };
}

export function createPolicyGrantStore({ databaseAdapter }) {
  if (!databaseAdapter || typeof databaseAdapter.execute !== 'function') {
    throw new Error('databaseAdapter is required for policy grant store.');
  }

  const dialect = databaseAdapter.dialect;
  if (!['sqlite', 'postgres'].includes(dialect)) {
    throw new Error(`Unsupported database dialect '${dialect}' for policy grant store.`);
  }

  let initPromise = null;

  async function ensureInitialized() {
    if (!initPromise) {
      initPromise = initializeSchema().catch((error) => {
        initPromise = null;
        throw error;
      });
    }

    return initPromise;
  }

  async function initializeSchema() {
    if (dialect === 'sqlite') {
      await databaseAdapter.execute({
        mode: 'write',
        sql: `
          CREATE TABLE IF NOT EXISTS policy_grants (
            grant_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            wallet_address TEXT NOT NULL,
            scope_type TEXT NOT NULL,
            scope_id TEXT NOT NULL,
            operation TEXT NOT NULL,
            effect TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            signature_hash TEXT NOT NULL,
            revoked_at TEXT,
            revoked_by TEXT
          )
        `,
        values: []
      });

      await databaseAdapter.execute({
        mode: 'write',
        sql: `
          CREATE INDEX IF NOT EXISTS idx_policy_grants_lookup
          ON policy_grants (tenant_id, wallet_address, scope_type, scope_id, operation, effect)
        `,
        values: []
      });
      return;
    }

    await databaseAdapter.execute({
      mode: 'write',
      sql: `
        CREATE TABLE IF NOT EXISTS policy_grants (
          grant_id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          wallet_address TEXT NOT NULL,
          scope_type TEXT NOT NULL,
          scope_id TEXT NOT NULL,
          operation TEXT NOT NULL,
          effect TEXT NOT NULL,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          signature_hash TEXT NOT NULL,
          revoked_at TEXT,
          revoked_by TEXT
        )
      `,
      values: []
    });

    await databaseAdapter.execute({
      mode: 'write',
      sql: `
        CREATE INDEX IF NOT EXISTS idx_policy_grants_lookup
        ON policy_grants (tenant_id, wallet_address, scope_type, scope_id, operation, effect)
      `,
      values: []
    });
  }

  function tenantValidation(tenantId) {
    if (!isNonEmptyString(tenantId)) {
      throw new Error('tenantId is required.');
    }

    return tenantId.trim();
  }

  async function countActiveGrants(tenantId) {
    await ensureInitialized();
    const safeTenantId = tenantValidation(tenantId);

    const sql =
      dialect === 'sqlite'
        ? `
            SELECT COUNT(*) AS count
            FROM policy_grants
            WHERE tenant_id = ? AND revoked_at IS NULL
          `
        : `
            SELECT COUNT(*)::int AS count
            FROM policy_grants
            WHERE tenant_id = $1 AND revoked_at IS NULL
          `;

    const values = dialect === 'sqlite' ? [safeTenantId] : [safeTenantId];

    const result = await databaseAdapter.execute({
      mode: 'read',
      sql,
      values
    });

    const count = Number(result.rows?.[0]?.count || 0);
    return Number.isFinite(count) ? count : 0;
  }

  async function listActiveGrants({ tenantId, walletAddress = null }) {
    await ensureInitialized();
    const safeTenantId = tenantValidation(tenantId);
    const hasWalletFilter = isNonEmptyString(walletAddress);
    const normalizedWallet = hasWalletFilter ? walletAddress.trim().toLowerCase() : null;

    const sqlByDialect = {
      sqlite: hasWalletFilter
        ? `
            SELECT *
            FROM policy_grants
            WHERE tenant_id = ? AND wallet_address = ? AND revoked_at IS NULL
            ORDER BY created_at DESC, grant_id DESC
          `
        : `
            SELECT *
            FROM policy_grants
            WHERE tenant_id = ? AND revoked_at IS NULL
            ORDER BY created_at DESC, grant_id DESC
          `,
      postgres: hasWalletFilter
        ? `
            SELECT *
            FROM policy_grants
            WHERE tenant_id = $1 AND wallet_address = $2 AND revoked_at IS NULL
            ORDER BY created_at DESC, grant_id DESC
          `
        : `
            SELECT *
            FROM policy_grants
            WHERE tenant_id = $1 AND revoked_at IS NULL
            ORDER BY created_at DESC, grant_id DESC
          `
    };

    const values = hasWalletFilter
      ? [safeTenantId, normalizedWallet]
      : [safeTenantId];

    const result = await databaseAdapter.execute({
      mode: 'read',
      sql: sqlByDialect[dialect],
      values
    });

    return (result.rows || []).map((row) => toCamelCaseGrant(row));
  }

  async function getGrantById({ tenantId, grantId }) {
    await ensureInitialized();
    const safeTenantId = tenantValidation(tenantId);
    if (!isNonEmptyString(grantId)) {
      throw new Error('grantId is required.');
    }

    const sql =
      dialect === 'sqlite'
        ? `
            SELECT *
            FROM policy_grants
            WHERE tenant_id = ? AND grant_id = ?
            LIMIT 1
          `
        : `
            SELECT *
            FROM policy_grants
            WHERE tenant_id = $1 AND grant_id = $2
            LIMIT 1
          `;

    const values = [safeTenantId, grantId.trim()];

    const result = await databaseAdapter.execute({
      mode: 'read',
      sql,
      values
    });

    return toCamelCaseGrant(result.rows?.[0] || null);
  }

  async function findActiveEquivalent({
    tenantId,
    walletAddress,
    scopeType,
    scopeId,
    operation,
    effect
  }) {
    await ensureInitialized();
    const safeTenantId = tenantValidation(tenantId);

    const sql =
      dialect === 'sqlite'
        ? `
            SELECT *
            FROM policy_grants
            WHERE
              tenant_id = ?
              AND wallet_address = ?
              AND scope_type = ?
              AND scope_id = ?
              AND operation = ?
              AND effect = ?
              AND revoked_at IS NULL
            ORDER BY created_at DESC, grant_id DESC
            LIMIT 1
          `
        : `
            SELECT *
            FROM policy_grants
            WHERE
              tenant_id = $1
              AND wallet_address = $2
              AND scope_type = $3
              AND scope_id = $4
              AND operation = $5
              AND effect = $6
              AND revoked_at IS NULL
            ORDER BY created_at DESC, grant_id DESC
            LIMIT 1
          `;

    const values = [
      safeTenantId,
      walletAddress.trim().toLowerCase(),
      scopeType,
      scopeId,
      operation,
      effect
    ];

    const result = await databaseAdapter.execute({
      mode: 'read',
      sql,
      values
    });

    return toCamelCaseGrant(result.rows?.[0] || null);
  }

  async function createGrant({
    tenantId,
    walletAddress,
    scopeType,
    scopeId,
    operation,
    effect,
    createdBy,
    createdAt,
    signatureHash
  }) {
    await ensureInitialized();
    const grant = {
      grantId: randomUUID(),
      tenantId: tenantValidation(tenantId),
      walletAddress: walletAddress.trim().toLowerCase(),
      scopeType,
      scopeId,
      operation,
      effect,
      createdBy: createdBy.trim().toLowerCase(),
      createdAt,
      signatureHash
    };

    const sql =
      dialect === 'sqlite'
        ? `
            INSERT INTO policy_grants (
              grant_id,
              tenant_id,
              wallet_address,
              scope_type,
              scope_id,
              operation,
              effect,
              created_by,
              created_at,
              signature_hash
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        : `
            INSERT INTO policy_grants (
              grant_id,
              tenant_id,
              wallet_address,
              scope_type,
              scope_id,
              operation,
              effect,
              created_by,
              created_at,
              signature_hash
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          `;

    await databaseAdapter.execute({
      mode: 'write',
      sql,
      values: [
        grant.grantId,
        grant.tenantId,
        grant.walletAddress,
        grant.scopeType,
        grant.scopeId,
        grant.operation,
        grant.effect,
        grant.createdBy,
        grant.createdAt,
        grant.signatureHash
      ]
    });

    return {
      ...grant,
      revokedAt: null,
      revokedBy: null
    };
  }

  async function revokeGrant({ tenantId, grantId, revokedBy, revokedAt }) {
    await ensureInitialized();
    const safeTenantId = tenantValidation(tenantId);
    const safeGrantId = grantId.trim();

    const sql =
      dialect === 'sqlite'
        ? `
            UPDATE policy_grants
            SET revoked_at = ?, revoked_by = ?
            WHERE tenant_id = ? AND grant_id = ? AND revoked_at IS NULL
          `
        : `
            UPDATE policy_grants
            SET revoked_at = $1, revoked_by = $2
            WHERE tenant_id = $3 AND grant_id = $4 AND revoked_at IS NULL
          `;

    const result = await databaseAdapter.execute({
      mode: 'write',
      sql,
      values: [revokedAt, revokedBy.trim().toLowerCase(), safeTenantId, safeGrantId]
    });

    return result.rowCount > 0;
  }

  return {
    ensureInitialized,
    countActiveGrants,
    listActiveGrants,
    getGrantById,
    findActiveEquivalent,
    createGrant,
    revokeGrant
  };
}
