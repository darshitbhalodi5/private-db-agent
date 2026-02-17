# Submission Checklist

## Core Features

- [x] Signed request authentication (wallet signature + nonce freshness).
- [x] Capability-based policy enforcement.
- [x] Template-constrained SQL execution.
- [x] Query receipts with hash-linked metadata.
- [x] Verification metadata exposure in API responses.
- [x] Demo UI with allow/deny scenarios.

## Packaging

- [x] Dockerfile for API runtime.
- [x] Docker Compose for API + Postgres.
- [x] Postgres init + seed SQL.
- [x] Local `.env.example` with all variables.
- [x] Demo smoke script (`scripts/demo-smoke.mjs`).
- [x] Demo runbook (`submission/DEMO_RUNBOOK.md`).

## Pre-Submission Commands

```bash
npm test
node scripts/demo-smoke.mjs http://localhost:8080
```

## Optional Demo Command

```bash
bash scripts/start-docker-demo.sh
```
