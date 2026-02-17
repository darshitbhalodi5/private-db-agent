# Eigen Private DB Agent

Policy-gated database agent for hackathon delivery. The service is designed for an EigenCompute-style confidential runtime and enforces strict query access policy before execution.

## MVP intent

- Handle signed query requests from users/agents.
- Enforce capability-based authorization before any DB operation.
- Return a receipt object that captures decision metadata.
- Keep trust assumptions explicit for EigenCompute Mainnet Alpha.

## Current status

Foundation scaffold is implemented:

- API server with health endpoint.
- Query endpoint placeholder with structured responses.
- Environment config validation.
- Basic tests for route behavior.
- Execution plan and architecture docs.

## Run locally

```bash
npm test
npm run start
```

Server defaults to `http://localhost:8080`.

## Important note

This repository currently provides the foundation layer only. DB execution, wallet signature verification, attestation receipts, and demo UI are planned in subsequent milestones.
