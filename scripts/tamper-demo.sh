#!/usr/bin/env bash
# DOMAIN_CHECKLIST.md Phase 8 — "the tamper test / demo": this is the README/interview story.
# Seeds a real chain (participant -> consent -> claim, via examples/ndis-app), verifies INTACT,
# tampers one row as a superuser exactly the way an attacker with full DB access could, verifies
# TAMPERED, and shows the exported evidence pack's cover flip to FAILED. Every step runs the
# real `vellum` CLI — nothing here is reimplemented for the demo's sake.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/vellum_test}"
PAUSE="${DEMO_PAUSE:-1}"
CLI="node packages/cli/dist/index.js"

step() {
  echo
  echo "── $1 ──"
  echo
  sleep "$PAUSE"
}

run() {
  echo "\$ $*"
  eval "$@"
}

step "0/6 · Bring up Postgres and apply the migration"
run "docker compose up -d --wait"
run "$CLI migrate --database-url \"$DATABASE_URL\""

step "1/6 · Build everything (core, storage-pg, nestjs, cli, examples/ndis-app)"
run "pnpm build"

step "2/6 · Seed a real chain: participant → consent → agreement → claim → incident"
SEED_LOG="$(cd examples/ndis-app && node dist/seed.js)"
echo "$SEED_LOG"
TENANT_ID="$(echo "$SEED_LOG" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)"
if [ -z "$TENANT_ID" ]; then
  echo "Could not find a tenant id in the seed output." >&2
  exit 1
fi
echo
echo "Tenant: $TENANT_ID"

step "3/6 · vellum verify — expect INTACT"
run "$CLI verify --tenant \"$TENANT_ID\" --database-url \"$DATABASE_URL\""

step "4/6 · Tamper, as a superuser: UPDATE audit_events SET changes='{}' WHERE action='consent.granted'"
run "node scripts/tamper-row.mjs \"$TENANT_ID\" \"$DATABASE_URL\""

step "5/6 · vellum verify — expect TAMPERED at seq N"
set +e
run "$CLI verify --tenant \"$TENANT_ID\" --database-url \"$DATABASE_URL\""
VERIFY_EXIT=$?
set -e
if [ "$VERIFY_EXIT" -eq 0 ]; then
  echo "Expected verify to fail (exit 1) on a tampered chain, but it exited 0." >&2
  exit 1
fi

step "6/6 · vellum export --format pdf — expect the cover to say FAILED"
set +e
run "$CLI export --tenant \"$TENANT_ID\" --format pdf --database-url \"$DATABASE_URL\" --out /tmp/vellum-tamper-demo.pdf"
EXPORT_EXIT=$?
set -e
if [ "$EXPORT_EXIT" -eq 0 ]; then
  echo "Expected export to exit 1 for a FAILED (tampered) pack, but it exited 0." >&2
  exit 1
fi
if [ ! -s /tmp/vellum-tamper-demo.pdf ]; then
  echo "Expected /tmp/vellum-tamper-demo.pdf to exist — export didn't write a pack." >&2
  exit 1
fi

echo
echo "Evidence pack (cover says FAILED): /tmp/vellum-tamper-demo.pdf"
echo
echo "Done. The chain caught the tamper — a Postgres superuser bypassed the append-only trigger"
echo "and rewrote one row, and the hash chain still proved it happened."
