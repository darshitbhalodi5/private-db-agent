CREATE TABLE IF NOT EXISTS wallet_balances (
  wallet_address TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  asset_symbol TEXT NOT NULL,
  balance NUMERIC NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_positions (
  wallet_address TEXT NOT NULL,
  protocol TEXT NOT NULL,
  position_value_usd NUMERIC NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  wallet_address TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS access_log (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL,
  requester TEXT NOT NULL,
  capability TEXT NOT NULL,
  query_template TEXT NOT NULL,
  decision TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_access_log_created_at ON access_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_balances_wallet_chain ON wallet_balances (wallet_address, chain_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet_chain ON wallet_transactions (wallet_address, chain_id);

INSERT INTO wallet_balances (wallet_address, chain_id, asset_symbol, balance, updated_at)
VALUES
  ('0x8ba1f109551bd432803012645ac136ddd64dba72', 1, 'ETH', 2.35, NOW()),
  ('0x8ba1f109551bd432803012645ac136ddd64dba72', 1, 'USDC', 1250.12, NOW() - INTERVAL '1 hour'),
  ('0x8ba1f109551bd432803012645ac136ddd64dba72', 137, 'MATIC', 84.43, NOW())
ON CONFLICT DO NOTHING;

INSERT INTO wallet_positions (wallet_address, protocol, position_value_usd, updated_at)
VALUES
  ('0x8ba1f109551bd432803012645ac136ddd64dba72', 'Aave', 820.40, NOW()),
  ('0x8ba1f109551bd432803012645ac136ddd64dba72', 'Uniswap V3', 491.10, NOW() - INTERVAL '1 hour')
ON CONFLICT DO NOTHING;

INSERT INTO wallet_transactions (wallet_address, chain_id, tx_hash, direction, amount, created_at)
VALUES
  ('0x8ba1f109551bd432803012645ac136ddd64dba72', 1, '0x41fb8f1f8809cbf7f23cb58f7f6fa53f4b95fdf3fc4b81a12a31aa4f9c037001', 'in', 0.50, NOW()),
  ('0x8ba1f109551bd432803012645ac136ddd64dba72', 1, '0xaddab7caef90e0d4fd8c4ff2cb98a7d5a6478a63f5f7a95d02f0f90ad2d6ff77', 'out', 0.12, NOW() - INTERVAL '1 hour')
ON CONFLICT DO NOTHING;

INSERT INTO access_log (request_id, requester, capability, query_template, decision, created_at)
VALUES
  ('seed-allow-1', '0x8ba1f109551bd432803012645ac136ddd64dba72', 'balances:read', 'wallet_balances', 'allow', NOW()),
  ('seed-deny-1', '0x8ba1f109551bd432803012645ac136ddd64dba72', 'balances:read', 'access_log_insert', 'deny', NOW() - INTERVAL '1 hour')
ON CONFLICT DO NOTHING;
