#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# release-auditor.sh — compatibility alias for the generic publisher.
#
# The logic now lives in scripts/release-plugin.sh; this wrapper exists only so
# that `npm run release:auditor` keeps working exactly as before:
#
#     npm run release:auditor
#     bash scripts/release-auditor.sh --dry-run
#
# It is an EQUIVALENT alias of:
#
#     bash scripts/release-plugin.sh dsh-plugin-repo-auditor
#
# The auditor keeps a hand-written mirror README at
# scripts/release-readme/dsh-plugin-repo-auditor.md, so its published README is
# unchanged by the move to the generic script.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec bash "$ROOT/scripts/release-plugin.sh" dsh-plugin-repo-auditor "$@"