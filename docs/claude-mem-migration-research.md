# claude-mem → DSH 记忆插件迁移调研报告

> 调研日期：2026-09-10 · 调研范围：本机环境实测 + 生态仓库源码/README 查证
> 本报告只读不写：未修改任何代码，未改动 `~/.claude-mem/claude-mem.db`（全部最终查询走 `file:...?mode=ro&immutable=1` 只读连接）。DB 文件大小与 mtime 与调研开始时完全一致（45,551,616 B / 2026-09-10 16:45:01），`pragma quick_check` 返回 `ok`。

**结论先行**：生态里**没有任何**现成工具能直接读 claude-mem 的 SQLite。但有三条实测发现改变了问题的性质：

1. **约 89%（1414/1594）的 observation，其原始 DSH 会话日志仍完整躺在 `~/.dsh/sessions/`** → 用 `dsh-deja` 可以直接索引，**零迁移、零 LLM 成本**。
2. **`sage-mem` 本身就是 DSH 插件**，`~/.claude-mem/claude-mem.db` 是它正在使用的**活库**，不是遗留归档。
3. **这条链路当前是坏的**（worker 每次调用都 `OpenRouter auth error 401`）→ `observations` 已停止增长，修好之前不再产生新记忆，**迁移紧迫性上升**。

推荐组合见 [§5](#5-推荐路径)：**主轨 `dsh-deja`（零成本索引源材料）+ 副轨 `dsh-mneme`（零 LLM 导入 1594 条结构化结论）**。

---

## 1. 已查证的事实基线

### 1.1 数据源实测（`~/.claude-mem/claude-mem.db`，45,551,616 字节）

| 表 | 行数（首次实测） | 备注 |
|---|---|---|
| `observations` | **1594** | 与任务描述一致；调研全程稳定在 1594 |
| `user_prompts` | 2793 → **2790** | 调研期间**减少了 3 行**（见 §1.5：DB 是活的） |
| `session_summaries` | 757 | 稳定 |
| `sdk_sessions` | 520 → **518** | 调研期间**减少了 2 行** |

> ⚠️ **这张库不是静态的**：调研过程中 `user_prompts`/`sdk_sessions` 行数发生了变化（详情与原因见 [§1.5](#15-关键发现三这套记忆链路目前是活的而且当前是坏的)）。`observations` 数量未变，因此**结论不受影响**，但迁移前建议先做一次快照备份。

- `observations.project` 全部为 `sage`（1594/1594）。
- 时间跨度：`2026-08-14T06:49:52.187Z` → `2026-08-19T09:37:26.696Z`。
- type 分布：discovery 555 / decision 330 / change 238 / bugfix 200 / feature 196 / security_alert 55 / security_note 15 / refactor 3 / sensitive 2。
- 字段实测（字符数）：

| 字段 | CJK 字符 | 非 CJK 字符 | 合计 | 备注 |
|---|---|---|---|---|
| title | 23,062 | 26,672 | 49,734 | |
| subtitle | 30,457 | 17,644 | 48,101 | |
| text | 35,411 | 96,860 | 132,271 | **1452/1594 行为空**，仅 142 行有值 |
| facts | 82,860 | 90,704 | 173,564 | |
| narrative | 166,706 | 158,899 | 325,605 | 平均 204 字符；仅 2 行为空 |
| concepts | 0 | 37,591 | 37,591 | |
| **合计** | **338,496** | **428,370** | **766,866** | |

- 索引实测：`observations` 有 `ux_observations_session_hash`（`memory_session_id` + `content_hash` 唯一），即**库内已有内容级去重键**；`content_hash` 字段存在，可直接用于跨库去重。

### 1.2 关键发现一：sage-mem 已经是 DSH 插件，DB 就是它的后端

`~/Workspace/dsh-plugin/third-party/sage-mem` 是一个 **DSH 侧桥接插件**（140 行），不是独立记忆系统：

```
DSH 事件流 → sage-mem 插件（lib/index.js，HTTP 客户端）
           → POST http://127.0.0.1:37700/api/sessions/{init,observations,summarize}
           → sage-mem worker（Bun 常驻，fork 自 claude-mem）
           → ~/.claude-mem/claude-mem.db
```

- 已查证：`~/.dsh/profiles/web/package.json` 的 `dependencies` 与 `dsh.profile.bundles` **都包含 `sage-mem`**，`link:/home/suxeca/Workspace/sage-mem`。
- 已查证：worker 由 `~/.claude-mem/supervisor.json` 托管（pid 3666 / port 37700），**调研期间确实被 DSH 会话触发过写入**——即该 DB 是**活的，不是静态归档**。⚠️ 我最初基于 `ps` 快照判断它"未运行"，后被日志推翻；正确结论见 [§1.5](#15-关键发现三这套记忆链路是活的而且当前是坏的)。
- 含义：**claude-mem 的 DB 不是"外部遗留数据"，而是本机 DSH 记忆链路正在使用的库。** 迁移到另一个记忆插件 = 换后端，需考虑与 sage-mem 并存时的双注入问题（见 §5.2），并**在迁移前先做快照备份**。

### 1.3 关键发现二：**97.6%** 的 observation 其源会话日志仍在磁盘上

`observations.memory_session_id` 形如 `openrouter-2629cce9-4add-4ba8-9e20-de072525342f-1786729334683`——**中段嵌着 DSH 的 session UUID**，前后缀是 provider 名与时间戳。

**先修正一个坑**：本机 DSH 会话目录**并存两种命名**（实测）：

| 布局 | 目录数 | 内含 `session.jsonl.zstd` |
|---|---|---|
| `~/.dsh/sessions/<slug>/session-<uuid>/` | 400 | ✅ |
| `~/.dsh/sessions/<slug>/<uuid>/`（**无 `session-` 前缀**） | 153 | ✅ |
| **合计** | **553** | **553** |

> deja 的 registry 只描述了 `session-<uuid>` 这一种布局。本机有 153 个会话是**裸 UUID 目录**——如果 deja 的 DSH 解析器按 registry 只匹配 `session-*`，这 153 个会话可能**被漏掉**。这一点**未实测**（deja 未安装），建议安装后先跑 `deja stats` 核对会话数是否接近 553，若是约 400 则说明裸 UUID 布局未被识别。详见 [§7](#7-未查到--存疑项禁止编造如实列出) 第 10 条。

**两个候选连接键的实测命中率**：

| 连接键 | 命中 DSH 会话 | 说明 |
|---|---|---|
| `sdk_sessions.content_session_id`（裸 UUID） | **147 / 518**（28.4%） | 该表含 518 个会话，多数没产出 observation 或已过期 |
| `observations.memory_session_id` 的 UUID 段 | **110 / 122**（**90.2%**） | 对"有记忆的会话"覆盖率高 |

**加权到 observation 条数（最有意义的指标）**：

| 指标 | 数量 | 占比 |
|---|---|---|
| observation 总数 | 1594 | 100% |
| 其中 `memory_session_id` 可提取出 UUID | 1449 | 90.9% |
| **…且该 UUID 的 DSH 会话日志仍在磁盘** | **1414** | **88.7%（占全量）/ 97.6%（占可提取者）** |
| `claude-migrate-*` 合成会话（**无** UUID，deja 覆盖不到） | 142 | 8.9% |
| UUID 存在但日志已不在磁盘 | 35 | 2.2% |

**结论**：**约 89%（1414/1594）的 claude-mem 记忆，其原始会话日志仍然完整躺在 `~/.dsh/sessions/`。** 这意味着"召回过去"这个目标对绝大多数记忆而言可以**不经迁移、零成本**达成——原始素材就在那儿，缺的只是一个索引器。

未被覆盖的 142 条来自 `claude-migrate-*`（从 Claude Code 侧迁移进来的历史），这部分需要走 §5 的导入路径补。

### 1.4 环境前提（实测）

| 依赖 | 状态 |
|---|---|
| `zstd` CLI | ✅ v1.5.7（deja 读 DSH 会话的硬前提） |
| `sqlite3` | ✅ 3.51.2 |
| `node` | ✅ v26.8.0-alpha.0.0 |
| `bun` | ✅ 1.3.14 |
| `dsh` | ✅ 0.1.2-alpha.1 |
| `deja` 二进制 | ❌ 未安装；`~/.cache/deja` 不存在 |
| 已装记忆插件 | 仅 `sage-mem` |

### 1.5 关键发现三：这套记忆链路是**活的**，而且**当前是坏的**

调研过程中我先后两次统计行数，发现 `user_prompts` 2793→2790、`sdk_sessions` 520→518，于是追查写入方，实测：

- `~/.claude-mem/supervisor.json` 显示托管进程 `worker`（pid 3666，端口 37700，启动于 2026-09-02T10:15:15Z）。
- `~/.claude-mem/logs/claude-mem-2026-09-02.log` 的 mtime 是 **2026-09-10 16:54**——就在本次调研进行中；`db-wal` 同样是 16:54。
- 日志尾部显示 worker 在 16:49 与 16:54 被 DSH 会话触发并写入 `sdk_sessions` 行（`Session initialized`），但**每一次都失败**：

```
[ERROR] [SDK] [session-515] OpenRouter init query failed {model=deepseek-chat}
        OpenRouter auth error (status 401)
[ERROR] [SESSION] [session-515] Generator failed {provider=openrouter, ... status 401}
[INFO ] [SESSION] [session-515] Session finalized
```

**两条重要推论**：

1. **`observations` 已经停止增长。** 每次 DSH 会话仍会创建 `sdk_sessions` 行（所以那张表在动），但 `summarize` 步骤因 401 认证失败，**产生不出新 observation**——这正好解释了为什么 `observations` 稳定在 1594 而会话表在变。**用户此刻只拥有这 1594 条历史记忆，且不再新增。**
2. **迁移的紧迫性上升**：现有链路是坏的（`~/.claude-mem/.env` 里的 `OPENROUTER_API_KEY` 疑似失效），而在修好之前，任何新会话都不会沉淀为记忆。

另外日志揭示了 `memory_session_id` 的**易变性**（对应 claude-mem issue #817）：

```
[WARN] Discarding stale memory_session_id from previous worker instance (Issue #817)
       {sessionDbId=515, reason=SDK context lost on worker restart - will capture new ID}
```

→ **worker 每次重启都会重新生成 `memory_session_id`**。所以做外部映射时，**不要拿 `memory_session_id` 当稳定主键**；稳定键是 `sdk_sessions.content_session_id`（= DSH 的 session UUID）与 `observations.content_hash`。

> 说明：worker 在 16:54 之后不再有日志，且 `ps` 查不到 pid 3666 —— 可能是按需拉起（每次 DSH 会话启动）而非常驻。

---

## 2. 路径 A：现成迁移工具逐一查证

### 2.1 `dsh-memory-porter`（官方 discussions #2819 所指工具）

- 仓库：<https://github.com/Shiye-10Pages/dsh-memory-porter>（MIT，⭐2，18 commits，末次提交 2026-08-17）
- npm：`dsh-memory-porter@0.1.0`（已查证存在）
- 安装：`dsh plugin --profile web add dsh-memory-porter`

**支持的来源（已查证——源码 `src/connectors/` 目录只有 4 个连接器）**：

| 连接器文件 | 来源 | 通道 | 验证状态（作者自述） |
|---|---|---|---|
| `claude-code.ts` | Claude Code 本机 `~/.claude/projects` | 直读 | ✅ 真实数据验过 |
| `claude-web.ts` | claude.ai 导出 `conversations.json` | 需导出 | ✅ 验过 |
| `claude-memories.ts` | Claude **云端记忆** `memories.json` | 需导出 | ✅ 验过，**零 token**（已是结论） |
| `chatgpt.ts` | ChatGPT 导出 `conversations.json` | 需导出 | ⚠️ 作者未用真实导出端到端验过 |

> ⚠️ **易混淆点**：`claude-memories.ts` 指的是 **Claude 账号的云端记忆 `memories.json`**，与用户本机的 **claude-mem（thedotmack/claude-mem，SQLite）是完全不同的东西**。二者只是名字像。

**是否支持 claude-mem / SQLite：❌ 不支持。** 已查证依据：`src/connectors/` 仅上述 4 个文件；`src/types.ts` 的 `SourceKind` 是闭合联合类型，只有 `'claude-code' | 'claude-web' | 'claude-memory' | 'chatgpt'` 四个取值，**没有 SQLite / claude-mem 通道**。

**产出格式（已查证 `src/store.ts`）**：追加式 JSONL，位于 `~/.dsh/memory-porter/`：
- `memories.jsonl` — 已入库记忆
- `pending.jsonl` — 待确认候选
- `decisions.jsonl` — 批准/丢弃决定（被丢弃的候选不会复活）

**成本（作者实测）**：agentic 会话约 1.3 万 tokens/个；默认上限 100 会话约 ¥2.5（空闲）～¥5（高峰）。提纯借宿主 `ctx.llm`，无需另配 key。

**对本次迁移的适用性判断**：
- 它的 `claude-code` 连接器读 `~/.claude/projects`（本机有 **456 MB**），**但读不到 DSH 会话**，也读不到 claude-mem 的 observations。
- 若把 1594 条**已经 LLM 压缩过的** observation 再喂进它的提纯层，属于**二次蒸馏**：既付 LLM 钱，又有信息损失，且 `SourceKind` 无合适取值。
- **但它有一个高价值用途**：它把 `memories.jsonl` 做成**纯追加 JSONL + 文档化 schema**（`src/types.ts` 的「保真契约 v1」）→ 可以**直接手写 `memories.jsonl` 完成导入，零 LLM 成本**（详见 §5.2）。

### 2.2 `dsh-deja` / `deja-vu`

- 仓库：<https://github.com/vshulcz/deja-vu>（MIT，**⭐797**，1,733 commits，v0.19.5，末次提交 2026-09-09）
- npm：`dsh-deja@0.20.6`，描述原文："deja-vu memory for DeepSeek Harness: the session history of twenty-four other coding agents, searchable and recalled before each step — **a local index, no LLM**."
- 安装：`dsh plugin --profile web add dsh-deja`（或 `deja install --auto`）

**是否需要 LLM：❌ 不需要。** 已多处查证：README 明示 "No LLM, no embeddings, one local Go binary"；npm 描述 "no LLM"；对比表列出 "Needs an LLM or embedding key: **no**"。语义召回（`deja embed`）是可选项，默认不启用。

**本地索引位置（已查证）**：`~/.cache/deja/` — `records.bin`（倒排索引）+ token buckets + `manifest.gob`（逐文件增量状态）。实测索引体积约为语料的 3%（作者在 5.2 GB / 143k 消息的真实库上得 160 MB）。

**支持的来源（已查证 — <https://vshulcz.github.io/deja-vu/registry/README.html> 共 25 个条目）**：
Claude Code、Codex CLI、opencode、Cursor、Gemini CLI、aider、Amp、Antigravity、Grok Build、Goose、Qwen Code、pi、omp、prime-agent、Cline、Kimi Code、OpenClaw、Copilot CLI、VS Code Copilot Chat、Roo Code、Continue、Crush、Hermes、**DeepSeek Harness**、Zed。

**是否支持 claude-mem 的 SQLite：❌ 不支持。** 已查证：registry 的 25 个条目全部是 **harness（编码 agent）**，不是记忆工具。其中读 SQLite 的条目是 opencode / Cursor / Goose / Crush / Hermes / Zed——都是各 agent 自己的会话库，**没有 `~/.claude-mem/claude-mem.db`**。（我另外直接 grep 了 deja README 全文，"claude-mem" 零命中。）

**但它读 DSH 自己的会话（已查证，registry `deepseek.html`）**：

- ID：`deepseek`
- Store：`${DSH_HOME:-~/.dsh}/sessions/<workspace-slug>/session-<uuid>/session.jsonl.zstd`，每会话一份追加日志
- 路径覆盖变量：`DEJA_DEEPSEEK_ROOT`（sessions 根）、`DSH_HOME`
- 格式：JSONL，默认连续 zstd 帧；raw lines 也可读（可配置）
- 前提：**需要 `zstd` CLI** —— 本机已有 v1.5.7 ✅
- 首行是 header：`{"type":"session","id":"session-<uuid>","createdAt":<ms>,"cwd":"…"}`，project 由 `cwd` 得出；其后每行一个事件 `{type, seq, time, data}`
- 参与召回的事件类型：`user/message`（仅 `data.source.kind == "user"`，即真人输入；插件注入的沙箱策略/技能目录不算）、`assistant/message`（只取 text，丢弃 reasoning）、`assistant/chunk`（仅作 `text-delta` 兜底，防中断）、`text-chunks`（≥3 连续 delta 的打包行）、`tool/result`（归入 tool-output role）、`session/title`
- 写入位置：本地 Go 二进制；索引在 `~/.cache/deja`

**对本机数据的适用性判断**：deja **能直接索引本机 400 个 DSH 会话 + 456 MB Claude Code 历史**，无需任何迁移动作、零 LLM 成本。但它给出的是**原始转录级召回**，不是 claude-mem 那 1594 条**已提炼的结构化结论**——粒度与语义层次不同。

### 2.3 其他能把外部记忆/会话导入 DSH 的插件（生态扫描）

我通过 `dsh memory plugin deepseek harness` 与 `claude-mem` 两组 GitHub 检索 + awesome-dsh-plugin 清单做了扫描。与本任务相关度较高的：

| 插件 | 星 | 存储 | 是否支持导入外部数据 | 是否需要 LLM |
|---|---|---|---|---|
| `@modusensus/dsh-mneme` | 92 | SQLite + Markdown 镜像 | ✅ **有 `POST /memories` HTTP API + CLI** | 默认不需要（巩固/抽取可关） |
| `Phant0Meow/dsh-meow-memory` | 87 | 每工作区 `.dsh-meow/memory.db`（node:sqlite） | ✅ 有 `memory_remember` 工具（需 agent 调用） | dream 整理用 LLM |
| `quqxui/dsh-memgas` | 16 | 未深查 | 未查到 | 未查到 |
| `justhalfbit/dsh-plugin-memory` | 13 | Markdown | 未查到 | 可选后台蒸馏 |
| `madage/dsh-self-improved` | 11 | L0→L1 分层 | 未查到 | 是 |
| `QIANLING-0831/dsh-memory-plus` | 7 | CJK 全文检索 | 未查到 | 未查到 |
| `tinqiao-oss/engramory` | 188 | 纯 Markdown，一事实一文件 | 未查到官方导入器 | 否（是"协议"而非插件） |
| `dsh-git-memory`（`seriousz158/dsh-memory`） | — | Git-backed | 未查到 | 未查到 |

**未查到任何**：以 claude-mem / `~/.claude-mem/claude-mem.db` 为输入源的 DSH 插件或迁移脚本。GitHub 上 `claude-mem` 相关仓库检索（total_count 17753）返回的是 thedotmack/claude-mem 本体与通用记忆库，没有 DSH 侧导入器。

> 说明：`YYTbit/dsh-plugin-claude-bridge`（描述含 "Bridge Claude Code memory, skills, and config into DeepSeek Harness"）经 GitHub API 查询返回空（仓库可能已改名/删除），**未查证成功**，不作为依据。

---

## 3. 路径 B：手工迁移

### 3.1 目标插件存储格式对比

| 插件 | 存储载体 | 导入接口 | 零 LLM 导入可行性 |
|---|---|---|---|
| **`@modusensus/dsh-mneme`** | SQLite（`node:sqlite`）+ Markdown 镜像（`preferences.md`/`projects.md`/`decisions.md`/`history.md`/`summary.md`，双向同步） | **`POST /memories`** + 零依赖 CLI `dsh-mneme add` | ✅ **最佳** — JSON API，字段少，无需 LLM |
| **`dsh-memory-porter`** | 追加式 JSONL（`~/.dsh/memory-porter/memories.jsonl` 等 3 文件） | 无导入 API；但 store 是"启动时装载重建内存态"的纯 JSONL | ✅ 可直接写 `memories.jsonl`（但类型枚举不匹配，见 §5.2） |
| `meow-memory` | 每工作区 `.dsh-meow/memory.db` | `memory_remember` 工具（agent 调用，必填 content/project/keywords/importance） | ⚠️ 需经 agent 逐条调用或直写 SQLite |
| `dsh-git-memory` | Git 仓库 | 未查到 | 未查到 |

**mneme 的 9 种记忆类型（已查证）**：`preference` 偏好 / `project` 项目 / `decision` 决策 / `history` 历史 / `summary` 会话总览 / `pattern` 模式 / `rejected_solution` 被否方案 / `pitfall` 踩坑 / `constraint` 约束。
（注：`user` / `fact` 两型在 v0.7.11 重写时已移除，早期文档仍提及，**不要按旧文档映射**。）

**mneme 的导入接口（已查证 README「外部访问」章节）**：
- 基础地址：`http://127.0.0.1:8790`（默认端口）
- 鉴权：除 `GET /health` 外均需 `Authorization: Bearer <token>`，无效 token 返回 `401 {"error":"unauthorized"}`
- `POST /memories`，body `{type, title, content, importance?, tags?, source?}`
- CLI：`dsh-mneme add --type <t> --title <s> --content <s> --importance <n> --tags a,b`
- 配置文件：`~/.dsh-mneme/cli.json`；env 可覆盖 `DSH_MNEME_URL` / `DSH_MNEME_TOKEN`

### 3.2 字段映射：`observations` → mneme `POST /memories`

| mneme 字段 | 来源 | 映射规则（**推测**，需实测微调） |
|---|---|---|
| `type` | `observations.type` | 见下表 |
| `title` | `observations.title` | 直取（已是一句话结论，最长实测 49,734/1594 ≈ 31 字符均值） |
| `content` | `subtitle` + `narrative` + `facts` | 拼装；建议 `narrative` 为正文，`facts` 另起一段，`subtitle` 作副标题 |
| `importance` | 由 `type` 派生 | 启发式：security_alert→5、decision→4、bugfix→4、feature→3、change→2、discovery→2、refactor→2、security_note→3、sensitive→4 |
| `tags` | `concepts`（需解析）+ `files_modified` 的 basename | `concepts` 实际存储形态未逐条确认，需先取样 |
| `source` | 固定串 | 建议 `claude-mem:sage:<memory_session_id>`，保留溯源 |

**type 映射（推测）**：

| claude-mem type | 行数 | → mneme type | 理由 |
|---|---|---|---|
| `decision` | 330 | `decision` | 同名 |
| `bugfix` | 200 | `pitfall` | 语义最接近"踩坑/修正" |
| `security_alert` | 55 | `constraint` | 约束类 |
| `security_note` | 15 | `constraint` | 约束类 |
| `discovery` | 555 | `history` 或 `pattern` | 发现类；`pattern` 更贴"可复用模式" |
| `change` | 238 | `history` | 变更记录 |
| `feature` | 196 | `project` | 项目进展 |
| `refactor` | 3 | `history` | 变更记录 |
| `sensitive` | 2 | `preference` | 实测样本是用户个人偏好（宠物信息） |

> `discovery` 占 555/1594（35%），是最大类，映射到 `history` 还是 `pattern` 会显著影响召回行为——建议先抽样 20 条人工确认。

### 3.3 字段映射：`observations` → memory-porter `memories.jsonl`

memory-porter 的 `MemoryItem`（已查证 `src/types.ts`，作者称"保真契约 v1"）：
`id, type, claim, evidence, context?, sources[], confidence, validFrom, validUntil, status, reviewDate, links[], contentHash, gateReason`

| MemoryItem 字段 | 来源 | 说明 |
|---|---|---|
| `id` | `observations.id` 派生（如 `claude-mem-<id>`） | 必须稳定，`decisions.jsonl` 靠它防复活 |
| `type` | claude-mem type | 注意是**中文枚举**：`方法论\|决策\|经验\|SOP\|认知\|反馈\|事实\|偏好\|关系` |
| `claim` | `title` | 一句话结论 |
| `evidence` | `narrative` | **硬闸门字段**，空则语义上应被拒收 |
| `context` | `subtitle` | 可选 |
| `sources[].source` | ⚠️ **无合适取值** | `SourceKind` 闭合：`claude-code\|claude-web\|claude-memory\|chatgpt`，**没有 claude-mem** |
| `sources[].convId` | `memory_session_id` | |
| `sources[].ts` | `created_at` | ISO 8601 |
| `confidence` | 需自定 | 复合置信度 0..1 |
| `validFrom` | `created_at` | |
| `validUntil` | `null` | 现行 |
| `status` | `待验证\|已应用\|已归档\|已失效` | |
| `reviewDate` | `validFrom` + 14 天 | |
| `links` | `[]` | |
| `contentHash` | `observations.content_hash` | 可直接复用，库内已有唯一索引 |
| `gateReason` | ⚠️ 必须是 7 个值之一 | `auto-confidence\|auto-multi-source\|human-ai-inferred\|human-high-impact\|human-conflict\|human-low-confidence\|human-user-choice` |

**两个摩擦点（已查证）**：
1. `SourceKind` 无 claude-mem 取值 → 只能借用 `claude-code`（语义不准确）。运行时 JSONL 读取不做类型校验，但面板展示可能失真。
2. `gateReason` 是 `Record<GateReason, string>` 查表 → 未知值会渲染成 `undefined`。必须从 7 个合法值里选（建议 `auto-confidence`）。

### 3.4 1594 条的注意事项

1. **不要逐条 realtime 调用 LLM。** 数据已是 LLM 压缩产物（`generated_by_model` 字段存在），再压缩是**二次蒸馏**：付钱 + 丢细节 + 引入新幻觉。
2. **去重**：库内 `ux_observations_session_hash`（session + content_hash）已有唯一性；跨目标库去重可直接用 `content_hash`。实测 `content_hash` 字段存在，建议导出时带上。
3. **分批**：mneme 的 `POST /memories` 是单条接口 → 1594 次 HTTP 调用。建议并发 ≤4、带重试退避，预计数分钟完成。memory-porter 的 `memories.jsonl` 是**追加式**，可一次写全量。
4. **幂等**：mneme 有 `saveWithDedupe`（服务层）；memory-porter 的 `decisions.jsonl` 会记住"已丢弃的 id"，**重复导入前先确认 `id` 稳定**，否则被丢弃的候选会复活。
5. **`text` 字段 1452/1594 为空** → 不要把它当正文；正文应取 `narrative`。
6. **仅 2 行 `narrative` 为空** → `evidence`/`content` 几乎不会因空值被拒。
7. **CJK 检索**：claude-mem/sage-mem 的卖点是中文 trigram 分词；换插件时**务必验证中文召回**（mneme 文档提到 FTS/BM25，meow-memory 用 bigram + 关键词；中文召回质量需实测，不要假设）。
8. **`sensitive` 类型仅 2 条**，但按 `AGENTS.md` 安全规则，导出/日志中不得落完整 key/secret；建议在导出脚本里加一次正则扫描（`sk-`、`api_key=`、`Bearer `、PEM 块），命中则打标不入库。

---

## 4. LLM 成本测算（DeepSeek 官方定价）

### 4.1 定价（已查证 <https://api-docs.deepseek.com/quick_start/pricing>，单位 USD / 1M tokens）

| | deepseek-flash（V4.1-Flash） | deepseek-v4-pro |
|---|---|---|
| 输入（cache hit）· 空闲 | $0.003 | $0.022 |
| 输入（cache hit）· 高峰 | $0.006 | $0.044 |
| 输入（cache miss）· 空闲 | **$0.15** | $0.66 |
| 输入（cache miss）· 高峰 | **$0.30** | $1.32 |
| 输出 · 空闲 | **$0.60** | $1.98 |
| 输出 · 高峰 | **$1.20** | $3.96 |

- **空闲价 = 高峰价的一半。高峰时段：UTC 周一至周五 01:00–04:00 与 06:00–10:00**，其余全为空闲。
- 注：V4 Pro 自 2026-09-14 12:00（北京时间）起请求全部路由到 V4.1 Flash 并按 Flash 计价，正在有序退役 → **实际按 flash 一列估算即可**。
- 汇率按 ≈7.1 CNY/USD 折算（近似值，仅供直觉参考）。

### 4.2 全量 1594 条过一次 LLM 的预估

输入量：766,866 字符 = 338,496 CJK + 428,370 非 CJK。
token 估算（CJK 按 1–1.3 token/字，非 CJK 按 ≈1 token/3.6 字符）：
- 保守高估 ≈ 420K–460K input tokens
- 乐观 ≈ 380K input tokens

输出量：1594 条 × ≈120–150 tokens ≈ **200K output tokens**。

| 方案 | 输入成本 | 输出成本 | **合计（USD）** | 折合人民币 |
|---|---|---|---|---|
| deepseek-flash · **空闲时段** | $0.063 | $0.12 | **≈ $0.18** | ≈ ¥1.3 |
| deepseek-flash · 高峰时段 | $0.126 | $0.24 | **≈ $0.37** | ≈ ¥2.6 |
| deepseek-v4-pro · 空闲（参考） | $0.277 | $0.396 | ≈ $0.67 | ≈ ¥4.8 |

**结论：即便把 1594 条全部重跑一遍 LLM，成本也在 $0.4 以内。成本不是这条路的瓶颈——信息损失和"二次蒸馏"才是。**

对照：memory-porter 作者实测 100 个 agentic 会话约 ¥2.5–¥5，与本估算同一量级，交叉验证成立。

> 参考：memory-porter 的 `/estimate` 端点会在跑之前先给预估，`/distill` 必须带 `confirm`。若走该路，先用 `/estimate`。

---

## 5. 推荐路径

### 5.1 推荐：**双轨，均零 LLM 成本**

**主轨 —— `dsh-deja`：不迁移，直接索引源材料（推荐首选）**

理由：
1. **零 LLM、零 API 成本、离线**（"No LLM, no embeddings" 多处查证）。
2. **约 89% 的 observation（1414/1594）其原始会话日志仍在 `~/.dsh/sessions/`**（实测，见 §1.3），deja 按 registry 规范直接读 DSH 会话日志，**不需要任何导出/转换/导入动作**。
3. **顺带覆盖 456 MB 的 `~/.claude/projects` Claude Code 历史**——那是 memory-porter 卖点里"账号没了记忆还在"的同一批数据。**这一条对 `claude-migrate-*` 那 142 条尤其重要**：它们本就是从 Claude Code 侧迁进来的，很可能在 `~/.claude/projects` 里能找到原始会话。
4. **前提已满足**：`zstd` v1.5.7 在位（deja 读 DSH 会话的硬前提）。
5. 成本敏感场景下，**唯一一个成本严格为 0 且召回质量有 benchmark 支撑的方案**（作者公开 `deja bench recall/context/block`，并给出 1,551 会话 / 143k 消息真实库上 ~0.4 ms 查询、索引 160 MB ≈ 语料 3%）。
6. 与 DSH 集成是官方一等公民：npm `dsh-deja@0.20.6`，`dsh plugin --profile web add dsh-deja`。
7. **它不依赖那条已经坏掉的 sage-mem 链路**（§1.5）——即使 worker 的 401 一直不修，deja 也能照常工作。

**副轨 —— `@modusensus/dsh-mneme`：把 1594 条策展结论机械导入（补 deja 覆盖不到的部分）**

理由：
1. **有原生 HTTP JSON 导入接口**（`POST /memories`）与 CLI，字段少，**完全不需要 LLM**。
2. 是**真正的记忆插件**（注入/召回/巩固），而 deja 是会话检索层——两者互补而非竞争。
3. 默认零网络依赖、无 API key、Markdown 镜像可人工校对，符合本机"人类可读可编辑"的记忆纪律。
4. 覆盖 deja 覆盖不到的：**142 条 `claude-migrate-*` 合成会话来源的 observation** + **35 条源日志已不在磁盘上的 observation**，以及 claude-mem 独有的**结构化结论层**（deja 只有原始转录，没有 `type`/`facts`/`narrative` 这层提炼）。

**不推荐作为主路径的两条**：

- **`dsh-memory-porter`**：它的 4 个连接器都读不到 claude-mem 的 SQLite（已查证源码）；把已蒸馏的 observation 再喂进它的提纯层是二次蒸馏（付钱 + 丢细节）；`SourceKind` 无 claude-mem 取值。→ 但它的 **JSONL store 可直接手写**，若用户已装它，可作为**零 LLM 备选**（需容忍枚举借位）。
- **全量 LLM 重跑**：成本虽低（≤$0.4），但对**已压缩数据**做二次压缩，收益为负。

### 5.2 与 sage-mem 的并存问题（重要）

`sage-mem` 已在 `web` profile 的 bundles 里，它会在**每个 `turn/end`** 向 worker 写 observation、并在 `agent/session-start` **同步注入**记忆上下文。若同时再装 mneme/meow-memory：

- **会出现两套记忆各自注入**，token 成本翻倍且可能互相矛盾。
- 建议：新插件上线后**二选一**——要么从 bundles 移除 `sage-mem`（`dsh plugin --profile web remove sage-mem`），要么保留 sage-mem 但关闭新插件的自动注入、只当"历史归档检索"用。
- 本次调研**未改动** profile（`~/.dsh/profiles/web/package.json` 保持原样）。

> 说明：`dsh plugin` 是 pnpm 的透传包装（实测 `dsh plugin --help` 输出 pnpm 帮助），因此 `add` / `remove` / `list` 均为 pnpm 语义。

### 5.3 动手前先做这一步：快照备份

**该 DB 是活库**（§1.5），worker 仍会被 DSH 会话触发写入。迁移/导出**之前**先做一致性快照，避免读到半写状态：

```bash
# SQLite 在线安全备份（会把 WAL 一并合并进副本，不锁库、不改原文件）
sqlite3 "$HOME/.claude-mem/claude-mem.db" ".backup '/path/to/claude-mem-snapshot-$(date +%Y%m%d).db'"
sqlite3 "/path/to/claude-mem-snapshot-$(date +%Y%m%d).db" "pragma quick_check;"   # 期望 ok
```

之后的导出脚本一律针对**快照**跑，彻底与活库解耦。

> ⚠️ `.backup` 会以读写方式打开原库（这是 SQLite 官方推荐的在线备份方式）。若坚持绝对只读，可改用 `sqlite3 "file:...?mode=ro&immutable=1" .dump > dump.sql` —— 但 `immutable=1` 要求库确实不再被写入，**在活库上可能读到不一致数据**，因此**推荐用 `.backup`**。

---

## 6. 具体命令 / 脚本思路

### 6.1 主轨：deja（3 步，零成本）

```bash
# 1) 装二进制 + 装 DSH 插件
curl -fsSL https://raw.githubusercontent.com/vshulcz/deja-vu/main/install.sh | sh
dsh plugin --profile web add dsh-deja

# 2) 冷建索引（读 ~/.dsh/sessions + ~/.claude/projects；需 zstd，已在位）
deja index            # 首次较慢；之后增量，仅重读变化文件
deja stats            # 看索引规模 / 命中会话数

# 3) 验证召回（试着查一个 8 月中的 DSH 插件开发结论）
deja "sage-mem 中文 trigram"
deja last             # 列各 agent 最近会话
```

**验收要点（重要）**：本机 DSH 会话有两种目录布局（§1.3），`deja stats` 报告的会话数应**接近 553**。若只报 ~400，说明裸 UUID 布局（153 个会话）未被识别，需要给 deja 提 issue 或临时用软链补齐：

```bash
# 仅在确认漏读时才做：为裸 UUID 会话建 session-<uuid> 软链（不改原文件）
# 建议先只对一个 slug 试验，确认 deja 能读后再全量
```

> 排障：若 `deja index` 报"找不到可读会话"，先确认 `zstd` 在 PATH；`DEJA_DEEPSEEK_ROOT` 可覆盖 sessions 根，`DSH_HOME` 也被识别。

### 6.2 副轨：observations → mneme（零 LLM）

**步骤 1 — 只读导出为 JSONL**（不碰原库；`mode=ro` + `immutable=1` 双保险，避免动 WAL）：

```bash
sqlite3 "file:$HOME/.claude-mem/claude-mem.db?mode=ro&immutable=1" \
  -json "SELECT id, memory_session_id, project, type, title, subtitle,
                narrative, facts, concepts, files_modified,
                created_at, content_hash
         FROM observations ORDER BY id;" > /tmp/observations.json
```

**步骤 2 — 转换 + 推送**（Python 思路，非最终代码）：

```python
# 伪代码：type 映射见 §3.2
TYPE_MAP = {
  'decision':'decision', 'bugfix':'pitfall',
  'security_alert':'constraint', 'security_note':'constraint',
  'discovery':'pattern', 'change':'history', 'feature':'project',
  'refactor':'history', 'sensitive':'preference',
}
IMPORTANCE = {'security_alert':5,'decision':4,'bugfix':4,'sensitive':4,
              'security_note':3,'feature':3,'change':2,'discovery':2,'refactor':2}

for o in observations:
    body = {
      "type": TYPE_MAP[o["type"]],
      "title": o["title"] or (o["narrative"] or "")[:60],
      "content": "\n\n".join(x for x in [o["subtitle"], o["narrative"], o["facts"]] if x),
      "importance": IMPORTANCE[o["type"]],
      "tags": parse_concepts(o["concepts"]) + basenames(o["files_modified"]),
      "source": f'claude-mem:sage:{o["memory_session_id"]}',
    }
    # 关键：content 为空则跳过（memory-porter 的 evidence 闸门同理）
    POST http://127.0.0.1:8790/memories   (Authorization: Bearer $DSH_MNEME_TOKEN)
```

要点：
- 并发 ≤4，指数退避重试；1594 条单条 POST，预计数分钟。
- 先拿 token：插件面板「设置 → 外部访问」；或 `DSH_MNEME_TOKEN` 环境变量。
- 先跑 `GET /health`、`GET /status` 确认服务在。
- **建议先 dry-run 20 条**，用 `GET /search?q=...` 验证中文召回质量，再全量。

**步骤 3 — 校验**

```bash
curl -s -H "Authorization: Bearer $DSH_MNEME_TOKEN" http://127.0.0.1:8790/status
curl -s -H "Authorization: Bearer $DSH_MNEME_TOKEN" \
  "http://127.0.0.1:8790/search?q=DMRG&mode=keyword&topK=5"
```

### 6.3 备选：直接写 memory-porter 的 `memories.jsonl`（零 LLM，有取舍）

若用户已装/更偏好 memory-porter，可绕过它的 LLM 提纯层，直接落盘：

```bash
mkdir -p ~/.dsh/memory-porter
# 每条 observation 生成一行 MemoryItem JSON，追加进 memories.jsonl
# 字段映射见 §3.3；gateReason 用 'auto-confidence'；sources[].source 借用 'claude-code'
```

取舍：**零 token 成本**，但 `SourceKind` 与 `gateReason` 都是闭合枚举，需借位，语义不精确；且绕过了它的"逐字证据闸门"设计意图。

### 6.4 一个未被验证的设想（推测，标注清楚）

**把 observations 合成为 DSH 会话日志，喂给 deja。** deja 的 DSH 格式是公开的（header + `{type,seq,time,data}` 事件），理论上可以生成一份合成的 `session.jsonl.zstd`，把 1594 条 observation 渲染成 `user/message`（`data.source.kind == "user"`）事件，再用 `DEJA_DEEPSEEK_ROOT` 指向该目录，让 deja 索引它们。

- 好处：让 deja 也覆盖 claude-mem 的结构化结论层，**零 LLM**。
- ⚠️ **我没有实测过**，也不确定 deja 会不会因 header 的 `cwd`/`createdAt` 字段缺失而拒绝、或与真实会话混淆。**若采用，务必先在隔离目录 + `DEJA_DEEPSEEK_ROOT` 下做小样本试验**，不要污染 `~/.dsh/sessions`。

---

## 7. 未查到 / 存疑项（禁止编造，如实列出）

1. **deja 是否会因合成会话文件报错** —— 未实测，见 §6.4。
2. **mneme 的 `POST /memories` 是否对 `type` 做严格枚举校验、是否会因未知 type 返回 4xx** —— README 未说明校验行为，未实测。
3. **mneme / meow-memory 的中文召回实测质量** —— 二者都未像 sage-mem 那样明示 trigram 方案，**未实测**，不建议假设等价。
4. **`observations.concepts` 的实际存储形态（JSON 数组？逗号分隔？）** —— 本次只统计了长度，未逐条取样确认，影响 `tags` 映射。
5. **`YYTbit/dsh-plugin-claude-bridge`**（描述称 bridge Claude Code memory into DSH）—— GitHub API 返回空对象，**未查证成功**，不作为依据。
6. **`dsh-memgas`、`dsh-plugin-memory`、`dsh-git-memory`、`engramory` 是否有导入接口** —— 仅看了清单描述，**未逐一查证**。
7. **官方 discussions #2819 原文** —— 未直接读取（github.com 在本机 web_fetch 被解析到非公网 IP 而失败，改用 firecrawl 抓取了 memory-porter 仓库本身；#2819 讨论串正文未取到）。
8. **memory-porter 的 `memories.jsonl` 手写导入是否会被插件在下次启动时接受/校验** —— `store.load()` 只做 JSON 解析与 `decisions` 过滤（已读源码），**未见 schema 校验**，但未跑起来实测。
9. **35 条 UUID 存在但日志已不在磁盘的 observation** —— 未逐条排查原因（可能是 30 天清理、跨工作区、或会话被删）。另有 142 条来自 `claude-migrate-*` 合成会话，**这些不在 DSH 会话体系内**，deja 的 DSH 路径覆盖不到。
10. **deja 是否识别裸 UUID 布局的 DSH 会话目录（153 个）** —— deja 的 registry 只描述了 `session-<uuid>` 一种布局，而本机 553 个会话里有 153 个是裸 UUID 目录。**未实测**（deja 未安装）。这是安装后第一件要验收的事。
11. **sage-mem worker 的 401 是否会自愈 / `.env` 里的 key 是否真的失效** —— 只从日志确认了 401 现象，**未检查也未修改**用户的凭据配置。
12. **`sdk_sessions` 为何在调研期间减少 2 行、`user_prompts` 减少 3 行** —— 日志未显示删除动作，推测与 worker 会话清理/合并有关（存在 `merged_into_project` 字段），**未确证**。
13. **`mcp__firecrawl__*` 抓取到的 star 数与会话中提到的数字不一致** —— 任务描述称 deja-vu ⭐712，实测页面为 **⭐797**；memory-porter ⭐2。以实测为准。

---

## 8. 查证过的 URL 清单

**目标/来源工具**
- memory-porter 仓库 — <https://github.com/Shiye-10Pages/dsh-memory-porter>
- deja-vu 仓库 — <https://github.com/vshulcz/deja-vu>
- deja-vu 会话格式 registry（25 条，含 DSH）— <https://vshulcz.github.io/deja-vu/registry/README.html>
- deja-vu DSH 格式页 — <https://vshulcz.github.io/deja-vu/registry/deepseek.html>
- deja-vu DSH 指南 — <https://vshulcz.github.io/deja-vu/guide/memory-for-dsh.html>
- DSH 会话存储位置指南 — <https://vshulcz.github.io/deja-vu/guide/where-sessions-are-stored.html>
- dsh-mneme 仓库 — <https://github.com/modusensus/dsh-mneme>
- dsh-mneme 完整文档 — <https://raw.githubusercontent.com/modusensus/dsh-mneme/main/dsh-mneme/README.md>
- meow-memory 仓库 — <https://github.com/Phant0Meow/dsh-meow-memory>
- engramory 仓库 — <https://github.com/tinqiao-oss/engramory>
- dsh-git-memory（seriousz158/dsh-memory）— <https://github.com/seriousz158/dsh-memory>
- awesome-dsh-plugin 清单 — <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>
- claude-mem 本体 — <https://github.com/thedotmack/claude-mem>
- sage-mem — <https://github.com/gezi-wen/sage-mem>

**源码（用于确认能力边界）**
- `src/connectors/`（4 个连接器）— <https://github.com/Shiye-10Pages/dsh-memory-porter/tree/main/src/connectors>
- `src/types.ts`（保真契约 v1 / SourceKind / MemoryType / MemoryItem）— <https://raw.githubusercontent.com/Shiye-10Pages/dsh-memory-porter/main/src/types.ts>
- `src/store.ts`（JSONL 三文件存储）— <https://raw.githubusercontent.com/Shiye-10Pages/dsh-memory-porter/main/src/store.ts>
- `src/gate.ts`（7 个 GateReason）— <https://raw.githubusercontent.com/Shiye-10Pages/dsh-memory-porter/main/src/gate.ts>

**npm 包（版本已查证）**
- `dsh-deja@0.20.6` — <https://www.npmjs.com/package/dsh-deja>
- `dsh-memory-porter@0.1.0` — <https://www.npmjs.com/package/dsh-memory-porter>
- `@modusensus/dsh-mneme` — <https://www.npmjs.com/package/@modusensus/dsh-mneme>
- `meow-memory@0.24.2` — <https://www.npmjs.com/package/meow-memory>
- `dsh-git-memory@0.8.1` — <https://www.npmjs.com/package/dsh-git-memory>

**定价**
- DeepSeek 官方 Models & Pricing — <https://api-docs.deepseek.com/quick_start/pricing>

**本机路径（只读查证）**
- `~/.claude-mem/claude-mem.db`（45,551,616 B，mtime 2026-09-10 16:45:01，`quick_check` ok）
- `~/.claude-mem/supervisor.json`（worker pid 3666 / port 37700）、`~/.claude-mem/worker.pid`
- `~/.claude-mem/logs/claude-mem-2026-09-02.log`（mtime 2026-09-10 16:54，含 401 auth error）
- `~/Workspace/dsh-plugin/third-party/sage-mem/lib/index.js`（140 行桥接插件）
- `~/.dsh/profiles/web/package.json`（sage-mem 在 deps + bundles）
- `~/.dsh/sessions/`（**553** 个 `session.jsonl.zstd`：400 个 `session-<uuid>/` + 153 个裸 `<uuid>/`；合计 396 MB）
- `~/.claude/projects/`（456 MB）
