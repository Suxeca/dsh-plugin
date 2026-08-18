# router-commandcode 运维手册（OPERATIONS）

> 本预设的完整运维模型：**两层独立、流程串联**。
> - **注入器层**（dsh-super-injector）＝运行时手术台：安装/自检/热重载/自愈/诊断。
> - **预设层**（本目录）＝产品：persona 注入/路由/工具裁剪，运行时**不依赖**注入器
>   （走官方 agent-presets 装配通道），但**安装与运维流程按作者指导依赖注入器先行**：
>   先确保手术台健康，再动手术。
>
> 作者原话要点："必须让 dsh 先将注入器自重载、确保安装成功可使用了，再安装 preset。"

---

## 0. 本机环境事实（写文档时实测）

| 项　　 | 值 |
|---|---|
| DSH web | `http://127.0.0.1:3080`（进程 `bin.ts --profile web`，勿误杀） |
| 注入器持久副本 | `~/Workspace/dsh-plugin/third-party/dsh-super-injector/`（lib/ 已构建） |
| 预设安装位置 | `~/.dsh/.agent-presets/router-commandcode/`（目录名 = preset id） |
| DSH checkout | `~/Workspace/deepseek-harness`（**不在注入器 detectCheckout 的探测路径**，见 §4） |
| commandcode provider | `settings.yaml` → `llm-pi-ai.providers.commandcode`，`apiKeyEnv: COMMANDCODE_API_KEY` |
| commandcode wire compat | `compat.thinkingFormat: deepseek` + `supportsReasoningEffort: true`（请求带 `thinking` + `reasoning_effort`，贴近官方 DeepSeek 写法） |
| 默认模型　　 | `commandcode/deepseek/deepseek-v4-flash` + `reasoningEffort: max`（**勿改**，见 §5 坑 2/3） |

---

## 1. 安装链（完整流程，含注入器先行）

```bash
# ── 第 0 步：前置检查 ──────────────────────────────────────────────
curl -s http://127.0.0.1:3080/super-injector/api/list | head -c 200
#   期望 {"ok":true,...} —— 注入器已装配且 active

# ── 第 1 步：注入器自重载（作者指导：先确认手术台可用）──────────
#   在任一 agent 会话里执行（或 GUI 新会话）：
#   dev_reload_package dsh-super-injector
#   期望输出 before: [active] → after: [active]（自杀→重建，fiber uid 变化）
#   落盘证据：tail ~/.dsh/super-injector/self-heal.log
#     → self-reload: ... 自杀并排程重启器 → purge-stale-tools → client-meta-healed

# ── 第 2 步：注入器自检（8/8 全链路回归）──────────────────────────
#   dev_self_test
#   期望 PASS 8/8：构建/注入/热重载 uid 变化/自重载节流/预检拦截/恢复/卸载/patch
#   ⚠️ 前置：DSH_CHECKOUT 必须可探测（§4）——否则第一项 FAIL 直接中断

# ── 第 3 步：安装预设 ─────────────────────────────────────────────
cp -a ~/.dsh/.agent-presets/router-commandcode ~/.dsh/.agent-presets/router-commandcode.new
#   （从仓库/备份拷贝时注意：改过的模块文件必须保持唯一文件名，见 §3）
#   discovery 每次调用重扫目录 → 无需重启即可见

# ── 第 4 步：确认 discovery 健康 ───────────────────────────────────
curl -s -X POST http://127.0.0.1:3080/api/agentPreset.list \
  -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"v1","method":"agentPreset.list","payload":{}}'
#   期望列表含 router-commandcode（composition 合法；不合法会以 broken 行出现）

# ── 第 5 步：端到端冒烟（新会话）──────────────────────────────────
#   ① GUI 新建会话 → 预设选 Router Command Code (experimental)
#   ② 模型选 commandcode/deepseek/deepseek-v4-flash，reasoningEffort 设 max
#   ③ 发一条消息，然后让模型调用 dev_router_status，期望：
#      route=commandcode/deepseek/deepseek-v4-flash (source=request)
#      mode=weak (band=weak)
#      persona=You are a helpful assistant. / Before acting, decide... / Think deeply...
#      （三段 WEAK_FLASH = 深度锚版）
#   ④ 更强验证（直接看请求 payload）：会话 history 的 request/header 事件
#      含 system 全文 —— 应含三段 WEAK_FLASH + reasoningEffort:max + maxTokens:384000
#      request/header 或 pi-ai payload 应含 thinking + reasoning_effort（commandcode compat 已设 deepseek）
```

---

## 2. 日常健康检查

### 一键体检（推荐）

```bash
bash ~/.dsh/.agent-presets/router-commandcode/scripts/verify.sh
```

检查项：注入器 API 活性 → 预设 discovery → 预设文件完整性（composition 引用/语法）→
DSH_CHECKOUT 可探测性 → 默认模型未被污染。任一 FAIL 按输出提示处理。

### 手动清单

| 检查　　 | 命令 | 期望 |
|---|---|---|
| 注入器 active | `dev_plugin_status` | `dsh-super-injector (@dsh-external/...) [active]` |
| 注入器自愈链 | `tail ~/.dsh/super-injector/self-heal.log` | 尾部无 `heal-failed` / `reboot-failed` |
| 注入器回归　　 | `dev_self_test` | PASS 8/8（需 DSH_CHECKOUT） |
| 预设 discovery | `agentPreset.list`（curl 见 §1 步 4） | 含 `router-commandcode`，无 broken |
| 会话级路由　　 | 会话内 `dev_router_status` | `route=commandcode/...` + `mode=weak` |
| 实际注入证据 | 会话 history 的 `request/header` | system 含三段 WEAK_FLASH |

---

## 3. 更新预设（ESM 缓存陷阱 —— 必读）

**规则（作者 README 同款）**：运行中的 DSH 进程按 URL 缓存 ESM 模块，
**同路径覆盖文件不会生效**（新会话仍加载旧代码）。改预设必须二选一：

- **方案 A：换文件名（免重启，推荐）**
  1. 修改 `router-commandcode-bootstrap-v1.mjs`（或 `router-commandcode-core-v1.mjs`）→ 保存为**新文件名**
     （如 `router-commandcode-bootstrap-v2.mjs`；core 被 import 时 bootstrap 也要跟着改名）
  2. 更新 `agent.cordis.yml` 里 `name: ./新文件名`
  3. 删除旧文件（避免歧义）
  4. 新会话验证（§1 步 5）
- **方案 B：重启 DSH**（会断开所有会话；web 进程 `bin.ts --profile web`）

> 注意：`dev_plugin_status` 里 preset entry 可能显示旧 URL（首次加载记录），
> 不影响功能，重启后自然消失。

---

## 4. DSH_CHECKOUT（注入器自检/构建的探测）

注入器 `detectCheckout()` 只认：`process.env.DSH_CHECKOUT` → `~/dsh-harness` → `~/dsh` → `~/.dsh/dsh-harness`。
本机 checkout 在 `~/Workspace/deepseek-harness`——**不在探测路径**，`dev_self_test` 第一项会 FAIL。

修复（三选一）：
1. **推荐**：在 DSH 启动环境导出 `export DSH_CHECKOUT="$HOME/Workspace/deepseek-harness"`
   （`~` 在 export 中不展开，用 `$HOME`；shell profile / systemd / 启动脚本），重启 DSH 后永久生效；
2. 运行中临时设置：staging 工具（dev_stage_add）内 `process.env.DSH_CHECKOUT = ...`（重启失效）；
3. 软链兜底：`ln -s ~/Workspace/deepseek-harness ~/dsh-harness`（一劳永逸，无需重启）。

---

## 5. 已知环境坑（实测记录）

1. **自检的 Windows 路径残留**：`dev_self_test` 的测试插件目录写死 `/dsh/selftest-runner`，
   Linux 上解析为相对路径 → 在进程 cwd 下创建 `D:` 目录。跑完自检后清理：
   `rm -rf "<进程cwd>/D:"`（本机 = `~/Workspace/deepseek-harness/D:`）。
   已向作者反馈 Linux 兼容问题。
2. **selectModel 会写全局默认模型**：API 调 `session.selectModel` 会触发
   `saveDefaultModelSelection`，把默认模型改成所选（→ 污染 settings.yaml）。
   测试/脚本后必须恢复：
   ```yaml
   agent-default-model:
     provider: commandcode
     model: deepseek/deepseek-v4-flash
     reasoningEffort: max
   ```
3. **默认模型勿改**：本预设面向 commandcode 默认模型（用户已设）。默认保持 commandcode/deepseek/deepseek-v4-flash。
4. **sage-mem 注入**：作为 plugin 源首条消息注入，预设的 `sessionModeUser` 已过滤
   （只分类 `source.kind==='user'`）——不要再改回 `sessionMode` 直取。

---

## 6. 故障诊断矩阵

| 症状　　 | 归因层 | 排查步骤 |
|---|---|---|
| 新会话无 dev_router_status | 预设 | discovery broken？`agentPreset.list` 看 broken 行；composition 引用文件是否存在 |
| 会话报错"no platform shell" | 预设 | bootstrap 抛错：检查 `router-commandcode-*.mjs` 语法（`node --check`）；文件是否被改名后 composition 未更新 |
| 注入的 persona 是旧版 | 预设 | §3 ESM 缓存：文件被原地覆盖 → 换名 |
| dev_* 注入器工具消失 | 注入器 | `dev_plugin_status` fiber 状态；self-heal.log 有无 heal-failed；`dev_reload_package dsh-super-injector` 重载 |
| dev_self_test 首项 FAIL | 环境 | §4 DSH_CHECKOUT |
| 路由 mode 变成 spec/react 而非 weak | 预设 | 会话是否旧代码快照（重启/新会话）；`sessionModeUser` 是否被改回 |
| 请求里没看到注入的 system | 预设 | request/header 事件验证；确认会话模型是 commandcode（`dev_router_status` 的 route 行） |
| 模型无响应/报错 | 网关 | commandcode key（COMMANDCODE_API_KEY）有效性；llm-pi-ai 的 request/context 事件 |

**归因顺序铁律（作者指导的延伸）**：先 `dev_reload_package dsh-super-injector` + `dev_self_test`
确认手术台健康 → 再排查预设层。变量隔离，不混锅。

---

## 7. 卸载 / 回滚

```bash
# 预设：删目录即消失（discovery 重扫）
rm -rf ~/.dsh/.agent-presets/router-commandcode

# 注入器（如需整体回退）：官方路径
#   dev_uninject_plugin dsh-super-injector   （运行时卸载）
#   或 dsh plugin --profile web remove @dsh-external/dsh-super-injector （重启后不再装配）
```

---

## 8. 文件清单

| 文件　　 | 作用 |
|---|---|
| `agent.cordis.yml` | 组合文件（预设 id = 目录名；引用 `./router-commandcode-bootstrap-v1.mjs`） |
| `preset.yml` | 展示元数据（name/description） |
| `router-commandcode-bootstrap-v1.mjs` | 路由插件：persona 注入/工具裁剪/provider 记录/`sessionModeUser` 过滤 |
| `router-commandcode-core-v1.mjs` | 纯路由逻辑（persona 文本/分类/带宽映射，零依赖） |
| `scripts/verify.sh` | 一键健康检查（§2） |
| `OPERATIONS.md` | 本文档 |
