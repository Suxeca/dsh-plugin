# AGENTS.md

本仓库的通用 agent 指令，适用于 DSH、Codex、opencode 等一切在此工作的 agent。

## 长期记忆纪律

本工作区（`~/Workspace/`）维护一套本地记忆体系，位于 `../.agent-memory/`（主账本）与 `../.agent-platform/`（工具与策略）：

1. `../.agent-memory/canonical/` 是已批准长期记忆的**唯一主账本，只读**。
2. agent 不得直接修改 canonical；发现值得沉淀的稳定事实、工作流规则、失败教训时，将候选记忆写入 `../.agent-memory/staging/`（用 `../.agent-platform/cli/agent_memory.py propose`），由人工 validate/approve 后进入 canonical。
3. 没有明确可复用价值的内容不要写入记忆。

## 安全规则

- 禁止在记忆、日志、导出文件中写入完整 key/secret/token/password；一律使用 `env:NAME`、`vault:path` 或 `secret_ref:name` 引用。
- 开始修改代码前，先确认 `../.agent-memory/canonical/` 中相关的 project_constraint、workflow_rule、failure_lesson。

## DSH 改动验证纪律（改 preset / 装 UI 插件必读）

DSH 有几类改动**无法用常规手段自证正确**，所以**先验证、再重启**。四个探针由
`@suxeca/dsh-dev-probes` 提供（已进 web profile 的 `bundles`，重启后照常装配，常驻可用）：

| 时机 | 调用 | 通过标准 |
|---|---|---|
| 改完任何 agent preset 的 `agent.cordis.yml`，**重启 DSH 之前** | `dsh_preset_parse_check` | `verdict: "PARSES"` 才说明磁盘字节可挂载 |
| 想知道某 preset 装了什么 / 为什么坏 | `dsh_preset_probe` | `broken` 为 `null` 即健康；同时给出 `rowCount` 与行清单 |
| 装 / 重载 / 注入任何客户端（UI）插件之后 | `dsh_client_graph_probe` | `present: true` 才说明前端会真的加载它 |
| **往 `dsh.profile.bundles` 加任何包之后、重启之前** | `dsh_profile_preflight` | `verdict: "PASS"` 才说明下次启动能过 bundle 层 |

**为什么非它们不可**（这不是"更方便"，是"否则只能拿会话试错，而试错的代价是一次 DSH 起不来"）：

1. YAML 解析器只证明**语法**没写错，不证明 **DSH loader 会挂载它**——后者才决定下次开新会话能不能起来。
2. `compositionInventory()` 对一个**有活跃挂载**的 preset 回答的是**已装配的旧世代**，不是磁盘上现在的文件。所以直接查正在用的 preset 永远拿到旧答案。`dsh_preset_parse_check` 把 preset 复制成临时 id——副本"从没被装配过"，registry 才会**读盘回答**——看完判决再删副本。它同时暴露 mount 与 disk 的 **`rowCount` 差**：行数不等就说明改动尚未生效，需要重启。
3. `/plugins/<id>/client.js` 在 web 鉴权门后面，`curl` / `fetch` 对**确定能用**的插件同样返回 404，证明不了任何事。host 的 `clientModules.graph()` 才是权威答案。
4. **`dsh.profile.bundles` 是启动路径**：loader 对其中**每一项**都要求 `dsh.bundle.patch`（`app-boot/src/profile.ts` 的 `resolveBundleDir` + `declares no dsh.bundle` 检查），缺了就在启动时 `throw`。代价不对称得离谱——只是「装了个包」，却变成「关掉 DSH 之后再也起不来」，只能手改 profile 的 JSON 自救。**这件事真实发生过一次**（`@suxeca/dsh-dev-probes` 没有 bundle 声明却被 `dev_install_package` 写进 bundles）。预检复刻 loader 自己的两锚点解析（**安装锚点优先**，profile 兜底），所以 `@deepseek-ai/dsh-base` 这类 in-box bundle 不会被误判成缺失。`dev_install_package` 现在也会先验资格：不合格就只 link、不进 bundles（运行时注入照常，重启即失）。

四个探针都是**只读**的。`dsh_preset_parse_check` 唯一会写的是它自己创建的临时副本，且在 `finally` 里删除（上次崩溃的残留会在下一次调用开头清掉）。`dsh_profile_preflight` 的 `with` 参数只在内存里预演，不改 profile。

## 参考策略

- 记忆策略：`../.agent-platform/policies/memory_policy.md`
- 密钥策略：`../.agent-platform/policies/secret_policy.md`
