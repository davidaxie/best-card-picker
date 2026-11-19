#!/bin/sh
# Regenerate ts_parity.json from the TypeScript engine (needs `npm install` at
# the repo root), then run the Swift tests that compare against it.
set -eu
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"
npx vitest run --config ios/scripts/parity/vitest.config.ts
cd ios/Packages/BestCardEngine && swift test
