# router-opencode-go 实测数据（对照实验）

> 记录本仓库对 `router-opencode-go` 三项适配（深度思考锚 / Flash 恒 weak / sage-mem
> 过滤）的真实测量。实验日期 2026-08-15。
> 相关：与 [v4godmode 差异对比](compare-v4-godmode.md)。

## 实验 1：深度思考锚（A）+ Flash 恒 weak（B）三组对照

**任务**（固定，272 字符）：编写 2D 多球刚体碰撞模拟器（HTML+Canvas）——重力/墙壁反弹、
球-球弹性碰撞动量守恒、能量衰减、拖拽发射、页面加载自测（500 次碰撞后断言总动量变化
<1% 并显示 PASS/FAIL）、禁外部 CDN；完成后用 bash 验证文件并报告自测结果。

**控制变量**：同一模型 `opencode-go/deepseek-v4-flash`、`reasoningEffort: max`（request/header
确认生效）、同一 cwd、同一提示词；仅预设变体不同。

| 指标　　 | v0 官方逻辑 | v1 +A（深度锚） | v3 +A+B（+Flash 恒 weak） |
|---|---|---|---|
| **推理量**（reasoning chars） | 51,121 | 76,921（**+50%**） | 97,807（**+91%**） |
| **工具步数** | 5（线性） | 4（线性） | 9（**迭代**） |
| **persona 遵循** | ❌ 违反（跑了被明令禁止的 `node --version` 环境检查） | ✅ | ✅ |
| **验证深度** | 5 轮动量/动能（误差 ~1e-16） | **13/13 项**：动量 1e-17、动能守恒、等质量正碰速度交换、完全非弹性（E 减半）、墙壁反弹（vy×e、E×e²）、质量比公式… | **5 种配置边界**（e=0.5、无重力、1000 碰撞）+ 单次碰撞冲量守恒 + **外力补偿动量核算**（开放系统） |
| **主动修复 bug** | 无 | 无 | **2 个**（渲染层 NaN；极端配置静息导致碰撞数不足） |
| **交付规模** | 399 行 / 14.6 KB | 388 行 / 15.8 KB（含独立 Node 无头测试文件） | 548 行 / 21.3 KB |

**工具调用序列对比**

- v0：`bash(mkdir+node --version)` → `write` → `bash(检查)` → `bash(5 轮自测)` —— 第一步就违反 persona
- v1：`bash(mkdir)` → `write` → `write(独立测试文件)` → `bash(检查+运行)` —— 无环境检查，验证矩阵翻倍
- v3：`bash` → `write` → **`edit`(修 NaN)** → `bash` → `bash(无头测)` → **`edit`×3(修静息不足)** → `bash` → `bash` —— 写-测-修-再测闭环

**结论**

1. **A（深度锚）效果显著且稳定**：思考 +50%、验证矩阵翻倍、唯一消除 persona 违规
   （官方版是唯一跑环境检查的——正是 WEAK_FLASH 明令禁止的行为，即"鬼模式"表征）
2. **B（Flash 恒 weak）在 A 之上再 +27% 思考量**，且 v3 是唯一出现主动迭代修复的组；
   单样本有随机性，方向与 v4godmode 作者柴油机实测一致（规划深度 2.9万→37.5万字）
3. 两适配均已在最终版 `router-opencode-go` 落地（`router-go-core.mjs` WEAK_FLASH 三段 +
   `resolveMode` flash→weak）

## 实验 2：sage-mem 污染验证与修复

**机制**：官方 `sessionMode` 取第一条 `user/message` 分类；sage-mem 记忆正是以 plugin 源
注入的首条消息，其文本含大量关键词（修复/bugfix/refactor/develop/实现…）。

**分类级验证**（真实文本，`classifyTask`）：

| 输入　　 | 结果 |
|---|---|
| sage-mem 记忆文本（真实抓取） | **0（spec）** —— 污染 |
| 真实用户消息（"你好…"） | **weak** —— 正确 |
| sage-mem + 用户消息拼接 | 0（spec）—— 拼接仍污染 |

**端到端验证**（修复 `sessionModeUser` 后，第二条消息 `dev_router_status`）：

| 预设　　 | 修复前 | 修复后 |
|---|---|---|
| `router-opencode-go`（opencode-go flash + max） | mode 被带偏（实测 spec） | `mode=weak` + 三段 WEAK_FLASH ✓ |
| `router-standard`（deepseek-official flash） | 同污染 | `mode=weak` + WEAK_FLASH ✓ |

**结论**：`sessionModeUser`（只分类 `source.kind==='user'`）对两个预设的 flash 与非 flash
场景均生效；本会话早期显示 `mode=0.00 (spec)` 即为污染实例（真实任务消息分类应为 weak）。

## 实验 3：注入链路验证（system prompt 真实到达 opencode-go）

`request/header` 事件暴露实际发送的请求（含 system 全文）：

- `config`: `{"provider":"opencode-go","model":"deepseek-v4-flash","reasoningEffort":"max","maxTokens":384000}`
- `system`：三段 WEAK_FLASH 全文（classify 锚 + 回顾/反跑题锚 + 深度思考锚）逐字存在 ✓
- 首轮工具面：仅 core 集（`read/edit/glob/grep` 或 `read/write/edit` + shell）——首轮锚定裁剪生效 ✓
- 首个工具调用后（promoted）：全量工具（含 `dev_router_status` 等）✓

**结论**：注入发生在 DSH 统一组装层（`system-prompt/assemble` → `ctx.llm.stream` →
llm-pi-ai `systemPrompt` 槽 → opencode-go 网关），provider 无关，实测链路完整。

## 附加记录：provider 记录机制（不硬门控）

`agent/request` 瀑布观测（root 层）：

```
[assemble] variables={"provider":"deepseek-official",...}   ← 装配期快照（不可靠）
[request]  provider=opencode-go model=deepseek-v4-flash      ← 实际请求（权威）
```

装配期 `variables` 与实际请求 provider 不一致（selection 链 split-brain）→
**硬门控会误判/漏首轮** → 最终版采用"`agent/request` 记录权威路由，只展示不门控"。
