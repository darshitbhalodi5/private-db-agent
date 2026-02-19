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

## Docker package

Start API + Postgres with seeded data:

```bash
npm run docker:up
```

Docker host port defaults to `8080`. Override when needed:

```bash
APP_HOST_PORT=18080 docker compose up -d --build
```

Run smoke checks:

```bash
node scripts/demo-smoke.mjs http://localhost:<port>
node scripts/submission-smoke.mjs http://localhost:<port>
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
- `DEMO_TENANT_ID=tenant_demo`
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
  "tenantId": "tenant_demo",
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
`/v1/query` now requires both:
- capability/template allow from capability policy
- explicit grant allow from tenant policy grants (default deny when no matching grant)

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

## Eigen AI draft flow (Task 6)

AI draft endpoints:

- `POST /v1/ai/schema-draft`
- `POST /v1/ai/policy-draft`
- `POST /v1/ai/approve-draft`

Draft behavior:

- AI output is parsed into strict schema/policy structures.
- Schema draft is validated via existing schema DSL validator.
- AI response envelope is signed and verified before draft is accepted.
- Draft and approval records are persisted (`ai_drafts`, `ai_draft_approvals`).

Approval gate:

- AI-assisted schema execution (`aiAssist.source = eigen-ai`) is blocked unless:
  - valid draft record exists,
  - draft hash matches,
  - approval record exists,
  - approved actor matches `actorWallet`.

## EigenCompute runtime verification (Task 7)

Runtime attestation status endpoint:

- `GET /v1/runtime/attestation`

Sensitive operation gate:

- Schema apply (`schema:apply`)
- Policy grant create/revoke (`policy:grant:create`, `policy:grant:revoke`)
- Data writes (`data:insert`, `data:update`, `data:delete`)

Behavior:

- Runtime claims are resolved from configured source (`config`, `file`, or `url`).
- Claims are verified (required fields + freshness window + expiry checks).
- If `PROOF_RUNTIME_VERIFICATION_MODE=enforce`, sensitive operations are denied when verification fails.
- Query receipts now include runtime verification status and attestation claim hash.

Deployment artifacts:

- `deployment/eigencompute/agent-manifest.yaml`
- `deployment/eigencompute/runtime-attestation.sample.json`
- `scripts/render-eigencompute-manifest.sh` (or `npm run eigen:manifest`)
- `scripts/collect-runtime-evidence.mjs` (or `node scripts/collect-runtime-evidence.mjs <baseUrl>`)
- `submission/evidence/eigencompute/` (captured runtime attestation snapshot + summary + rendered manifest)

## A2A interoperability (Task 8)

A2A discovery and contract endpoints:

- `GET /.well-known/agent-card.json`
- `GET /v1/a2a/agent-card`
- `GET /v1/a2a/contracts`

A2A task lifecycle endpoints:

- `POST /v1/a2a/tasks`
- `GET /v1/a2a/tasks`
- `GET /v1/a2a/tasks/{taskId}`

Supported task types:

- `query.execute`
- `policy.preview-decision`
- `policy.grant.create`
- `policy.grant.revoke`
- `schema.apply`
- `data.execute`
- `ai.schema-draft`
- `ai.policy-draft`
- `ai.approve-draft`

A2A security and replay protection:

- HMAC request authentication headers:
  - `x-agent-id`
  - `x-agent-timestamp`
  - `x-agent-nonce`
  - `x-agent-signature`
- Task creation also requires `x-idempotency-key`.
- Nonce replay is blocked within TTL.
- Idempotency key replay with same payload returns existing task.
- Idempotency key reuse with different payload returns conflict.

Versioning and tracing:

- API version header: `x-api-version: v1`
- Correlation header: `x-correlation-id` (accepted or generated on every request)

## Observability and hardening (Task 9)

Operational metrics endpoint:

- `GET /v1/ops/metrics`

Structured logging:

- JSON request lifecycle logs with:
  - correlation ID
  - actor wallet
  - tenant ID
  - action
  - outcome
  - deny reason (for denied requests)
  - method/path
  - status code
  - duration

Metrics captured:

- `http_requests_total` (method/path/status)
- `http_request_duration_ms`
- `decision_outcomes_total` (outcome + reason + stage + domain + action)
- `action_decision_outcomes_total` (for `data`, `schema`, `policy`, `ai` routes)
- `action_deny_reasons_total` (for denied `data`, `schema`, `policy`, `ai` routes)
- `migration_apply_duration_ms`
- `rate_limited_total`
- `request_timeouts_total`

Security/reliability guards:

- In-memory fixed-window rate limiter.
- JSON body size limit (`413 PAYLOAD_TOO_LARGE` on overflow).
- Route execution timeout guard (`504 REQUEST_TIMEOUT`).
- Correlation + API version headers attached to responses.

Secret hygiene/rotation:

- Secrets should come from environment/secret manager only.
- Do not log private keys, shared secrets, signatures, or tokens.
- Rotate auth/agent shared secrets on a fixed cadence (`SECRET_ROTATION_DAYS`).
- Keep least-privilege separation between demo keys and production keys.

## Demo readiness and submission flow (Task 10)

Final smoke/demo commands:

- `npm test`
- `npm run build`
- `APP_HOST_PORT=18080 docker compose up -d --build` (or `8080` when free)
- `node scripts/demo-smoke.mjs http://localhost:<port>`
- `node scripts/submission-smoke.mjs http://localhost:<port>`
- `bash scripts/start-docker-demo.sh`

Task 10 smoke coverage:

- health, runtime attestation, A2A discovery/contracts, ops metrics
- allow/deny demo query scenarios
- A2A task lifecycle checks:
  - task create
  - idempotent replay
  - idempotency conflict for changed payload
  - task fetch/list

Submission artifacts:

- `submission/DEMO_RUNBOOK.md`
- `submission/SUBMISSION_CHECKLIST.md`
- `submission/KNOWN_LIMITATIONS_AND_TRUST_ASSUMPTIONS.md`

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
        "verification": {
          "mode": "report-only",
          "status": "verified",
          "source": "config",
          "checkedAt": "2026-02-18T00:00:00.000Z",
          "enforced": false,
          "verified": true,
          "issues": []
        },
        "attestation": {
          "appId": null,
          "imageDigest": null,
          "attestationReportHash": null,
          "onchainDeploymentTxHash": null,
          "claimsHash": null
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
- `PROOF_RUNTIME_VERIFICATION_MODE=report-only` (`off`, `report-only`, `enforce`)
- `PROOF_ATTESTATION_SOURCE=config` (`config`, `file`, `url`)
- `PROOF_ATTESTATION_FILE_PATH=...` (required for `file` source)
- `PROOF_ATTESTATION_ENDPOINT=...` (required for `url` source)
- `PROOF_ATTESTATION_MAX_AGE_SECONDS=900`
- `PROOF_APP_ID=...`
- `PROOF_IMAGE_DIGEST=...`
- `PROOF_ATTESTATION_REPORT_HASH=...`
- `PROOF_ONCHAIN_DEPLOYMENT_TX_HASH=...`
- `A2A_ENABLED=true`
- `A2A_ALLOW_UNSIGNED=false`
- `A2A_SHARED_SECRET=...`
- `A2A_ALLOWED_AGENT_IDS=agent-a,agent-b`
- `A2A_ADMIN_AGENT_IDS=orchestrator-agent`
- `A2A_TASK_ALLOWLIST_JSON={"agent-a":["query.execute","policy.preview-decision"]}`
- `A2A_NONCE_TTL_SECONDS=300`
- `A2A_MAX_FUTURE_SKEW_SECONDS=60`
- `LOG_LEVEL=info`
- `METRICS_ENABLED=true`
- `METRICS_ROUTE_ENABLED=true`
- `MAX_JSON_BODY_BYTES=1048576`
- `REQUEST_TIMEOUT_MS=15000`
- `RATE_LIMIT_ENABLED=true`
- `RATE_LIMIT_WINDOW_MS=60000`
- `RATE_LIMIT_MAX_REQUESTS=300`
- `SECRET_ROTATION_DAYS=30`
