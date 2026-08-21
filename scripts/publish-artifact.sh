#!/usr/bin/env bash
# Publish a platform package using a binary you already have (e.g. downloaded
# from a GitHub Actions "Verify Build" artifact), without building locally.
# Use this for platforms this machine can't build (darwin-x64, win32-x64).
#
# Usage:
#   ./scripts/publish-artifact.sh darwin-x64 /path/to/downloaded/darkest-terminal
#   ./scripts/publish-artifact.sh win32-x64 /path/to/downloaded/darkest-terminal.exe

set -euo pipefail
cd "$(dirname "$0")/.."

PLATFORM="${1:-}"
BINARY_PATH="${2:-}"

if [[ -z "$PLATFORM" || -z "$BINARY_PATH" ]]; then
  echo "Usage: $0 <platform> <path-to-binary>" >&2
  echo "  platform: darwin-arm64 | darwin-x64 | win32-x64" >&2
  exit 1
fi

PLATFORM_DIR="./npm/$PLATFORM"
if [[ ! -d "$PLATFORM_DIR" ]]; then
  echo "error: unknown platform '$PLATFORM' (no $PLATFORM_DIR)" >&2
  exit 1
fi

if [[ ! -f "$BINARY_PATH" ]]; then
  echo "error: binary not found at $BINARY_PATH" >&2
  exit 1
fi

BIN_NAME=$(node -p "require('$PLATFORM_DIR/package.json').files[0]")
DEST="$PLATFORM_DIR/$BIN_NAME"

MAIN_VERSION=$(node -p "require('./package.json').version")
PLATFORM_VERSION=$(node -p "require('$PLATFORM_DIR/package.json').version")
if [[ "$MAIN_VERSION" != "$PLATFORM_VERSION" ]]; then
  echo "error: version mismatch — main=$MAIN_VERSION, $PLATFORM_DIR=$PLATFORM_VERSION" >&2
  exit 1
fi

cp "$BINARY_PATH" "$DEST"
chmod +x "$DEST" 2>/dev/null || true
echo "Copied $BINARY_PATH -> $DEST"

read -r -p "Publish darkest-terminal-$PLATFORM@$MAIN_VERSION to npm? [y/N] " reply
if [[ "$reply" =~ ^[Yy]$ ]]; then
  npm publish "$PLATFORM_DIR" --access public
else
  echo "Skipped publishing. Binary is staged at $DEST — rerun 'npm publish $PLATFORM_DIR' when ready."
fi
