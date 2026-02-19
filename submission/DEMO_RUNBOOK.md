# Demo Runbook

## Objective

Demonstrate end-to-end private database access flow with signed requests, policy enforcement, template-constrained queries, and cryptographic receipts.

## Port Selection

Docker maps host port using `APP_HOST_PORT`:

- Default host port: `8080`
- If `8080` is busy, use another host port (example: `18080`)

```bash
export APP_HOST_PORT="${APP_HOST_PORT:-8080}"
export BASE_URL="http://localhost:${APP_HOST_PORT}"
```

## Quick Start (Docker)

1. Run tests before demo:

```bash
npm test
```

Expected result:

- All test suites pass.

2. Build all workspaces:

```bash
npm run build
```

Expected result:

- Build completes without errors.

3. Start the full stack:

```bash
export APP_HOST_PORT="${APP_HOST_PORT:-8080}"
docker compose up -d --build
```

4. Verify API health:

```bash
curl -s "${BASE_URL}/health"
```

Expected result:

- HTTP `200`
- Response includes `"status":"ok"`

5. Open demo UI:

- `${BASE_URL}/demo`

6. Run automated matrix verification:

```bash
node scripts/demo-smoke.mjs "${BASE_URL}"
```

Expected result:

- Script exits `0`
- JSON output contains `totals.failed: 0`

7. Run final submission smoke verification:

```bash
node scripts/submission-smoke.mjs "${BASE_URL}"
```

Expected result:

- Script exits `0`
- JSON output contains `totals.fail: 0`

8. Verify runtime attestation status:

```bash
curl -s "${BASE_URL}/v1/runtime/attestation"
```

Expected result:

- HTTP `200`
- JSON includes `runtime.verificationStatus` and `runtime.claimsHash`

9. Verify A2A agent discovery endpoint:

```bash
curl -s "${BASE_URL}/.well-known/agent-card.json"
```

Expected result:

- HTTP `200`
- JSON includes:
  - `code: "A2A_AGENT_CARD"`
  - `agentCard.protocolVersion`
  - `agentCard.endpoints`

10. Verify ops metrics endpoint:

```bash
curl -s "${BASE_URL}/v1/ops/metrics"
```

Expected result:

- HTTP `200`
- JSON includes counters for:
  - `decision_outcomes_total`
  - `action_decision_outcomes_total`
  - `action_deny_reasons_total`
  - `rate_limited_total`
  - `request_timeouts_total`

## Demo Scenarios

1. `allow-balance-read`
- Expected HTTP status: `200`
- Why: valid signature and allowed template/capability.

2. `deny-policy-write-attempt`
- Expected HTTP status: `403`
- Why: capability/template mismatch (write template under read capability).

3. `deny-auth-signer-mismatch`
- Expected HTTP status: `401`
- Why: signature signer does not match requester field.

## Judge Flow (Recommended)

1. Open `/demo` and run the three scenarios in order.
2. Highlight the response `receipt` object:
- `requestHash`
- `decisionHash`
- `verificationHash`
- `verification.runtime` metadata
3. Show runtime verification endpoint output:
- `verificationMode`
- `verificationStatus`
- `claimsHash`
4. Explain enforce mode:
- `PROOF_RUNTIME_VERIFICATION_MODE=enforce` denies sensitive operations when attestation verification fails.
5. Highlight `audit` status for each run.
6. Show `access_log_recent` query from the API (or via scenario results) to prove persistence.
7. Run `node scripts/submission-smoke.mjs "${BASE_URL}"` and show:
- allow/deny scenario checks
- A2A task create/replay/conflict checks
- runtime and metrics endpoint checks
- final pass/fail summary

## Required Env For Full Smoke

For A2A signed smoke checks:

- `A2A_SHARED_SECRET` must match API runtime value (default docker value: `demo-a2a-secret`)
- optional `A2A_AGENT_ID` (default: `demo-agent`)

## Limitations and Trust Notes

Review before submission:

- `submission/KNOWN_LIMITATIONS_AND_TRUST_ASSUMPTIONS.md`

## Shutdown

```bash
docker compose down -v
```
