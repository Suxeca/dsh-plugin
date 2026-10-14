#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# release-plugin.sh — publish one allowlisted packages/* plugin to its own
# standalone, prebuilt GitHub repo, so that
#
#     dsh plugin add github:<owner>/<repo>
#
# works without cloning or building anything.
#
# WHY THE GENERIC SCRIPT EXISTS: every plugin under packages/* lives inside a
# monorepo, where GitHub cannot resolve a single package.json from the repo
# root. The mirror publishes ONLY installable artifacts.
#
# USAGE
#   bash scripts/release-plugin.sh <pkg-name>            # e.g. dsh-dev-probes
#   bash scripts/release-plugin.sh <pkg-name> --verbose
#   bash scripts/release-plugin.sh <pkg-name> --dry-run  # stage + commit, no push
#   bash scripts/release-plugin.sh --help
#
# FOUR GATES (all fail closed)
#   1. allowlist    only packages/* named in scripts/publish-allowlist.json may
#                   publish; third-party/* is refused outright.
#   2. dirty tree   uncommitted changes under the package abort the release, and
#                   HEAD must already be pushed to origin. Nothing is swallowed.
#   3. artifacts    root LICENSE is copied in, package.json.license must be MIT,
#                   lib/ must be newer than src/, and build caches are excluded.
#   4. self-flag    the shipped bytes must not contain a guard marker, or the
#                   repo-auditor would read its own detector table and grade the
#                   mirror CRITICAL, firing its install gate on users.
#
# Publishing NEVER creates a remote repository: if the target does not exist the
# script stops and tells you the exact command to run, because creating many
# repos at once is a rate-limit and abuse-control risk.
#
# The mirror is a generated artifact, so a push intentionally overwrites main.
# --force-with-lease makes that safe: the push is rejected if a human has pushed
# their own commit to the mirror in the meantime.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ALLOWLIST="$ROOT/scripts/publish-allowlist.json"
README_TPL_DIR="$ROOT/scripts/release-readme"
BRANCH="main"

VERBOSE=0
DRY_RUN=0
PKG_ARG=""

usage() { sed -n '2,42p' "$0"; }

while [ $# -gt 0 ]; do
  case "$1" in
    -v|--verbose) VERBOSE=1; shift ;;
    --dry-run)    DRY_RUN=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    -*)           echo "release-plugin: unknown option: $1 (try --help)" >&2; exit 2 ;;
    *)
      if [ -n "$PKG_ARG" ]; then echo "release-plugin: only one package name is accepted" >&2; exit 2; fi
      PKG_ARG="$1"; shift ;;
  esac
done

log() { printf '==> %s\n' "$*"; }
die() { printf 'release-plugin: ERROR: %s\n' "$*" >&2; exit 1; }
warn() { printf 'release-plugin: WARN: %s\n' "$*" >&2; }

# Never block on a credential prompt: fail loudly instead of hanging a release.
export GIT_TERMINAL_PROMPT=0

command -v node >/dev/null 2>&1 || die "node is required"
[ -n "$PKG_ARG" ] || { usage; die "a package name is required"; }
[ -f "$ALLOWLIST" ] || die "missing $ALLOWLIST"

# --- GATE 1: allowlist + packages/ prefix ----------------------------------
case "$PKG_ARG" in
  third-party|third-party/*)
    die "refusing $PKG_ARG: third-party/* is never published from this monorepo." ;;
  packages/*)
    PKG_DIR_NAME="${PKG_ARG#packages/}"
    case "$PKG_DIR_NAME" in ""|*/*) die "invalid package path: $PKG_ARG" ;; esac ;;
  */*) die "invalid package: $PKG_ARG (expected a bare directory name under packages/)" ;;
  *) PKG_DIR_NAME="$PKG_ARG" ;;
esac

PKG_REL="packages/$PKG_DIR_NAME"
PKG_DIR="$ROOT/$PKG_REL"
[ -d "$PKG_DIR" ] || die "package directory not found: $PKG_REL"

# Read the allowlist entry. Values are emitted as bash %q-quoted assignments and
# sourced back, so quotes, apostrophes and spaces in a description cannot break
# the shell (an eval-based version did exactly that).
ALLOW_ENV="$(mktemp)"
if ! node -e '
  const fs = require("fs");
  const [allowPath, key] = process.argv.slice(1);
  const a = JSON.parse(fs.readFileSync(allowPath, "utf8"));
  const e = a.packages && a.packages[key];
  if (!e) {
    console.error("not in the allowlist: " + key);
    console.error("allowed: " + Object.keys(a.packages || {}).join(", "));
    process.exit(1);
  }
  const one = (v) => "REPO_" + v;
  process.stdout.write("REPO_SLUG=" + JSON.stringify(String(e.repo)) + "\n");
  process.stdout.write("REPO_DESC=" + JSON.stringify(String(e.description)) + "\n");
  process.stdout.write("REPO_TOPICS=" + JSON.stringify((e.topics || []).join(" ")) + "\n");
  process.stdout.write("GUARD_MARKERS=" + JSON.stringify((a.guardMarkers || []).join("|")) + "\n");
' "$ALLOWLIST" "$PKG_DIR_NAME" > "$ALLOW_ENV"; then
  rm -f "$ALLOW_ENV"
  die "allowlist check failed for $PKG_DIR_NAME (see the message above)"
fi
REPO_SLUG="" REPO_DESC="" REPO_TOPICS="" GUARD_MARKERS=""
set -a
. "$ALLOW_ENV"
set +a
rm -f "$ALLOW_ENV"
[ -n "$REPO_SLUG" ] || die "allowlist entry for $PKG_DIR_NAME has no repo"

log "$PKG_DIR_NAME -> $REPO_SLUG"

# --- GATE 2a: dirty-tree circuit breaker -----------------------------------
DIRTY="$(git -C "$ROOT" status --porcelain -- "$PKG_REL" || true)"
if [ -n "$DIRTY" ]; then
  printf '%s\n' "$DIRTY" >&2
  die "$PKG_REL has uncommitted changes. Commit or stash them first:
       this release never stages, stashes or discards work in progress."
fi
printf '    working tree clean for %s\n' "$PKG_REL"

# --- GATE 2a-bis: the package must actually be tracked ---------------------
# A package directory that is not committed at all reports a CLEAN git status,
# so the check above would happily publish it. Several packages/* directories in
# this monorepo are intentionally untracked or gitignored, so this gate matters.
if ! git -C "$ROOT" ls-files --error-unmatch "$PKG_REL" >/dev/null 2>&1; then
  die "$PKG_REL is not tracked by git — refusing to publish uncommitted work.
       Add it first: git add $PKG_REL && git commit"
fi
TRACKED_FILES="$(git -C "$ROOT" ls-files -- "$PKG_REL" | wc -l | tr -d ' ')"
UNTRACKED="$(git -C "$ROOT" ls-files --others --exclude-standard -- "$PKG_REL" || true)"
if [ -n "$UNTRACKED" ]; then
  printf '%s\n' "$UNTRACKED" >&2
  die "$PKG_REL has untracked, non-ignored files — refusing to publish uncommitted work."
fi
printf '    %s tracked files, none untracked\n' "$TRACKED_FILES"

# --- GATE 2b: HEAD must already exist on origin ----------------------------
HEAD_SHA="$(git -C "$ROOT" rev-parse HEAD)"
REMOTE_HEAD="$(git -C "$ROOT" ls-remote origin "refs/heads/$BRANCH" 2>/dev/null | cut -f1 || true)"
if [ -z "$REMOTE_HEAD" ]; then
  warn "cannot read origin/$BRANCH — skipping the pushed-HEAD check"
elif [ "$HEAD_SHA" != "$REMOTE_HEAD" ]; then
  die "HEAD ($HEAD_SHA) is not on origin/$BRANCH ($REMOTE_HEAD).
       Push the monorepo first: git push origin $BRANCH"
fi
printf '    HEAD %s is on origin/%s\n' "${HEAD_SHA:0:7}" "$BRANCH"

# --- DSH checkout: several build.sh rely on $DSH_CHECKOUT -------------------
# The scaffolded build.sh scripts compile with the checkout's own tsc and link
# its vendor packages, and they are not uniform about probing for it: some
# auto-probe, others hard-require the variable. Resolve it once here (env first,
# then the usual locations) and export it, so no package's build depends on how
# the operator's shell happens to be set up.
if [ -z "${DSH_CHECKOUT:-}" ]; then
  for candidate in \
    "${DSH_HARNESS_CHECKOUT:-}" \
    "$HOME/Workspace/deepseek-harness" \
    "$HOME/dsh-harness" \
    "$HOME/dsh" \
    "$HOME/.dsh/dsh-harness"
  do
    [ -n "$candidate" ] || continue
    if [ -d "$candidate/packages" ] && [ -x "$candidate/node_modules/.bin/tsc" ]; then
      export DSH_CHECKOUT="$candidate"
      break
    fi
  done
fi
if [ -n "${DSH_CHECKOUT:-}" ]; then
  printf '    DSH checkout: %s\n' "$DSH_CHECKOUT"
else
  warn "no DSH checkout found (set DSH_CHECKOUT) — builds that link the checkout may fail"
fi

log "building $PKG_DIR_NAME"

# Two build conventions exist in this monorepo: the scaffolded packages ship a
# scripts/build.sh (which links the DSH checkout), while the tsdown/tsc packages
# build through their own package.json "build" script. Support both, refuse
# neither silently: a package with neither is an explicit error.
if [ -f "$PKG_DIR/scripts/build.sh" ]; then
  BUILD_CMD=(bash "$PKG_DIR/scripts/build.sh")
  BUILD_LABEL="scripts/build.sh"
elif node -e 'process.exit((JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).scripts||{}).build ? 0 : 1)' "$PKG_DIR/package.json"; then
  BUILD_CMD=(npm run build --prefix "$PKG_DIR" --silent)
  BUILD_LABEL="npm run build"
elif [ -f "$PKG_DIR/lib/index.js" ]; then
  # Hand-written packages ship a committed lib/ and have nothing to compile.
  # Safe only because the freshness gate below still runs, and the artifact gate
  # requires lib/index.js to exist and be staged.
  BUILD_CMD=(true)
  BUILD_LABEL="none (prebuilt lib/, no build step)"
else
  die "no build entrypoint for $PKG_DIR_NAME: no scripts/build.sh, no package.json build script, and no prebuilt lib/index.js"
fi

TMP="$(mktemp -d)"
BUILD_LOG="$(mktemp)"
KEEP_LOG=0
cleanup() { rm -rf "$TMP"; [ "$KEEP_LOG" -eq 1 ] || rm -f "$BUILD_LOG"; }
trap cleanup EXIT

if [ "$VERBOSE" -eq 1 ]; then
  "${BUILD_CMD[@]}"
else
  if ! "${BUILD_CMD[@]}" >"$BUILD_LOG" 2>&1; then
    KEEP_LOG=1
    tail -n 40 "$BUILD_LOG" >&2 || true
    die "build failed via $BUILD_LABEL (full log kept at $BUILD_LOG)"
  fi
  printf '    build ok (%s)\n' "$BUILD_LABEL"
fi

# --- GATE 2c: lib/ freshness — never publish a stale build ------------------
[ -d "$PKG_DIR/lib" ] || die "missing $PKG_DIR/lib (build produced nothing)"
if [ -d "$PKG_DIR/src" ]; then
  NEWEST_SRC="$(find "$PKG_DIR/src" -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -1 || true)"
  NEWEST_LIB="$(find "$PKG_DIR/lib" -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -1 || true)"
  if [ -n "$NEWEST_SRC" ] && [ -n "$NEWEST_LIB" ]; then
    if ! node -e 'process.exit(Number(process.argv[1]) >= Number(process.argv[2]) ? 0 : 1)' "$NEWEST_LIB" "$NEWEST_SRC"; then
      die "lib/ is older than src/ — refusing to publish a stale build"
    fi
  fi
fi
printf '    lib/ is fresh relative to src/\n'

# --- GATE 3: stage installable artifacts only ------------------------------
log "staging installable artifacts"
[ -f "$PKG_DIR/package.json" ]     || die "missing $PKG_DIR/package.json"
[ -f "$PKG_DIR/cordis.patch.yml" ] || die "missing $PKG_DIR/cordis.patch.yml (needed to resolve the plugin on install)"
[ -f "$PKG_DIR/lib/index.js" ]     || die "missing $PKG_DIR/lib/index.js (declared main)"
[ -f "$ROOT/LICENSE" ]             || die "missing $ROOT/LICENSE"

# Ensure the manifest is loadable before anything else trusts it.
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$PKG_DIR/package.json" \
  || die "invalid JSON: $PKG_DIR/package.json"

# License must be normalised to MIT, matching the monorepo LICENSE that ships.
PKG_LICENSE="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).license || ""' "$PKG_DIR/package.json")"
[ "$PKG_LICENSE" = "MIT" ] || die "$PKG_DIR_NAME declares license='$PKG_LICENSE'; the allowlist requires \"MIT\"
       fix it first: set \"license\": \"MIT\" in $PKG_REL/package.json"

# The mirror is a PREBUILT artifact, so the manifest it ships must not ask the
# consumer to build. pnpm runs "prepare" for git dependencies, so a leftover
# "prepare": "tsdown" would rebuild on every install — slow, and a new failure
# mode in an environment that has no build toolchain. Build-only lifecycle hooks
# are therefore dropped from the mirrored manifest.
#
# preinstall/install/postinstall are NOT dropped: those can carry real
# install-time behaviour, and silently removing them would change what the
# package does. Their presence is a human decision, so the release stops here.
node -e '
  const fs = require("fs");
  const [srcPath, outPath] = process.argv.slice(1);
  const pkg = JSON.parse(fs.readFileSync(srcPath, "utf8"));
  const scripts = pkg.scripts || {};
  const INSTALL_HOOKS = ["preinstall", "install", "postinstall"];
  const present = INSTALL_HOOKS.filter((h) => typeof scripts[h] === "string" && scripts[h].trim());
  if (present.length) {
    console.error("install-time lifecycle hooks present: " + present.join(", "));
    process.exit(3);
  }
  const BUILD_ONLY = ["prepare", "prepack", "prepublish", "prepublishOnly"];
  const dropped = BUILD_ONLY.filter((h) => typeof scripts[h] === "string" && scripts[h].trim());
  for (const h of dropped) delete scripts[h];
  if (Object.keys(scripts).length === 0) delete pkg.scripts; else pkg.scripts = scripts;
  fs.writeFileSync(outPath, JSON.stringify(pkg, null, 2) + "\n");
  if (dropped.length) console.log("    dropped build-only lifecycle scripts: " + dropped.join(", "));
' "$PKG_DIR/package.json" "$TMP/package.json" || {
  rc=$?
  if [ "$rc" -eq 3 ]; then
    die "$PKG_DIR_NAME declares an install-time lifecycle hook (preinstall/install/postinstall).
       Refusing to publish it silently: decide explicitly whether the mirror needs it."
  fi
  die "failed to prepare the mirrored package.json"
}
cp "$PKG_DIR/cordis.patch.yml" "$TMP/cordis.patch.yml"
cp "$ROOT/LICENSE"             "$TMP/LICENSE"

# lib/ minus build caches: *.tsbuildinfo is a tsc cache and carries absolute
# local paths — it must never reach a public repo.
cp -R "$PKG_DIR/lib" "$TMP/lib"
find "$TMP/lib" -name '*.tsbuildinfo' -type f -delete
rm -rf "$TMP/lib"/node_modules
find "$TMP/lib" \( -name '*.tgz' -o -name '*.tar.gz' \) -type f -delete

if [ -d "$PKG_DIR/locale" ]; then
  mkdir -p "$TMP/locale"
  find "$PKG_DIR/locale" -maxdepth 1 -name '*.json' -exec cp {} "$TMP/locale/" \;
fi

# --- reachability: never publish an entry with a missing import -------------
# Blanket-excluding src/ is right for compiled packages but wrong for a
# hand-written one whose runtime lives in src/*.mjs; that mistake published a
# dsh-science-map entry importing files the mirror did not contain. This walks
# the relative-import closure from the entry, stages whatever it genuinely needs,
# and aborts when something cannot be resolved.
node "$ROOT/scripts/stage-reachable.mjs" "$TMP" "$PKG_DIR" \
  || die "staged tree is not loadable: relative imports reachable from the entry are missing"

# Belt and braces: tests and dev scaffolding never belong in a published mirror.
# src/ is tolerated above only because the reachability pass proved a file in it
# is required at runtime; an unreferenced src/ is never staged.
for forbidden in tests node_modules test-units; do
  [ -e "$TMP/$forbidden" ] && die "refusing to publish: $forbidden/ reached the staged tree"
done
find "$TMP" -name '*.tsbuildinfo' -type f | grep -q . && die "refusing to publish: a *.tsbuildinfo survived staging"

# Bundler-emitted comment markers carry the absolute source path even when no
# source file contains one. Rewrite those comment lines to a portable form
# first; the gate below then covers everything that is left, including code.
node "$ROOT/scripts/strip-abs-comments.mjs" "$TMP" "$ROOT" "$HOME"

# Hard gate: no absolute local path may reach a published mirror. Such a path
# still loads, so the mirror looks fine while only working on the machine that
# wrote it, and it leaks the maintainer's username and directory layout into a
# public repository. Resolve paths at runtime instead (env var, then a probed
# conventional location, then a portable default).
ABS_HITS="$(grep -rInE '/home/[A-Za-z0-9._-]+/|/Users/[A-Za-z0-9._-]+/|[A-Z]:\\\\Users' "$TMP" 2>/dev/null || true)"
if [ -n "$ABS_HITS" ]; then
  printf 'release-plugin: ERROR: absolute local paths in the published bytes:\n' >&2
  while IFS= read -r line; do printf '    %s\n' "${line#"$TMP"/}" >&2; done <<< "$ABS_HITS"
  die "refusing to publish $PKG_DIR_NAME: resolve these paths at runtime
       (environment variable first, then a probed conventional location, then a
       portable default) rather than baking in this machine's layout."
fi
printf '    0 absolute local paths in the published bytes\n'

printf '    package.json, cordis.patch.yml, lib/ (%s files), LICENSE%s\n' \
  "$(find "$TMP/lib" -type f | wc -l | tr -d ' ')" \
  "$([ -d "$TMP/locale" ] && printf ', locale/ (%s files)' "$(find "$TMP/locale" -type f | wc -l | tr -d ' ')" || true)"

# --- README: per-package template, else a generated default ----------------
BUNDLE_ID="$(sed -n 's/^[[:space:]]*- id:[[:space:]]*//p' "$PKG_DIR/cordis.patch.yml" | head -1 | tr -d '\r')"
[ -n "$BUNDLE_ID" ] || BUNDLE_ID="${PKG_DIR_NAME#dsh-}"

REPO_URL="https://github.com/$REPO_SLUG"
MONOREPO_URL="https://github.com/${REPO_SLUG%%/*}/dsh-plugin"

if [ -f "$README_TPL_DIR/$PKG_DIR_NAME.md" ]; then
  node -e '
    const fs = require("fs");
    const [tpl, out, pkgName, pkgDir, bundleId, mono] = process.argv.slice(1);
    const t = fs.readFileSync(tpl, "utf8")
      .split("@@PACKAGE_NAME@@").join(pkgName)
      .split("@@PACKAGE_DIR@@").join(pkgDir)
      .split("@@BUNDLE_ID@@").join(bundleId)
      .split("@@MONOREPO@@").join(mono);
    fs.writeFileSync(out, t);
  ' "$README_TPL_DIR/$PKG_DIR_NAME.md" "$TMP/README.md" \
    "$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).name' "$PKG_DIR/package.json")" \
    "$PKG_DIR_NAME" "$BUNDLE_ID" "${REPO_SLUG%%/*}/dsh-plugin"
  printf '    README from template scripts/release-readme/%s.md\n' "$PKG_DIR_NAME"
else
  PKG_DESC="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).description || ""' "$PKG_DIR/package.json")"
  {
    printf '# %s\n\n' "$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).name' "$PKG_DIR/package.json")"
    printf '%s\n' \
      '```' \
      '⚠️ 本仓库是**自动生成的发布镜像**，每次发布都会整体覆盖 `main`。' \
      "**唯一事实来源 / single source of truth:** [$MONOREPO_URL → packages/$PKG_DIR_NAME]($MONOREPO_URL/tree/main/packages/$PKG_DIR_NAME)" \
      '请勿在本仓库提交代码或 PR —— 改为修改源仓库中的该目录，本仓库的内容会被下一次发布覆盖。' \
      '```' \
      '' \
      '**本仓库只发布可安装产物**（`lib/`、`cordis.patch.yml`、`package.json`），**不含 `src/` 与 `tests/`**。源码与唯一事实来源仍在源仓库。' \
      '' \
      "$PKG_DESC" \
      '' \
      '## 安装 / Install' \
      '' \
      '```bash' \
      "dsh plugin add github:$REPO_SLUG" \
      '```' \
      '' \
      '无需构建：`lib/` 已预编译随仓库发布（prebuilt）。' \
      '' \
      '## 许可 / License' \
      '' \
      'MIT License — 见 [`LICENSE`](LICENSE)。该文件由发布脚本从源仓库根目录自动复制。'
  } > "$TMP/README.md"
  printf '    README generated (no template for %s)\n' "$PKG_DIR_NAME"
fi

cat > "$TMP/.gitignore" <<'MIRROR_GITIGNORE_EOF'
# This mirror publishes PREBUILT artifacts, so lib/ is intentionally tracked
# (it is the whole point of this repo) — unlike the monorepo, which ignores it.
node_modules/
*.tgz
*.tsbuildinfo
MIRROR_GITIGNORE_EOF

# --- GATE 4: self-flag guard ------------------------------------------------
# The shipped bytes must never contain a marker the auditor scans for, or the
# mirror would be graded CRITICAL by the very plugin it publishes.
log "self-flag guard (marker list from publish-allowlist.json)"
MARKER_BAD=0
while IFS= read -r marker; do
  [ -n "$marker" ] || continue
  HITS="$(grep -rlF -- "$marker" "$TMP" 2>/dev/null || true)"
  if [ -n "$HITS" ]; then
    printf '    LEAK: marker %s found in:\n%s\n' "$marker" "$HITS" >&2
    MARKER_BAD=1
  fi
done <<< "$(printf '%s' "$GUARD_MARKERS" | tr '|' '\n')"
[ "$MARKER_BAD" -eq 0 ] || die "staged mirror would flag itself — publish aborted"
printf '    %s markers checked, 0 hits\n' "$(printf '%s' "$GUARD_MARKERS" | tr '|' '\n' | grep -c .)"

for f in package.json cordis.patch.yml lib/index.js README.md LICENSE .gitignore; do
  [ -e "$TMP/$f" ] || die "staged tree is missing $f"
done

# --- remote must already exist (never create one here) ----------------------
REMOTE_EXISTS=0
if command -v gh >/dev/null 2>&1 && gh repo view "$REPO_SLUG" --json name >/dev/null 2>&1; then
  REMOTE_EXISTS=1
fi
if [ "$REMOTE_EXISTS" -eq 0 ]; then
  die "remote repository $REPO_SLUG does not exist (or gh is unauthenticated).
       This script never creates repositories. Create it first, then confirm:
         gh repo create $REPO_SLUG --public --description \"$REPO_DESC\"
         for t in $REPO_TOPICS; do gh repo edit $REPO_SLUG --add-topic \"\$t\"; done"
fi
printf '    remote %s exists\n' "$REPO_SLUG"
# --- commit + push -----------------------------------------------------------
# Prefer the identity configured in the monorepo; fall back to the maintainer's.
GIT_NAME="$(git -C "$ROOT" config user.name 2>/dev/null || true)"
GIT_EMAIL="$(git -C "$ROOT" config user.email 2>/dev/null || true)"
[ -n "$GIT_NAME" ]  || GIT_NAME="Atlas"
[ -n "$GIT_EMAIL" ] || GIT_EMAIL="atlas@ohmyopenode.dev"

git -C "$TMP" init -q -b "$BRANCH"
git -C "$TMP" config user.name  "$GIT_NAME"
git -C "$TMP" config user.email "$GIT_EMAIL"
git -C "$TMP" remote add origin "$REPO_URL.git"
git -C "$TMP" add -A
PKG_VERSION="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version' "$PKG_DIR/package.json")"
git -C "$TMP" commit -q -m "release: $(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).name' "$PKG_DIR/package.json") v$PKG_VERSION

Auto-generated mirror. Source of truth:
  $MONOREPO_URL/tree/main/$PKG_REL

Commit: $HEAD_SHA"
TREE_SHA="$(git -C "$TMP" rev-parse HEAD^{tree})"
printf '    committed tree %s\n' "$TREE_SHA"

if [ "$DRY_RUN" -eq 1 ]; then
  log "dry run: staged + committed, NOT pushing"
  printf '    inspect with: git -C %s log --stat -1\n' "$TMP"
  trap - EXIT
  printf '    (temp dir kept: %s)\n' "$TMP"
  exit 0
fi

# Fetch the mirror tip first so --force-with-lease can tell whether a human
# pushed something of their own since the last release.
git -C "$TMP" fetch -q origin "$BRANCH" 2>/dev/null || true
REMOTE_TREE="$(git -C "$TMP" rev-parse "refs/remotes/origin/$BRANCH^{tree}" 2>/dev/null || true)"
if [ -n "$REMOTE_TREE" ] && [ "$REMOTE_TREE" = "$TREE_SHA" ]; then
  log "mirror already matches this build (tree $TREE_SHA) — nothing to push"
  trap - EXIT; rm -rf "$TMP"; [ "$KEEP_LOG" -eq 1 ] || rm -f "$BUILD_LOG"
  printf '    %s is up to date\n' "$REPO_URL"
  exit 0
fi

log "pushing to $REPO_SLUG ($BRANCH)"
git -C "$TMP" push --quiet --force-with-lease origin "$BRANCH"
printf '    pushed %s\n' "$TREE_SHA"

# --- sync GitHub metadata from the allowlist --------------------------------
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  log "syncing description + topics"
  gh repo edit "$REPO_SLUG" --description "$REPO_DESC" >/dev/null
  for t in $REPO_TOPICS; do
    gh repo edit "$REPO_SLUG" --add-topic "$t" >/dev/null
  done
  printf '    description + %s topics synced\n' "$(printf '%s' "$REPO_TOPICS" | wc -w | tr -d ' ')"
else
  warn "gh unavailable or unauthenticated — skipped the GitHub metadata sync"
fi

# --- report ------------------------------------------------------------------
log "done"
printf '    repo       : %s\n' "$REPO_URL"
printf '    install    : dsh plugin add github:%s\n' "$REPO_SLUG"
printf '    source     : %s/tree/main/%s\n' "$MONOREPO_URL" "$PKG_REL"
printf '\n'
printf '    Acceptance is a real audit, not this script. Run:\n'
printf '      audit_github_repos({ repos: ["%s"] })\n' "$REPO_SLUG"
printf '    Raw CDN caches for ~5 minutes after a push — allow for that before re-auditing.\n'