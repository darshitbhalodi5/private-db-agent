# Submission Checklist

## Core Features

- [x] Signed request authentication (wallet signature + nonce freshness).
- [x] Capability-based policy enforcement.
- [x] Template-constrained SQL execution.
- [x] Query receipts with hash-linked metadata.
- [x] Verification metadata exposure in API responses.
- [x] Demo UI with allow/deny scenarios.
- [x] Runtime attestation status endpoint (`/v1/runtime/attestation`).
- [x] Sensitive-op deny gate when attestation verification fails in enforce mode.
- [x] A2A agent card and task lifecycle endpoints.
- [x] Idempotency keys and replay-safe A2A task handling.
- [x] Agent-to-agent authentication/authorization controls.
- [x] Structured request logging with correlation IDs.
- [x] Ops metrics endpoint (`/v1/ops/metrics`) with decision/migration telemetry.
- [x] Rate limiting, JSON body size limits, and timeout guards.
- [x] Secret rotation and config hygiene notes in docs.

## Packaging

- [x] Dockerfile for API runtime.
- [x] Docker Compose for API + Postgres.
- [x] Postgres init + seed SQL.
- [x] Local `.env.example` with all variables.
- [x] Demo smoke script (`scripts/demo-smoke.mjs`).
- [x] Submission smoke script (`scripts/submission-smoke.mjs`).
- [x] Demo runbook (`submission/DEMO_RUNBOOK.md`).
- [x] EigenCompute deployment manifest (`deployment/eigencompute/agent-manifest.yaml`).
- [x] Runtime attestation sample artifact (`deployment/eigencompute/runtime-attestation.sample.json`).
- [x] Manifest render helper (`scripts/render-eigencompute-manifest.sh`).
- [x] Runtime evidence collector (`scripts/collect-runtime-evidence.mjs`).
- [x] Captured runtime evidence bundle (`submission/evidence/eigencompute/`).
- [x] Known limitations and trust assumptions document.

## Pre-Submission Commands

```bash
npm test
node scripts/demo-smoke.mjs http://localhost:8080
node scripts/submission-smoke.mjs http://localhost:8080
```

## Optional Demo Command

```bash
bash scripts/start-docker-demo.sh
```
