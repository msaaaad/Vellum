#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/vellum_test}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
TARBALLS="$WORK/tarballs"
APP="$WORK/fresh-app"
mkdir -p "$TARBALLS" "$APP"

echo "-- build + pack the publishable packages"
pnpm build >/dev/null
PACKAGES="core storage-pg storage-prisma nestjs cli"
for p in $PACKAGES; do
  (cd "packages/$p" && pnpm pack --pack-destination "$TARBALLS" >/dev/null)
done

echo "-- create a fresh app and install the tarballs"
cp -r scripts/quickstart-app/src scripts/quickstart-app/tsconfig.json "$APP/"
cd "$APP"
node - "$TARBALLS" <<'EOF'
const fs = require('node:fs');
const path = require('node:path');
const dir = process.argv[2];
const file = (n) => 'file:' + path.join(dir, `getattestly-${n}-0.1.1.tgz`).replace(/\\/g, '/');
const names = ['core', 'storage-pg', 'storage-prisma', 'nestjs', 'cli'];
const overrides = Object.fromEntries(names.map((n) => [`@getattestly/${n}`, file(n)]));
fs.writeFileSync('package.json', JSON.stringify({
  name: 'fresh-app', version: '0.0.0', private: true, type: 'module',
  dependencies: {
    '@nestjs/common': '^10.4.0', '@nestjs/core': '^10.4.0', '@nestjs/platform-express': '^10.4.0',
    'reflect-metadata': '^0.2.2', rxjs: '^7.8.0', pg: '^8.12.0',
    '@getattestly/nestjs': overrides['@getattestly/nestjs'], '@getattestly/core': overrides['@getattestly/core'],
  },
  devDependencies: { '@getattestly/cli': overrides['@getattestly/cli'], typescript: '^5.7.0', '@types/node': '^22.0.0', '@types/pg': '^8.11.0' },
  overrides,
}, null, 2));
EOF
npm install --no-audit --no-fund --loglevel=error

echo "-- README step 1: npx attestly migrate"
npx attestly migrate --database-url "$DATABASE_URL"

echo "-- README steps 2-4: module + middleware + @Audited, then real requests"
npx tsc -p tsconfig.json
TENANT_ID="$(node -e 'console.log(crypto.randomUUID())')"
export TENANT_ID DATABASE_URL
node dist/main.js

echo "-- README: npx attestly verify"
npx attestly verify --tenant "$TENANT_ID" --database-url "$DATABASE_URL"

echo
echo "Quickstart check passed: a fresh app got a verified chain from the README steps alone."
