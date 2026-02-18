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
- Proof receipt generation with hash-linked decision metadata on every response.
- Verification metadata exposure (trust model, runtime attestation fields, dialect).
- Audit log persistence status included in API responses.
- Demo runner UI with signed allow/deny scenarios and receipt visualization.
- Dockerized packaging for API + Postgres with seeded dataset.
- Demo runbook and submission checklist under `submission/`.
- Environment config validation.
- Nonce replay protection and timestamp freshness checks.
- Unit tests for auth, policy, query orchestration, and DB adapters.

## Run locally

```bash
npm run test
npm run dev:api
```

API defaults to `http://localhost:8080`.

For frontend:

```bash
npm run dev:web
```

Frontend defaults to `http://localhost:3000`.

## Monorepo layout

- `apps/agent-api`: backend API service
- `apps/web`: Next.js frontend app
- `packages/shared-types`: shared domain constants/types
- `packages/policy-core`: policy engine package scaffold
- `packages/receipts`: receipt package scaffold

## Docker package

Start API + Postgres with seeded data:

```bash
npm run docker:up
```

Run smoke checks:

```bash
npm run demo:smoke
```

Stop and cleanup:

```bash
npm run docker:down
```

Or run the helper script:

```bash
bash scripts/start-docker-demo.sh
```

## Demo UI

Open:

- `GET /demo`

Demo helper APIs:

- `GET /v1/demo/scenarios`
- `GET /v1/demo/payload?scenario=<scenarioId>`

Demo env vars:

- `DEMO_ENABLED=true`
- `DEMO_SIGNER_PRIVATE_KEY=...` (optional)
- `DEMO_ALT_SIGNER_PRIVATE_KEY=...` (optional)
- `DEMO_TARGET_WALLET_ADDRESS=0x8ba1f109551bd432803012645ac136ddd64dba72`
- `DEMO_DEFAULT_CHAIN_ID=1`

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

Capabilities and templates are mapped in `apps/agent-api/src/policy/capabilityRules.js`.
Template definitions (SQL + params) are in `apps/agent-api/src/query/templateRegistry.js`.

## Policy grant APIs (Task 3)

The policy engine now supports wallet grants scoped by database/table and operation:

- `GET /v1/policy/grants?tenantId=<tenantId>&walletAddress=<optionalWallet>`
- `POST /v1/policy/grants`
- `POST /v1/policy/grants/revoke`
- `POST /v1/policy/preview-decision`

Grant creation/revoke payloads require:

- `tenantId`
- `actorWallet`
- signed `auth` envelope (when `AUTH_ENABLED=true`)

Decision preview evaluates precedence in deterministic order:

1. table-operation deny
2. table-operation allow
3. db-operation deny
4. db-operation allow
5. table `all` deny
6. table `all` allow
7. db `all` deny
8. db `all` allow
9. fallback deny

## Schema apply and data operations (Task 4)

Transactional schema apply endpoint:

- `POST /v1/control-plane/apply`

Behavior:

- Validates and compiles schema DSL to deterministic migration plan.
- Applies migration plan inside a DB transaction.
- Rolls back all DDL changes on partial failure.
- Registers created tables in `managed_tables`.
- Rejects direct SQL input (`sql`, `rawSql`).

Constrained runtime data operation endpoint:

- `POST /v1/data/execute`

Supported operations:

- `read`
- `insert`
- `update`
- `delete`

Execution rules:

- No raw SQL accepted from clients.
- Table name and column identifiers are validated.
- Table must exist in `managed_tables` for tenant.
- Signed actor auth + policy decision are enforced before execution.

## Agent role enforcement (Task 5)

Privileged mutation/execution paths now enforce:

- Signed actor envelope validation (nonce + timestamp + signature).
- Policy decision check for requested scope/operation.
- Explicit rejection of bypass flags (`agentOverride`, `bypassPolicy`, `executeAsAgent`, etc.).

Result:

- Agent cannot execute privileged actions without a valid signed actor.
- Agent cannot bypass policy with internal override-style payload fields.

## Response receipt contract

Every query response now includes:

- `receipt`: hash-linked proof object (`requestHash`, `decisionHash`, `verificationHash`, `receiptId`).
- `audit`: audit-log persistence status (`logged`, `code`, optional `message`).

Example response fields:

```json
{
  "requestId": "req-1",
  "receipt": {
    "version": "1.0",
    "receiptId": "rcpt_...",
    "hashAlgorithm": "sha256",
    "requestHash": "...",
    "decisionHash": "...",
    "verificationHash": "...",
    "verification": {
      "service": {
        "name": "private-db-agent-api",
        "version": "0.1.0",
        "environment": "development"
      },
      "runtime": {
        "trustModel": "eigencompute-mainnet-alpha",
        "databaseDialect": "sqlite",
        "attestation": {
          "appId": null,
          "imageDigest": null,
          "attestationReportHash": null,
          "onchainDeploymentTxHash": null
        }
      },
      "decision": {
        "outcome": "allow",
        "stage": "execution",
        "code": "QUERY_EXECUTED"
      }
    }
  },
  "audit": {
    "logged": true,
    "code": "LOGGED",
    "message": null
  }
}
```

Proof/verification env vars:

- `PROOF_RECEIPT_ENABLED=true`
- `PROOF_HASH_ALGORITHM=sha256`
- `PROOF_TRUST_MODEL=eigencompute-mainnet-alpha`
- `PROOF_APP_ID=...`
- `PROOF_IMAGE_DIGEST=...`
- `PROOF_ATTESTATION_REPORT_HASH=...`
- `PROOF_ONCHAIN_DEPLOYMENT_TX_HASH=...`

## Important note

Attestation report verification against external trust roots and production-grade deployment hardening are planned in subsequent milestones.
