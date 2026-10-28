#!/usr/bin/env bash
set -euo pipefail

# rebuild: produce a fresh production build, package it into a real .app bundle,
# and launch that bundle. Slow — run this after changing source. The build runs
# the production type checks and re-bundles from clean, so type, import, CSP, and
# packaged-layout errors that run-dev hides surface here; packaging then gives
# the app its own bundle identity (correct dock/menu name). run-built is
# the fast, no-build launcher for everything after this.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_HELPER="$SCRIPT_DIR/launcher-runtime.mjs"

log_step() {
  printf '\n==> %s\n' "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

pause_on_failure() {
  local status="$1"
  if [[ "$status" -ne 0 && ( "$status" -lt 128 || "$status" -gt 143 ) ]]; then
    echo
    echo "fotoready rebuild failed with exit code $status."
    read -r -p "Press Enter to close..."
  fi
}

trap 'pause_on_failure $?' EXIT

require_command node
require_command npm

cd "$REPO_DIR"

log_step "Installing dependencies"
npm install

# Build into a clean candidate so a build that fails to emit a file can't be masked
# by a leftover artifact; the previous package stays runnable until the candidate
# is complete.
log_step "Preparing clean build output"
CANDIDATE="$(node "$RUNTIME_HELPER" prepare-candidate)"

# The package script type-checks the shipped sources (main/preload + renderer), builds the
# production bundle and packages it into a real .app bundle, the .app only with no dmg/zip
# installer; electron-builder ad-hoc-signs on macOS by default. The dev server skips the type
# check entirely, and tests are a separate gate. The bundle gives the app its own identity, so
# the dock and menu show "FotoReady" rather than the generic "Electron".
log_step "Building and packaging the app bundle"
npm run package -- --config.directories.output="$CANDIDATE"

log_step "Publishing the verified package"
node "$RUNTIME_HELPER" stop
node "$RUNTIME_HELPER" publish-candidate

log_step "Launching the packaged app"
node "$RUNTIME_HELPER" launch-packaged
