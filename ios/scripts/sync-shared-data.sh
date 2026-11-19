#!/bin/sh
# Copy the shared data files (owned by the extension side, in ../data) into
# the Swift package so the engine and tests bundle them. Never moves or edits
# the originals. Run from anywhere; also runs as an Xcode build phase.
set -eu

IOS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$IOS_DIR/.." && pwd)"
SRC="$REPO_DIR/data"
PKG="$IOS_DIR/Packages/BestCardEngine"
ENGINE_RES="$PKG/Sources/BestCardEngine/Resources"
TEST_RES="$PKG/Tests/BestCardEngineTests/Resources"

copy_if_changed() {
  from="$1"; to="$2"
  if [ ! -f "$from" ]; then
    echo "sync-shared-data: $from not found, keeping bundled copy" >&2
    return 0
  fi
  if ! cmp -s "$from" "$to" 2>/dev/null; then
    cp "$from" "$to"
    echo "sync-shared-data: updated $(basename "$to")"
  fi
}

mkdir -p "$ENGINE_RES" "$TEST_RES"
copy_if_changed "$SRC/cards.json" "$ENGINE_RES/cards.json"
copy_if_changed "$SRC/merchants.json" "$ENGINE_RES/merchants.json"
copy_if_changed "$SRC/golden_tests.json" "$TEST_RES/golden_tests.json"
