#!/usr/bin/env bash
# Build + publish the darkest-terminal binary for the CURRENT platform only,
# then publish the main package. Run once per platform (macOS arm64, macOS
# Intel, Windows) — Windows binaries can't be built from this script since
# it needs a POSIX shell; build those via the verify-build.yml CI artifact
# and publish npm/win32-x64 manually (or adapt this script to PowerShell).
#
# Usage:
#   ./scripts/release.sh          # asks for confirmation before each publish
#   ./scripts/release.sh --yes    # skip confirmation prompts

set -euo pipefail
cd "$(dirname "$0")/.."

AUTO_YES=false
if [[ "${1:-}" == "--yes" ]]; then
  AUTO_YES=true
fi

confirm() {
  if $AUTO_YES; then
    return 0
  fi
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) PLATFORM=darwin-arm64; BIN_NAME=darkest-terminal ;;
  Darwin-x86_64) PLATFORM=darwin-x64; BIN_NAME=darkest-terminal ;;
  *)
    echo "error: unsupported host for this script ($(uname -s)-$(uname -m))." >&2
    echo "Build on the matching OS (or via CI) and publish npm/<platform> manually." >&2
    exit 1
    ;;
esac

MAIN_VERSION=$(node -p "require('./package.json').version")
PLATFORM_DIR="./npm/$PLATFORM"
PLATFORM_VERSION=$(node -p "require('./$PLATFORM_DIR/package.json').version")
OPTDEP_VERSION=$(node -p "require('./package.json').optionalDependencies['darkest-terminal-$PLATFORM']")

if [[ "$MAIN_VERSION" != "$PLATFORM_VERSION" || "$MAIN_VERSION" != "$OPTDEP_VERSION" ]]; then
  echo "error: version mismatch — main=$MAIN_VERSION, $PLATFORM_DIR=$PLATFORM_VERSION, optionalDependency=$OPTDEP_VERSION" >&2
  echo "Bump all of them to the same version before releasing." >&2
  exit 1
fi

echo "Building $PLATFORM binary (v$MAIN_VERSION)..."
bun build ./src/main.ts --compile --outfile "$PLATFORM_DIR/$BIN_NAME"

echo "Built: $PLATFORM_DIR/$BIN_NAME"

if confirm "Publish $PLATFORM_DIR (darkest-terminal-$PLATFORM@$MAIN_VERSION) to npm?"; then
  npm publish "$PLATFORM_DIR" --access public
else
  echo "Skipped publishing $PLATFORM_DIR."
fi

if confirm "Publish main package (darkest-terminal@$MAIN_VERSION) to npm?"; then
  npm publish . --access public
else
  echo "Skipped publishing main package."
fi

echo "Done."
