# Eigen Private DB Agent

Policy-gated database agent for hackathon delivery. The service is designed for an EigenCompute-style confidential runtime and enforces strict query access policy before execution.

## MVP intent

- Handle signed query requests from users/agents.
- Enforce capability-based authorization before any DB operation.
- Return a receipt object that captures decision metadata.
- Keep trust assumptions explicit for EigenCompute Mainnet Alpha.

## Current status

Implemented:

- API server with health endpoint.
- Query endpoint with signature/auth and capability-policy gates.
- Template-constrained query execution (`wallet_balances`, `wallet_positions`, `wallet_transactions`, audit templates).
- DB adapter factory with `sqlite` local fallback and `postgres` runtime option.
- Environment config validation.
- Nonce replay protection and timestamp freshness checks.
- Unit tests for auth, policy, query orchestration, and DB adapters.

## Run locally

```bash
npm test
npm run start
```

Server defaults to `http://localhost:8080`.

## Database mode

Default local mode:

- `DB_DRIVER=sqlite`
- `SQLITE_FILE_PATH=./data/private-db-agent.sqlite`

Postgres mode:

- `DB_DRIVER=postgres`
- `DATABASE_URL=postgres://...`
- optional: `POSTGRES_SSL=true`, `POSTGRES_MAX_POOL_SIZE=10`

## Query request contract (current)

`POST /v1/query` expects:

```json
{
  "requestId": "req-1",
  "requester": "0xYourWalletAddress",
  "capability": "balances:read",
  "queryTemplate": "wallet_balances",
  "queryParams": { "chainId": 1 },
  "auth": {
    "nonce": "nonce-1",
    "signedAt": "2026-02-17T10:00:00.000Z",
    "signature": "0x..."
  }
}
```

Signed message format:

```text
PRIVATE_DB_AGENT_AUTH_V1
<stable-json-envelope>
```

Capabilities and templates are mapped in `src/policy/capabilityRules.js`.
Template definitions (SQL + params) are in `src/query/templateRegistry.js`.

## Important note

DB execution, attestation receipts, and demo UI are planned in subsequent milestones.
