#!/bin/bash
# Build: compile src/ → lib/ with tsc.
# Type dependencies (cordis, react, @types/*, dsh-client-*) are junction-linked
# from the enclosing dsh-plugin workspace pnpm store, so the host+client halves
# typecheck with the same packages the web profile loads at runtime.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 工作区 pnpm store（本插件位于 dsh-plugin/packages/<pkg>）
STORE="$(cd "$ROOT/../.." && pwd)/node_modules/.pnpm"
if [ ! -d "$STORE" ]; then
  echo "build: cannot locate workspace pnpm store at $STORE" >&2
  exit 1
fi

# tsc：优先工作区，回退 DSH_CHECKOUT
TSC="$(cd "$ROOT/../.." && pwd)/node_modules/.bin/tsc"
if [ ! -x "$TSC" ] && [ ! -f "$TSC.cmd" ]; then
  CHECKOUT="${DSH_CHECKOUT:-}"
  if [ -z "$CHECKOUT" ]; then
    for candidate in "$HOME/dsh-harness" "$HOME/dsh" "$HOME/.dsh/dsh-harness"; do
      if [ -d "$candidate/packages" ]; then CHECKOUT="$candidate"; break; fi
    done
  fi
  TSC="${CHECKOUT:-}/node_modules/.bin/tsc"
fi
if [ ! -x "$TSC" ] && [ ! -f "$TSC.cmd" ]; then
  echo "build: tsc not found (workspace .bin nor DSH_CHECKOUT)" >&2
  exit 1
fi

# link_pkg <scope/name> <store-entry-glob> — 从工作区 store 建 junction
link_pkg() {
  local name="$1"
  local glob="$2"
  local entry
  entry=$(find "$STORE" -maxdepth 1 -type d -iname "$glob" 2>/dev/null | head -1)
  if [ -z "$entry" ]; then
    echo "build: dependency entry missing in store: $glob" >&2
    exit 1
  fi
  node -e "
    const fs = require('fs');
    const path = require('path');
    const link = path.resolve(process.argv[1]);
    const target = path.resolve(process.argv[2]);
    fs.rmSync(link, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  " "node_modules/$name" "$entry/node_modules/$name"
}

echo "=== Linking build dependencies (store: $STORE) ==="
mkdir -p node_modules/@deepseek-ai node_modules/@types

link_pkg cordis '@deepseek-ai+cordis@*'
link_pkg react 'react@*'
link_pkg react-dom 'react-dom@*'
link_pkg @types/react '@types+react@*'
link_pkg @types/node '@types+node@*'
link_pkg @deepseek-ai/dsh-client-ui-slots '@deepseek-ai+dsh-client-ui-slots@*'
link_pkg @deepseek-ai/dsh-client-runtime '@deepseek-ai+dsh-client-runtime@*'

echo "=== Compiling src → lib (tsc) ==="
"$TSC" -p tsconfig.json
echo "=== Build complete ==="
