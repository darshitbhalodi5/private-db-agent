#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

IMAGE_REF="${1:-ghcr.io/your-org/private-db-agent:latest}"
IMAGE_DIGEST="${2:-sha256:replace-with-production-image-digest}"
APP_ID="${3:-private-db-agent-demo}"
OUTPUT_PATH="${4:-$ROOT_DIR/deployment/eigencompute/generated-agent-manifest.yaml}"

cat >"$OUTPUT_PATH" <<EOF
apiVersion: eigencloud/v1alpha1
kind: AgentDeployment
metadata:
  name: private-db-agent
  labels:
    app: private-db-agent
spec:
  runtime:
    type: eigencompute
    appId: ${APP_ID}
    image: ${IMAGE_REF}
    imageDigest: ${IMAGE_DIGEST}
  service:
    port: 8080
    healthPath: /health
  env:
    - name: NODE_ENV
      value: production
    - name: PORT
      value: "8080"
    - name: DB_DRIVER
      value: postgres
    - name: DATABASE_URL
      valueFrom:
        secretKeyRef:
          name: private-db-agent-secrets
          key: database_url
    - name: PROOF_RUNTIME_VERIFICATION_MODE
      value: enforce
    - name: PROOF_ATTESTATION_SOURCE
      value: file
    - name: PROOF_ATTESTATION_FILE_PATH
      value: /etc/private-db-agent/runtime-attestation.json
    - name: PROOF_ATTESTATION_MAX_AGE_SECONDS
      value: "900"
    - name: PROOF_TRUST_MODEL
      value: eigencompute-mainnet-alpha
  volumes:
    - name: runtime-attestation
      mountPath: /etc/private-db-agent
      readOnly: true
      source:
        configMap:
          name: private-db-agent-attestation
EOF

echo "Generated EigenCompute manifest at: $OUTPUT_PATH"
