#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Starting Docker services..."
docker compose up -d --build

echo "Waiting for API health..."
for i in {1..60}; do
  if curl -fsS http://localhost:8080/health >/dev/null 2>&1; then
    echo "API is healthy."
    break
  fi
  sleep 2
  if [[ "$i" -eq 60 ]]; then
    echo "API did not become healthy in time."
    exit 1
  fi
 done

echo "Running demo smoke checks..."
node scripts/demo-smoke.mjs http://localhost:8080

echo "Running submission smoke checks..."
node scripts/submission-smoke.mjs http://localhost:8080

echo "Done. Open http://localhost:8080/demo"
