#!/usr/bin/env bash
#
# Re-link the private packages that are excluded from the pnpm workspace.
#
# ## Why this exists
#
# `packages/dsh-quota-meter` and `packages/dsh-secure-context-polyfill` are
# local-only: their sources stay out of the public repo (.gitignore), and they
# are excluded from `pnpm-workspace.yaml` so the tracked `pnpm-lock.yaml`
# never lists an importer whose directory a fresh clone does not have. That
# exclusion has a cost — the next `pnpm install` in the repo root prunes the
# store entries only they need, their `node_modules/@deepseek-ai/*` links go
# dangling, and `pnpm --filter <pkg> build` then fails with TS2307.
#
# This script does the re-link dance in one step: temporarily drop the
# exclusions, install, then restore `pnpm-workspace.yaml` and `pnpm-lock.yaml`
# exactly as they were (including on failure).
#
# ## Usage
#
#   scripts/relink-private-packages.sh            # re-link only
#   scripts/relink-private-packages.sh --build    # re-link, then rebuild both
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

WORKSPACE="pnpm-workspace.yaml"
LOCKFILE="pnpm-lock.yaml"

if [ ! -f "$WORKSPACE" ] || [ ! -f "$LOCKFILE" ]; then
  echo "relink: run this from the repository (expected $ROOT)" >&2
  exit 1
fi

BACKUP_WORKSPACE="$(mktemp)"
BACKUP_LOCKFILE="$(mktemp)"
cp "$WORKSPACE" "$BACKUP_WORKSPACE"
cp "$LOCKFILE" "$BACKUP_LOCKFILE"

restore() {
  cp "$BACKUP_WORKSPACE" "$WORKSPACE"
  cp "$BACKUP_LOCKFILE" "$LOCKFILE"
  rm -f "$BACKUP_WORKSPACE" "$BACKUP_LOCKFILE"
  echo "relink: restored $WORKSPACE and $LOCKFILE"
}
trap restore EXIT

# Rebuild the `packages:` block without the `!packages/...` exclusions and
# keep everything from `storeDir:` onward untouched.
{
  echo "packages:"
  echo "  - 'packages/*'"
  echo
  sed -n '/^storeDir:/,$p' "$WORKSPACE"
} > "$WORKSPACE.tmp"
mv "$WORKSPACE.tmp" "$WORKSPACE"

echo "relink: temporarily re-including the private packages; installing..."
pnpm install

failures=()
if [ "${1:-}" = "--build" ]; then
  for pkg in packages/dsh-quota-meter packages/dsh-secure-context-polyfill; do
    [ -f "$pkg/package.json" ] || continue
    echo "relink: building $pkg"
    if ! (cd "$pkg" && pnpm run build); then
      failures+=("$pkg")
    fi
  done
fi

if [ ${#failures[@]} -gt 0 ]; then
  echo "relink: build FAILED for: ${failures[*]}" >&2
  exit 1
fi

echo "relink: done."
