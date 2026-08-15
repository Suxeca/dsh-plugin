# 与 v4-flash-godmode-opencode-go 的对比

> 同类项目：[SheberDavid/v4-flash-godmode-opencode-go](https://github.com/SheberDavid/v4-flash-godmode-opencode-go)
> （V4 Flash 神模式）——同样把 router-standard 的 w7 引导适配到 opencode-go 的
> `deepseek-v4-flash`。本文记录两者同源关系、主要差别与各自适用场景。
> 更新于 2026-08-15。

## 同源

两者都派生自 [yjh051108/dsh-router-standard](https://github.com/yjh051108/dsh-router-standard)
（MIT，P1–P30 实测论文）：同一个 `router-core.mjs` 路由逻辑、同一个
`system-prompt/assemble` 注入通道、同一套 persona / 首轮核心工具裁剪 / promoted 解锁机制。
两者也都独立发现了 **dsh rc.6 上动态近场引导（`session/event` + `inbox.append`）失效**
（session-scoped 事件收不到、agent 无 inbox 句柄、assemble 时序），并采用相同的解法：
**把深度引导静态并入 WEAK_FLASH persona**。

另外两项实测调参（深度思考锚、Flash 恒 weak）最初来自 v4godmode 作者（柴油机 3D 仿真
实测"神模式"），本仓库在 opencode-go/deepseek-v4-flash 上做了三组对照实验
（官方 / +深度锚 / +深度锚+flash-weak）复现验证：思考量 +50% / +91%、验证矩阵翻倍、
persona 遵循度提升——结论一致后采纳。

## 主要差别

| 维度 | 本仓库 `router-opencode-go` | v4godmode `router-flash` |
|---|---|---|
| **provider 架构** | 预设 + **手动选模型**（默认模型保持 deepseek-official，用户约束）；`agent/request` 瀑布记录**实际发出的 provider/model**（权威值），`dev_router_status` 展示 route、`dev_mode_subagent` 使用 | 安装脚本 **install.sh 直接改全局默认**（settings `agent-default-model` = opencode-go + `agent-presets.default` = router-flash），不区分 provider |
| **sage-mem 污染修复** | ✅ `sessionModeUser` 只分类真实用户消息（`source.kind === 'user'`），跳过 sage-mem 等 plugin 注入的首条消息——**对非 flash 场景同样生效**（router-standard 同款补丁已收录） | ❌ 仅靠"flash 恒 weak"间接免疫 flash；非 flash 走官方 `sessionMode` 仍会被首条注入记忆文本污染（实测会把"你好"会话带偏成 spec） |
| **dev_mode_subagent 路由** | 用记录的**实际路由**（selectModel 切换后仍正确） | 用 `agent.options`（创建时快照；selectModel 后子任务会打到旧 provider/model） |
| **provider 硬门控** | 实测不可行（assemble 时点 `variables` 与实际请求 provider 不一致）→ **只记录不门控** | 未涉及（全局换默认，无多 provider 场景） |
| **运维体系** | ✅ 完整：`OPERATIONS.md`（安装链：注入器自重载 → `dev_self_test` 8/8 → 装预设 → discovery → 冒烟；ESM 缓存更新规则；故障诊断矩阵；已知环境坑）+ `scripts/verify.sh` 一键健康检查 | ❌ 仅 install.sh（复制 + 提示改 settings），无自检/诊断/更新规则 |
| **默认模型影响** | 不动；可与其他预设/模型并存，随时回退 | 全局改默认，影响所有新会话，回退需手动改回 |
| **实测方法** | 三组对照实验（同任务、同模型、reasoningEffort=max）：官方 vs +A vs +A+B，[完整数据](measurements-router-opencode-go.md) | 单任务实测（四冲程柴油机 3D 仿真：规划深度 2.9万→37.5万字，补数值验证） |

## 一句话总结

注入原理同源（官方 assemble 通道 + persona/工具锚定）；v4godmode 的价值在**实测调参参数**
（深度锚、flash-weak），本仓库的增量在**工程完备性**（provider 感知、sage-mem 污染修复、
subagent 路由修正、完整运维体系）——架构差异源于约束不同：它"直接换默认模型"，
本仓库"默认不动、手动选"，因此需要 provider 记录而它不需要。
