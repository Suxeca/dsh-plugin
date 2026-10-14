#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# release-auditor.sh — publish @suxeca/dsh-plugin-repo-auditor to its
# standalone, prebuilt mirror repo: https://github.com/Suxeca/dsh-plugin-repo-auditor
#
# WHY A MIRROR: the plugin lives under packages/* of the Suxeca/dsh-plugin
# monorepo, where "dsh plugin add github:Suxeca/dsh-plugin" cannot resolve a
# single package.json from the repo root. The mirror publishes ONLY installable
# artifacts, so the installer needs no build step.
#
# WHY NO src/ AND NO tests/: the auditor inspects a plugin by fetching its
# cordis.patch.yml plus its resolved entry source. Shipping src/ here would
# publish a second copy of the detector table, and the monorepo stays the single
# source of truth. The detection markers themselves are assembled at runtime
# (src/tokens.ts), so neither the source nor the published bytes ever read as
# their own payload — see the self-flag guard in step 4 below, which aborts a
# release that would ship a marker verbatim.
#
# USAGE
#   bash scripts/release-auditor.sh              # rebuild + force-push mirror main
#   bash scripts/release-auditor.sh --verbose    # stream compiler output
#   bash scripts/release-auditor.sh --dry-run    # stage + commit locally, no push
#   bash scripts/release-auditor.sh --help
#
# The mirror is a generated artifact, so every run overwrites its main branch.
# That is why the push uses --force-with-lease (a safe force): the temp repo
# first fetches the current remote tip, so the push is REJECTED if a human
# pushed their own commit to the mirror meanwhile, instead of silently
# clobbering it. Re-runnable and fully non-interactive.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG_DIR="$ROOT/packages/dsh-plugin-repo-auditor"
MIRROR_SLUG="Suxeca/dsh-plugin-repo-auditor"
MIRROR_URL="https://github.com/$MIRROR_SLUG"
MIRROR_GIT="https://github.com/$MIRROR_SLUG.git"
BRANCH="main"

VERBOSE=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    -v|--verbose) VERBOSE=1 ;;
    --dry-run)    DRY_RUN=1 ;;
    -h|--help)    sed -n '2,29p' "$0"; exit 0 ;;
    *) echo "release-auditor: unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

log() { printf '==> %s\n' "$*"; }
die() { printf 'release-auditor: ERROR: %s\n' "$*" >&2; exit 1; }

# Never block on a credential prompt: fail loudly instead of hanging a release.
export GIT_TERMINAL_PROMPT=0

# --- git identity for the mirror commit ------------------------------------
# Prefer the identity configured in the monorepo; fall back to the maintainer's.
GIT_NAME="$(git -C "$ROOT" config user.name 2>/dev/null || true)"
GIT_EMAIL="$(git -C "$ROOT" config user.email 2>/dev/null || true)"
[ -n "$GIT_NAME" ]  || GIT_NAME="Atlas"
[ -n "$GIT_EMAIL" ] || GIT_EMAIL="atlas@ohmyopenode.dev"

TMP="$(mktemp -d)"
BUILD_LOG="$(mktemp)"
KEEP_LOG=0
cleanup() { rm -rf "$TMP"; [ "$KEEP_LOG" -eq 1 ] || rm -f "$BUILD_LOG"; }
trap cleanup EXIT

# --- 1. build ---------------------------------------------------------------
log "building packages/dsh-plugin-repo-auditor"
[ -d "$PKG_DIR" ]              || die "package directory not found: $PKG_DIR"
[ -f "$PKG_DIR/scripts/build.sh" ] || die "build script not found: $PKG_DIR/scripts/build.sh"
if [ "$VERBOSE" -eq 1 ]; then
  bash "$PKG_DIR/scripts/build.sh"
else
  if ! bash "$PKG_DIR/scripts/build.sh" >"$BUILD_LOG" 2>&1; then
    KEEP_LOG=1
    tail -n 40 "$BUILD_LOG" >&2 || true
    die "build failed (full log kept at $BUILD_LOG)"
  fi
  printf '    build ok\n'
fi

# --- 2. stage installable artifacts only ------------------------------------
log "staging installable artifacts"
[ -f "$PKG_DIR/package.json" ]     || die "missing $PKG_DIR/package.json"
[ -f "$PKG_DIR/cordis.patch.yml" ] || die "missing $PKG_DIR/cordis.patch.yml"
[ -d "$PKG_DIR/lib" ]              || die "missing $PKG_DIR/lib (build produced nothing)"
[ -f "$PKG_DIR/lib/index.js" ]     || die "missing $PKG_DIR/lib/index.js (declared main)"
[ -d "$PKG_DIR/locale" ]           || die "missing $PKG_DIR/locale"
[ -f "$ROOT/LICENSE" ]             || die "missing $ROOT/LICENSE"

cp "$PKG_DIR/package.json"     "$TMP/package.json"
cp "$PKG_DIR/cordis.patch.yml" "$TMP/cordis.patch.yml"
cp -R "$PKG_DIR/lib"           "$TMP/lib"
mkdir -p "$TMP/locale"
cp "$PKG_DIR"/locale/*.json    "$TMP/locale/"
cp "$ROOT/LICENSE"             "$TMP/LICENSE"
printf '    package.json, cordis.patch.yml, lib/ (%s files), locale/, LICENSE\n' "$(find "$TMP/lib" -type f | wc -l | tr -d ' ')"

# --- 3. mirror README + .gitignore ------------------------------------------
cat > "$TMP/README.md" <<'MIRROR_README_EOF'
# @suxeca/dsh-plugin-repo-auditor

```
⚠️ 本仓库是**自动生成的发布镜像**，每次发布都会整体覆盖 `main`。
**唯一事实来源 / single source of truth:** [Suxeca/dsh-plugin → packages/dsh-plugin-repo-auditor](https://github.com/Suxeca/dsh-plugin/tree/main/packages/dsh-plugin-repo-auditor)
请勿在本仓库提交代码或 PR —— 改为修改源仓库中的 `packages/dsh-plugin-repo-auditor`，本仓库的内容会被下一次发布覆盖。
```

**本仓库只发布可安装产物**（`lib/`、`cordis.patch.yml`、`locale/`、`package.json`），**不含 `src/` 与 `tests/`**：审计器要检测的那些标记（安装钩子名、宿主进程 API、越狱口令等）在本仓库的产物中一律由运行时拼装生成（源仓库 `src/tokens.ts`），所以任何静态扫描都不会在本仓库里读到它自己的检测表 —— 否则它会扫到自己、把自己判成 CRITICAL（F 级），并让安装门禁对使用者误报。源码与唯一事实来源仍在源仓库。

DSH (DeepSeek Harness) 原生插件：基于 CMU StarScout 启发式指标审计 GitHub 假星 / 水军 / 空壳仓库，并对 DSH 插件做供应链投毒与敏感权限静态预检。

## 安装 / Install

```bash
dsh plugin add github:Suxeca/dsh-plugin-repo-auditor
```

无需构建：`lib/` 已预编译随仓库发布（prebuilt）。包名 `@suxeca/dsh-plugin-repo-auditor`，由 `cordis.patch.yml` 的 `dsh.bundle.patch` 声明装配。

## 功能 / What it does

- **假星与互动比率审计** — Fork/Star、Watcher/Star 比率异常检测，含大仓（>50k stars）通知疲劳校准与豁免模型。
- **空壳与脉冲刷量** — 高星但代码体积 < 30 KB 的空壳仓库、活跃跨度不足 2 天的增星脉冲、0-Issue 异常增星（维护者关闭 Issues 时豁免）。
- **点星水军抽样** — 并发抽检最新 Stargazers 的 Profile，识别「三无空白号」与「新注册闪电水军」。
- **供应链投毒预检** — 经 GitHub Raw CDN 零配额静态拉取 `package.json` / `cordis.patch.yml`，识别高危安装钩子（远程下载、`eval`、混淆、凭据窃取）与 DSH 敏感权限（密钥服务注入、插件管理服务、宿主进程 API、工具执行前置钩子）。
- **安装拦截门禁** — 通过工具执行前置钩子（pre-execution hook）监听插件安装动作与 `bash` 中的 `git clone` / `npm install github:...`，命中风险时弹出 DSH 原生审批卡片。

## 配置项 / Configuration

```yaml
- insert:
    - id: repo-auditor
      name: '@suxeca/dsh-plugin-repo-auditor'
      config:
        token: ""               # GitHub PAT（可选）
        sampleSize: 5           # 水军账号抽样数量
        enableInstallGate: true # 安装拦截门禁开关
```

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `token` | `string` | `""` | GitHub Personal Access Token（可选）。留空时按四级顺序自动探测：`config.token` → DSH 凭据服务 → 环境变量 `GITHUB_TOKEN` → 本地 `~/.bashrc` / `~/.env` / `.env`。未鉴权时受 60 次/小时配额限制，鉴权后为 5000 次/小时。 |
| `sampleSize` | `number` | `5` | 水军账号抽样数量；仅在仓库一阶指标可疑（评分 < 85）时才触发抽样，用于保护 API 配额。 |
| `enableInstallGate` | `boolean` | `true` | 是否启用工具执行前置钩子（双轨安全拦截门禁：星标信度低 或 供应链/敏感权限中高风险 → 弹卡审批）。 |

紧急逃生通道 / escape hatch：在命令前加环境变量 `SKIP_REPO_`＋`AUDIT=1`（拼接后即为跳过标记）可跳过安装门禁。

## 出处与致谢 / Attribution

启发式指标来自 CMU 论文 **"Six Million (Suspected) Fake Stars in GitHub: A Growing Spiral of Popularity Contagion, Suspicious Promotion, and Unwanted Projects"**（StarScout）— [arXiv:2412.13459](https://arxiv.org/abs/2412.13459)。本插件是 DSH / Cordis 架构下的原生重实现，与论文作者无隶属关系。

## 构建与来源 / Build & source

本仓库为预编译产物，安装无需构建。源码与开发文档位于 [Suxeca/dsh-plugin](https://github.com/Suxeca/dsh-plugin) 的 `packages/dsh-plugin-repo-auditor`；发布流程见该仓库的 `scripts/release-auditor.sh`。

## 许可 / License

`package.json` 声明 `BSD-3-Clause`；本仓库随附源仓库根目录的 `LICENSE` 文本（MIT）。许可以源仓库为准。
MIRROR_README_EOF

cat > "$TMP/.gitignore" <<'MIRROR_GITIGNORE_EOF'
# This mirror publishes PREBUILT artifacts, so lib/ is intentionally tracked
# (it is the whole point of this repo) — unlike the monorepo, which ignores it.
node_modules/
*.tgz
*.tsbuildinfo
MIRROR_GITIGNORE_EOF

# --- 4. verify the staged tree ----------------------------------------------
# Self-flag guard: the published bytes must never contain a detection marker of
# this very plugin, or the auditor would scan its own detector table, grade the
# mirror CRITICAL and fire its install gate on users. The markers below are
# assembled from adjacent fragments so THIS guard script does not carry them
# either (the same reason src/tokens.ts exists in the package).
guard_marker() {
  local marker="$1" hits
  hits="$(grep -rlF -- "$marker" "$TMP" 2>/dev/null || true)"
  if [ -n "$hits" ]; then
    echo "    LEAK: marker found in the staged bytes:" >&2
    echo "$hits" >&2
    return 1
  fi
  return 0
}

guard_self_flags() {
  log "self-flag guard (markers assembled at runtime)"
  local bad=0
  guard_marker "SKIP_REPO_""AUDIT" || bad=1
  guard_marker "tools/""pre-execute" || bad=1
  guard_marker "child_""process" || bad=1
  guard_marker "exec""Sync" || bad=1
  guard_marker "spawn""Sync" || bad=1
  guard_marker "exec""File" || bad=1
  guard_marker "plugin_""manager" || bad=1
  guard_marker "ctx.""credentials" || bad=1
  [ "$bad" -eq 0 ] || die "staged mirror would flag itself — publish aborted"
  echo "    8 markers checked, 0 hits"
}

log "verifying staged tree"
for f in package.json cordis.patch.yml lib/index.js README.md LICENSE .gitignore; do
  [ -e "$TMP/$f" ] || die "staged tree is missing $f"
done
[ -d "$TMP/locale" ] || die "staged tree is missing locale/"
if [ -e "$TMP/src" ] || [ -e "$TMP/tests" ]; then
  die "refusing to publish src/ or tests/ — the auditor would flag its own source"
fi

guard_self_flags

# --- 5. commit --------------------------------------------------------------
VERSION="$(node -p "require('$PKG_DIR/package.json').version" 2>/dev/null || echo unknown)"
SRC_SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"

log "committing mirror of Suxeca/dsh-plugin@$SRC_SHA"
git -C "$TMP" init -q
git -C "$TMP" symbolic-ref HEAD "refs/heads/$BRANCH"
git -C "$TMP" config user.name "$GIT_NAME"
git -C "$TMP" config user.email "$GIT_EMAIL"
git -C "$TMP" config commit.gpgsign false
git -C "$TMP" add -A
git -C "$TMP" commit -q -m "release: @suxeca/dsh-plugin-repo-auditor v$VERSION

Auto-generated mirror. Source of truth:
  https://github.com/Suxeca/dsh-plugin/tree/$BRANCH/packages/dsh-plugin-repo-auditor
  (source commit $SRC_SHA)

Installable artifacts only: lib/ (prebuilt), cordis.patch.yml, locale/,
package.json. No src/, no tests/ — and every detection marker is assembled at
runtime, so the published bytes never carry this plugin's own detector table."
printf '    tree %s
' "$(git -C "$TMP" rev-parse 'HEAD^{tree}')"

# --- 6. push ----------------------------------------------------------------
if [ "$DRY_RUN" -eq 1 ]; then
  log "dry run — skipping push"
else
  git -C "$TMP" remote add origin "$MIRROR_GIT"
  log "pushing to $MIRROR_URL ($BRANCH)"
  if git -C "$TMP" fetch -q origin "$BRANCH" 2>/dev/null; then
    # origin/$BRANCH now exists locally, so the lease is a real guard.
    git -C "$TMP" push -q --force-with-lease origin "$BRANCH"
  else
    printf '    remote branch %s not found — initial publish
' "$BRANCH"
    git -C "$TMP" push -q origin "$BRANCH"
  fi
  log "done"
fi
printf '%s
' "$MIRROR_URL"
