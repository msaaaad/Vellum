#!/usr/bin/env bash
# One command to see the NDIS example end to end: starts Postgres, migrates, builds, seeds a
# tenant's full story, and verifies the resulting chain. Run with `pnpm example:ndis`.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/vellum_test}"
export DATABASE_URL
CLI="node packages/cli/dist/index.js"

echo "── Postgres"
docker compose up -d --wait postgres

echo "── Build"
pnpm build >/dev/null

echo "── Migrate"
$CLI migrate --database-url "$DATABASE_URL"

echo "── Seed (participant, consent, agreement, claim, incident, and the rest)"
SEED_LOG="$(cd examples/ndis-app && node dist/seed.js)"
echo "$SEED_LOG"
TENANT_ID="$(echo "$SEED_LOG" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)"
if [ -z "$TENANT_ID" ]; then
  echo "Could not find a tenant id in the seed output." >&2
  exit 1
fi

echo "── Verify"
$CLI verify --tenant "$TENANT_ID" --database-url "$DATABASE_URL"

echo
echo "Export an evidence pack with:"
echo "  $CLI export --tenant $TENANT_ID --format pdf --database-url \"$DATABASE_URL\" --out timeline.pdf"
