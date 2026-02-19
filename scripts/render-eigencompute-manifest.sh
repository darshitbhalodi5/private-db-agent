#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

IMAGE_REF="${1:-ghcr.io/darshitbhalodi5/private-db-agent:demo-2026-02-19}"
IMAGE_DIGEST="${2:-sha256:82ed5c34d8b572612b2199932cd260ec619e1887eeb6a2a86f759ae4d77c6626}"
APP_ID="${3:-private-db-agent-demo-2026}"
OUTPUT_PATH="${4:-$ROOT_DIR/deployment/eigencompute/generated-agent-manifest.yaml}"

if [[ "$IMAGE_REF" == *"your-org"* ]]; then
  echo "IMAGE_REF must be a concrete registry path, not a placeholder." >&2
  exit 1
fi

if [[ "$IMAGE_DIGEST" == *"replace-with"* ]]; then
  echo "IMAGE_DIGEST must be a concrete digest, not a placeholder." >&2
  exit 1
fi

if [[ "$APP_ID" == *"replace-with"* ]]; then
  echo "APP_ID must be a concrete deployment app ID, not a placeholder." >&2
  exit 1
fi

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
