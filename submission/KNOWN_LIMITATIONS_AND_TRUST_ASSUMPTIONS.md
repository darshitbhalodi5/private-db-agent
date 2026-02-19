# Known Limitations and Trust Assumptions

## Trust Assumptions

1. Runtime confidentiality and isolation properties are assumed from EigenCompute deployment and attestation guarantees.
2. Operator trust is minimized for data access, but availability still depends on hosting/operator infrastructure.
3. Client wallets and signing keys are assumed to be securely managed by users/agents.
4. A2A shared-secret authentication assumes secure secret distribution and storage between agents.

## Current Limitations

1. Metrics are in-memory and reset on process restart (no long-term telemetry backend in this milestone).
2. Rate limiting is in-memory and per-instance (not globally coordinated across replicas).
3. A2A task execution is synchronous within request lifecycle (no async worker queue in this milestone).
4. A2A authentication uses HMAC shared secret; mutual TLS / asymmetric agent identities are not yet implemented.
5. Runtime attestation verification supports configured/file/url sources but does not validate external trust roots on-chain.
6. Secret rotation cadence is documented but not automatically enforced by a secret manager integration.

## Operational Notes

1. For production, place all secrets in managed secret stores and rotate using a fixed schedule.
2. Deploy centralized metrics/logging backends for persistence and cross-instance visibility.
3. Add background workers + durable queue for A2A task execution at scale.
4. Add stronger inter-agent identity primitives (mTLS or asymmetric signatures) beyond shared-secret mode.
