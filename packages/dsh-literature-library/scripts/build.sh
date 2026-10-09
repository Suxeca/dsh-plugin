#!/bin/bash
set -euo pipefail
ROOT="$(dirname "$(dirname "$(realpath "$0")")")"
CHECKOUT="${DSH_CHECKOUT:?Set DSH_CHECKOUT to the existing Harness checkout}"
# Build-only types are resolved from the existing installation; no package is deleted.
mkdir -p "$ROOT/node_modules/@types"
if [ ! -e "$ROOT/node_modules/@types/node" ]; then
  ln -s "$CHECKOUT/node_modules/@types/node" "$ROOT/node_modules/@types/node"
fi
"$CHECKOUT/node_modules/.bin/tsc" -p "$ROOT/tsconfig.json"
