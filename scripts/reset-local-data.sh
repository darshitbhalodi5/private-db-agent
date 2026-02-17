#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_FILE="${1:-$ROOT_DIR/data/private-db-agent.sqlite}"

if [[ -f "$DB_FILE" ]]; then
  rm -f "$DB_FILE"
  echo "Deleted SQLite database: $DB_FILE"
else
  echo "No SQLite database file found at: $DB_FILE"
fi
