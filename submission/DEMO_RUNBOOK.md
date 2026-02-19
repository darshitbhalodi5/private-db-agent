# Demo Runbook

## Objective

Demonstrate end-to-end private database access flow with signed requests, policy enforcement, template-constrained queries, and cryptographic receipts.

## Quick Start (Docker)

1. Start the full stack:

```bash
docker compose up -d --build
```

2. Verify API health:

```bash
curl -s http://localhost:8080/health
```

3. Open demo UI:

- http://localhost:8080/demo

4. Optional automated scenario verification:

```bash
node scripts/demo-smoke.mjs http://localhost:8080
```

5. Run final submission smoke verification:

```bash
node scripts/submission-smoke.mjs http://localhost:8080
```

6. Verify runtime attestation status:

```bash
curl -s http://localhost:8080/v1/runtime/attestation
```

7. Verify A2A agent discovery endpoint:

```bash
curl -s http://localhost:8080/.well-known/agent-card.json
```

8. Verify ops metrics endpoint:

```bash
curl -s http://localhost:8080/v1/ops/metrics
```

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
7. Run `node scripts/submission-smoke.mjs http://localhost:8080` and show:
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
