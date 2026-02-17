export const TEMPLATE_MODE = Object.freeze({
  READ: 'read',
  WRITE: 'write'
});

export const QUERY_TEMPLATES = Object.freeze({
  wallet_balances: Object.freeze({
    mode: TEMPLATE_MODE.READ,
    sql: Object.freeze({
      postgres: `
        SELECT wallet_address, chain_id, asset_symbol, balance, updated_at
        FROM wallet_balances
        WHERE wallet_address = $1 AND chain_id = $2
        ORDER BY updated_at DESC
        LIMIT $3
      `,
      sqlite: `
        SELECT wallet_address, chain_id, asset_symbol, balance, updated_at
        FROM wallet_balances
        WHERE wallet_address = ? AND chain_id = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `
    }),
    params: Object.freeze([
      Object.freeze({ name: 'walletAddress', type: 'address', required: true }),
      Object.freeze({ name: 'chainId', type: 'integer', required: true, min: 1 }),
      Object.freeze({ name: 'limit', type: 'integer', required: false, default: 50, min: 1, max: 200 })
    ]),
    bind: (params) => [params.walletAddress, params.chainId, params.limit]
  }),
  wallet_positions: Object.freeze({
    mode: TEMPLATE_MODE.READ,
    sql: Object.freeze({
      postgres: `
        SELECT wallet_address, protocol, position_value_usd, updated_at
        FROM wallet_positions
        WHERE wallet_address = $1
        ORDER BY updated_at DESC
      `,
      sqlite: `
        SELECT wallet_address, protocol, position_value_usd, updated_at
        FROM wallet_positions
        WHERE wallet_address = ?
        ORDER BY updated_at DESC
      `
    }),
    params: Object.freeze([
      Object.freeze({ name: 'walletAddress', type: 'address', required: true })
    ]),
    bind: (params) => [params.walletAddress]
  }),
  wallet_transactions: Object.freeze({
    mode: TEMPLATE_MODE.READ,
    sql: Object.freeze({
      postgres: `
        SELECT wallet_address, chain_id, tx_hash, direction, amount, created_at
        FROM wallet_transactions
        WHERE wallet_address = $1 AND chain_id = $2
        ORDER BY created_at DESC
        LIMIT $3
      `,
      sqlite: `
        SELECT wallet_address, chain_id, tx_hash, direction, amount, created_at
        FROM wallet_transactions
        WHERE wallet_address = ? AND chain_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `
    }),
    params: Object.freeze([
      Object.freeze({ name: 'walletAddress', type: 'address', required: true }),
      Object.freeze({ name: 'chainId', type: 'integer', required: true, min: 1 }),
      Object.freeze({ name: 'limit', type: 'integer', required: false, default: 25, min: 1, max: 200 })
    ]),
    bind: (params) => [params.walletAddress, params.chainId, params.limit]
  }),
  access_log_recent: Object.freeze({
    mode: TEMPLATE_MODE.READ,
    sql: Object.freeze({
      postgres: `
        SELECT request_id, requester, capability, query_template, decision, created_at
        FROM access_log
        ORDER BY created_at DESC
        LIMIT $1
      `,
      sqlite: `
        SELECT request_id, requester, capability, query_template, decision, created_at
        FROM access_log
        ORDER BY created_at DESC
        LIMIT ?
      `
    }),
    params: Object.freeze([
      Object.freeze({ name: 'limit', type: 'integer', required: false, default: 25, min: 1, max: 200 })
    ]),
    bind: (params) => [params.limit]
  }),
  policy_denies_recent: Object.freeze({
    mode: TEMPLATE_MODE.READ,
    sql: Object.freeze({
      postgres: `
        SELECT request_id, requester, capability, query_template, decision, created_at
        FROM access_log
        WHERE decision = 'deny'
        ORDER BY created_at DESC
        LIMIT $1
      `,
      sqlite: `
        SELECT request_id, requester, capability, query_template, decision, created_at
        FROM access_log
        WHERE decision = 'deny'
        ORDER BY created_at DESC
        LIMIT ?
      `
    }),
    params: Object.freeze([
      Object.freeze({ name: 'limit', type: 'integer', required: false, default: 25, min: 1, max: 200 })
    ]),
    bind: (params) => [params.limit]
  }),
  access_log_insert: Object.freeze({
    mode: TEMPLATE_MODE.WRITE,
    sql: Object.freeze({
      postgres: `
        INSERT INTO access_log (request_id, requester, capability, query_template, decision, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      sqlite: `
        INSERT INTO access_log (request_id, requester, capability, query_template, decision, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    }),
    params: Object.freeze([
      Object.freeze({ name: 'requestId', type: 'string', required: true, minLength: 1, maxLength: 100 }),
      Object.freeze({ name: 'requester', type: 'address', required: true }),
      Object.freeze({ name: 'capability', type: 'string', required: true, minLength: 1, maxLength: 120 }),
      Object.freeze({ name: 'queryTemplate', type: 'string', required: true, minLength: 1, maxLength: 120 }),
      Object.freeze({ name: 'decision', type: 'enum', required: true, values: ['allow', 'deny'] }),
      Object.freeze({ name: 'createdAt', type: 'isoDate', required: true })
    ]),
    bind: (params) => [
      params.requestId,
      params.requester,
      params.capability,
      params.queryTemplate,
      params.decision,
      params.createdAt
    ]
  })
});

export function getQueryTemplate(queryTemplate) {
  return QUERY_TEMPLATES[queryTemplate] || null;
}
