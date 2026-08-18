#!/usr/bin/env bash
# router-commandcode 一键健康检查（verify.sh）
# 双体检：注入器层（手术台）+ 预设层（产品）。配合 OPERATIONS.md 使用。
# 依赖：bash + curl + python3（Git Bash/WSL 亦可）。只读，不修改任何配置。
set -uo pipefail

API="${DSH_WEB_URL:-http://127.0.0.1:3080}"
PRESET_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRESET_ID="router-commandcode"
SETTINGS="$HOME/.dsh/settings.yaml"
HEAL_LOG="$HOME/.dsh/super-injector/self-heal.log"

pass=0; fail=0
ok()   { pass=$((pass+1)); echo "  [PASS] $1"; }
bad()  { fail=$((fail+1)); echo "  [FAIL] $1"; }

echo "===== router-commandcode 健康检查 ($(date '+%F %T')) ====="
echo "预设目录: $PRESET_DIR"
echo "DSH: $API"

# ── 1. 注入器 API 活性 ──────────────────────────────────────────────
echo "-- 注入器层 --"
if resp=$(curl -s --max-time 5 "$API/super-injector/api/list" 2>/dev/null); then
  if echo "$resp" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("ok") else 1)' 2>/dev/null; then
    ok "注入器 API active ($API/super-injector/api/list)"
  else
    bad "注入器 API 响应异常: ${resp:0:120}"
  fi
else
  bad "注入器 API 不可达（DSH web 未运行？）"
fi

# ── 2. 注入器自愈日志无失败 ─────────────────────────────────────────
if [ -f "$HEAL_LOG" ]; then
  if grep -qE "heal-failed|reboot-failed" "$HEAL_LOG"; then
    bad "self-heal.log 存在失败记录（tail 查看）"
  else
    ok "self-heal.log 无 heal-failed/reboot-failed"
  fi
else
  bad "self-heal.log 不存在（注入器未装配？）"
fi

# ── 3. 预设 discovery ───────────────────────────────────────────────
echo "-- 预设层 --"
rpc_body='{"type":"client-request","rpcId":"verify","method":"agentPreset.list","payload":{}}'
if resp=$(curl -s --max-time 10 -X POST "$API/api/agentPreset.list" \
    -H 'content-type: application/json' -d "$rpc_body" 2>/dev/null); then
  if echo "$resp" | python3 -c '
import json,sys
d=json.load(sys.stdin)
ids=[p["id"] for p in d.get("result",{}).get("value",{}).get("presets",[])]
sys.exit(0 if "'$PRESET_ID'" in ids else 1)' 2>/dev/null; then
    ok "discovery 包含预设 '$PRESET_ID'"
  else
    bad "discovery 未包含 '$PRESET_ID'（列表: $(echo "$resp" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(",".join(p["id"] for p in d.get("result",{}).get("value",{}).get("presets",[])))' 2>/dev/null)）"
  fi
else
  bad "agentPreset.list 不可达"
fi

# ── 4. 预设文件完整性 ───────────────────────────────────────────────
comp="$PRESET_DIR/agent.cordis.yml"
if [ ! -f "$comp" ]; then
  bad "缺少 agent.cordis.yml"
else
  ok "agent.cordis.yml 存在"
  mod=$(grep -oE 'name: \./[^ ]+' "$comp" | head -1 | awk '{print $2}')
  if [ -n "$mod" ] && [ -f "$PRESET_DIR/$mod" ]; then
    ok "composition 引用模块存在: $mod"
    if command -v node >/dev/null 2>&1; then
      if node --check "$PRESET_DIR/$mod" >/dev/null 2>&1; then
        ok "模块语法 OK: $mod"
      else
        bad "模块语法错误: $mod（node --check）"
      fi
    fi
  else
    bad "composition 引用模块缺失: $mod"
  fi
fi

# ── 5. DSH_CHECKOUT 可探测性（dev_self_test 前置）──────────────────
echo "-- 环境 --"
co="${DSH_CHECKOUT:-}"
for c in "$co" "$HOME/dsh-harness" "$HOME/dsh" "$HOME/.dsh/dsh-harness"; do
  if [ -n "$c" ] && [ -d "$c/packages" ]; then
    ok "DSH checkout 可探测: $c"
    co_found=1; break
  fi
done
if [ -z "${co_found:-}" ]; then
  bad "DSH_CHECKOUT 不可探测（dev_self_test 会 FAIL）——见 OPERATIONS.md §4"
fi

# ── 6. 默认模型未被污染 ─────────────────────────────────────────────
if [ -f "$SETTINGS" ]; then
  if python3 -c '
import re,sys
s=open("'$SETTINGS'").read()
m=re.search(r"agent-default-model:\s*\n\s*provider:\s*(\S+)\n\s*model:\s*(\S+)", s)
sys.exit(0 if m and m.group(1)=="commandcode" and m.group(2)=="deepseek/deepseek-v4-flash" else 1)' 2>/dev/null; then
    ok "默认模型 = commandcode/deepseek/deepseek-v4-flash（未被 selectModel 污染）"
  else
    bad "默认模型不是 commandcode/deepseek/deepseek-v4-flash——恢复方法见 OPERATIONS.md §5 坑 2"
  fi
else
  bad "settings.yaml 不存在"
fi

echo "===== 结果: PASS $pass / FAIL $fail ====="
[ "$fail" -eq 0 ] || echo "提示: 逐项对照 OPERATIONS.md 处理；归因顺序先注入器（自重载+自检）再预设。"
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)
