# DSH 记忆方案选型决策文档

> 生成时间：2026-09-10
> 依据：四路独立调研（源码级核实 + 官方评测 + npm/GitHub API 实测）
> 状态：sage-mem 已停用；本机自动捕获层当前为空缺

---

## 0. 先更正一个错误（重要）

本次调研过程中，我一度判断「sage-mem 每次新会话自动注入 6293 字符陈旧记忆并伪装成 recent context」，并据此建议"紧急止血"。**该判断是错的。**

读 `~/Workspace/sage-mem/lib/index.js`（实为 166 行，非我先前所记的 140 行）第 9–12 行，源码注释明确写明：

> 记忆注入改为显式 `/mem` 命令（2026-08-18 设计变更）：不再在会话启动时自动注入——避免在纯提示词会话（如 router-standard RL 首轮）下记忆块被误当作任务、反客为主。

核实结论：
- 全文件仅有两处 `inject()` 调用（105、113 行），**都在 `/mem` 命令的 handler 内部**。
- **不存在** `session/start`、`pre-step`、`systemPrompt` 等自动注入路径。
- 那 6293 字符只有在用户主动输入 `/mem`（或 `/mem <关键词>`）时才会进入上下文，**不产生每会话固定成本**。

错误根因：我调用了 worker 的 `/api/context/inject` 端点、看到它返回带「recent context」标头的陈旧内容，就推断"它在自动注入"——**只验证了后端能力，没有核对插件实际接线**。这是把"端点可用"当成了"调用发生"。

**由此更正两点**：
1. 陈旧记忆没有在污染你的会话（除非你主动敲 `/mem`）。
2. 摘除 sage-mem 的收益是"停止 401 报错刷屏"和"避免与新插件双写"，**不是"止损 token"**。

---

## 1. 你当前的真实记忆资产

| 系统 | 位置 | 内容量 | 性质 | 状态 |
|---|---|---|---|---|
| 手写记忆库 | `~/.claude-memory/` | **102 个 md**（65 feedback / 29 project / 3 user / 2 reference / 1 meta）+ `MEMORY.md` 索引 | 人工策展，Claude Code 风格 | ✅ 健康 |
| 分层账本 | `~/.agent-memory/` | canonical 8 + staging 10 | **人工 approve 才进主账本** | ✅ 健康 |
| 自动捕获 | `~/.claude-mem/claude-mem.db` | **1594 observations** / 2790 prompts / 757 summaries | LLM 压缩，全自动 | ❌ 8/19 起断更 |

**核心判断：你的"策展层"是健康的，坏掉的只是"自动捕获层"。**

这一点决定了整个选型逻辑——你要补的是一个**自动捕获 + 检索**的通道，而不是再建一套记忆体系。

### 1.1 值得注意的发现：89% 的记忆不需要"迁移"

`memory_session_id` 形如 `openrouter-<uuid>-<ts>`，中段即 DSH session UUID。实测：

| 指标 | 数量 | 占比 |
|---|---|---|
| observation 总数 | 1594 | 100% |
| 可提取 DSH UUID | 1449 | 90.9% |
| **且源会话日志仍在 `~/.dsh/sessions/`** | **1414** | **88.7%** |
| `claude-migrate-*` 合成会话（覆盖不到） | 142 | 8.9% |
| UUID 存在但日志已删 | 35 | 2.2% |

**近 89% 的历史记忆，原始素材仍在磁盘上。**「召回过去」这个目标对绝大多数内容**不经迁移即可达成**，缺的只是一个索引器。

### 1.2 数据安全提示

`~/.claude-mem/claude-mem.db` 是**活库**（worker 仍会写入 `user_prompts`）。任何导出/迁移前先做快照：

```bash
sqlite3 ~/.claude-mem/claude-mem.db ".backup '$HOME/claude-mem-snapshot-$(date +%Y%m%d).db'"
```

之后一律对快照操作，查询用只读模式：
```bash
sqlite3 "file:$HOME/.claude-mem/claude-mem.db?mode=ro&immutable=1" "SELECT ..."
```

---

## 2. 候选横向对比

中文检索能力是本表的核心维度——**这正是你当初 fork claude-mem 的原因**（SQLite FTS5 默认分词器对中文 0 命中）。

| 插件 | 中文检索方案 | 首次下载 | 常驻服务 | 需 API key | md 可手改 | 自动注入 | 版本 | ⭐ |
|---|---|---|---|---|---|---|---|---|
| **memsearch** | ONNX **bge-m3 int8**，官方评测 **zh R@5 0.776**（优于 OpenAI small 的 0.717） | 558 MB | 无（Milvus Lite 单文件） | 否 | ✅ 真值源 | ✅ 按需，无命中则零成本 | 0.1.4 | 2.5k |
| **dsh-mneme** | **`Xenova/bge-small-zh-v1.5`**（中文专用）512 维 q8 | **~23 MB** | 无 | 否（默认需改） | ✅ md 镜像 | ✅ 首轮摘要注入 | 0.7.29 | 46 |
| **meow-memory** | BM25 + CJK 相邻 bigram，无向量 | 0 | 无 | 否 | ❌ 仅 SQLite | ✅ 首轮快照 + 每消息命中 | 0.24.2 | 43 |
| **dsh-engramory** | 无检索引擎（模型主动 read） | 0 | 无 | 否 | ✅ 纯 md | ❌ 需模型自己读 | 0.2.3 | 174 |
| **dsh-deja** | Go 词法索引（BM25），无 LLM 无嵌入 | 0 | 无 | 否 | 非记忆存储 | ✅ 可选 per-step 召回 | 0.20.6 | 797 |
| dsh-agent-memory | 中文 bigram + 单字兜底 + BM25 | 0 | 无 | 否 | ✅ JSON | ✅ pre-step top-3 | 0.8.4 | 6 |

### 2.1 已核实的坑（源码级）

**dsh-mneme**
- ⚠️ `embedProvider` 默认值是 **`"openai"`**（`lib/config.js:119`），且出厂 `cordis.patch.yml` 未覆盖该项 → **开箱即用时语义检索走外部端点，不是本地**。要本地必须显式配 `embedProvider: local`。
- ⚠️ 依赖 `@huggingface/transformers` 会拉 `onnxruntime-node`（**解包 210 MB**，带 postinstall），**即使永不开本地 embedding 也照装**。
- ⚠️ 文档称模型「量化约 100MB」，HF API 实测 `model_quantized.onnx` = **24,010,842 bytes ≈ 22.9 MiB**，文档不符（实际更小，是好事）。
- · 文档提到 `embedModelMirror` 默认 `hf-mirror.com`，但全量 grep **找不到消费该字段的代码**，疑似未生效。
- ✅ 有原生 `POST /memories` HTTP API（默认端口 8790，Bearer 鉴权）→ 可机械导入那 1594 条，**零 LLM 成本**。
- ✅ 中文检索有测试断言：`tokenize("异步编程")` → `["异步","步编","编程"]`。

**memsearch**
- ⚠️ 必须把 `summarizeMode` 从默认 `auto` 改成 `custom-llm`，否则会起 `dsh --profile headless` 子代理（吃你的 key）。配置 `[plugins.dsh.summarize] provider`。
- ✅ Milvus Lite 确认纯本地单文件（`~/.memsearch/milvus.db`），依赖仅 `faiss-cpu` + `numpy` + `grpcio` + `pyarrow`，**无 Docker、无守护进程**。
- ✅ Markdown 是真相源，Milvus 只是可重建的影子索引。
- ✅ 跨 agent 共享：同一份 `.memsearch/memory/` 可被 Claude Code / Codex / DSH / OpenClaw / OpenCode 共用——**你同时用 Claude Code，这条价值较高**。
- ⚠️ 需引入 Python 工具链（`uv tool install "memsearch[onnx]"`）。你机器上 Python 3.13 + uv 均已在位，磁盘余 62 GB。
- · BM25 侧的 Milvus analyzer 配置**未查到**是否有中文处理；中文能力主要靠 bge-m3 的向量检索支撑。

**dsh-git-memory —— 直接排除**
- README 原文：*"macOS is the supported/tested integration target"*；硬编码 `/usr/bin/git`、Homebrew 路径、LaunchAgent 调度、`/Users/` 正则。WSL2 上不可用。
- 讽刺的是它的**中文检索方案是全部候选里最正确的**：FTS5 `tokenize='trigram'`（对 CJK 无需词典）+ 自算 character-bigram。

**OpenViking —— 冲突最大**
- 需自建 Python 服务（`pip install openviking`，:1933）+ **Embedding 与 VLM 两套模型**；provider 列表中**无 DeepSeek**。
- 注入最重：profile 10k token/会话 + recall 2k token/步。
- ⚠️ license 口径冲突：npm 元数据与 awesome 列表写 Apache-2.0，**仓库根是 AGPL-3.0，且包内无 LICENSE 文件**。
- ⚠️ 官方 discussion #1436 的「91.7% fact recall」属于同作者**另一个仓库**（`zouyuanqing/dsh-memory-openviking`），不是已发布的 `@openviking/dsh-memory-plugin` 0.3.0。

**ReMe —— 需改造**
- npm 插件只是 HTTP 客户端，**必须常驻 Python 服务**（`reme start`，:2333）。
- ✅ 已内置 `deepseek` provider，适合只有 DeepSeek key 的场景。
- ⚠️ **默认分词器是 `regex`（中文字符逐字成 token）**，jieba 实现存在但需手动改配置——中文召回的最大隐患。
- ✅ 注入最轻：会话开始一条几行指引 + 模型按需 `reme_search`。

**dsh-agent-memory**
- ❌ `package.json` **缺 `dsh.bundle`**，不能 `dsh plugin add`。
- ❌ 6★ / 0 fork / **0 issue** / 已停更（v0.8.4 后无提交）；第三方实机验证在 linux-x64 + rc.6 记录为 `PLUGIN_SMOKE_FAILED`。
- ⚠️ 已有自建文件型记忆系统者注意：它有 `mtimeMs:size` 指纹防护，外部修改会**直接拒写**抛 `MEMORY_EXTERNAL_MODIFIED`——**两者绝不能写同一个文件**。
- 💡 建议只当**源码参考**，抄走它的治理设计：指纹防护、Jaccard 合并保留旧 TTL、`importance=3` 淘汰豁免、按码点截断、注入重复抑制。

**meow-memory**
- ✅ 中文最稳：默认语言 `zh`，CJK 相邻 bigram + NFKC 归一，缓存友好（静态 section 放 system prompt，不破坏 KV 缓存）。
- ❌ **记忆只存 SQLite（`.dsh-meow/memory.db`），无 Markdown 手改路径** → 与你「人类可读可编辑」的纪律冲突。

**dsh-engramory**
- ✅ 最贴合「纯本地 + 纯 md + 零成本」：一个文件一条事实 + 每次会话加载的小索引，无数据库/向量/服务器/LLM/daemon，npm 包仅 40 KB。
- ✅ 唯一在 DSH 上把索引上限做成**确定性拒绝**的（用 `ctx.tools.guard()` 同步否决），而非"请求模型遵守"。
- ⚠️ 代价：`MEMORY.md` **不自动注入**，需模型主动 read；工具数为 0；插件**不建库**，还需跑 `engramory_init.py`。
- ⚠️ 索引 200 行 / 25 KB 封顶（≈8533 汉字），对你 102 个文件的规模**偏紧**。

---

## 3. 三条可选路线

### 路线 A：只恢复"历史可检索"，不引入新记忆体系（零成本）

装 `dsh-deja`，直接索引源材料，**不做任何迁移**。

```bash
curl -fsSL https://raw.githubusercontent.com/vshulcz/deja-vu/main/install.sh | sh
dsh plugin --profile web add dsh-deja
deja index && deja stats
```

- ✅ 零 LLM、零 API 成本、完全离线（"No LLM, no embeddings" 多处确认）
- ✅ 覆盖 89% observation 的源日志 + 456 MB 的 `~/.claude/projects` Claude Code 历史
- ✅ 前提 `zstd` 已满足（v1.5.7 在位）
- ⚠️ **第一验收项**：本机 DSH 会话并存两种布局——400 个 `session-<uuid>/` + **153 个裸 `<uuid>/`**，而 deja 的 registry 只描述了前者。`deja stats` 报告的会话数应接近 **553**；若仅 ~400 说明漏读。
- ⚠️ 它给的是**原始转录级召回**，不是 claude-mem 那 1594 条**已提炼的结构化结论**——粒度不同。

**适合**：想低成本拿回历史检索、暂不想再引入一套自动记忆体系。

### 路线 B：引入 memsearch 作为新的自动捕获层

- ✅ 唯一「默认零 key 零费用」的重型方案；中文检索有官方评测背书（zh R@5 0.776）
- ✅ 与 Claude Code 共用一份记忆——**你同时用两者，这条是独特价值**
- ✅ Markdown 真值源 + 可重建影子索引，理念贴近你现有纪律
- ⚠️ 代价：引入 Python/uv 工具链 + 首次 558 MB 模型下载；**必须**改 `summarizeMode` 为 `custom-llm`

**适合**：想要"自动捕获 + 中文语义检索 + 跨 agent 共享"，且接受 Python 依赖。

### 路线 C：引入 dsh-mneme 作为新的自动捕获层

- ✅ 中文专用小模型（~23 MB），磁盘代价最小
- ✅ Markdown 镜像 + 人类可读，契合你的记忆纪律
- ✅ 有 `POST /memories` 可**零 LLM 导入**那 1594 条
- ⚠️ **必须**改 `embedProvider: local`，否则默认走外部端点
- ⚠️ 无论如何都要吃 210 MB 的 `onnxruntime-node`
- ⚠️ 46★、单一作者，bus factor 风险较高

**适合**：偏好轻量本地中文模型、且看重 Markdown 可读性。

---

## 4. 推荐

**分两步，先零成本、再按需加重。**

**第一步（建议先做）：路线 A —`dsh-deja`**

理由：你现在缺的是"历史检索"，而这 89% 的素材已在磁盘上，deja 零成本直达；它**不依赖**那条已坏的 sage-mem 链路，也不与任何后续选择冲突。

**第二步（想要自动捕获时再上）：路线 B —`memsearch`**

理由：在你的约束组合下（中文 + 只有 DeepSeek key + 成本敏感 + 偏好本地 + 同时用 Claude Code），memsearch 的结构性优势最大——它是唯一同时满足"零 key 默认、中文有评测、跨 agent 共享、Markdown 真值源"的方案。代价（Python 工具链 + 558 MB）是一次性的。

**不建议**：
- **meow-memory**：无 Markdown 手改路径，与你的纪律冲突。
- **dsh-git-memory**：macOS 专属，WSL2 不可用。
- **OpenViking**：要两套模型且无 DeepSeek provider，成本与复杂度都最高，license 口径还有疑点。
- **全量 LLM 重跑那 1594 条**：成本虽极低（DeepSeek 空闲时段 ≈ $0.18，实测载荷约 380K–460K input tokens），但对**已压缩数据做二次蒸馏**是负收益。

---

## 5. 一个需要你先决策的前置问题

你已经有 `~/.claude-memory/`（102 个手写 md）和 `~/.agent-memory/`（canonical/staging + 人工 approve）。

**上面任何一个插件都不会读你的 `~/.claude-memory/`，也没有一个内建等价的"人工 approve 才进主账本"门**（`dsh-memory-evolve` 的 `SUGGESTIONS.jsonl` + `/memory_review approve` 最接近，但管的是它自己的 `MEMORY.md`）。

所以在动手前需要定清楚：

| 关系 | 建议 |
|---|---|
| 新插件 vs `~/.claude-memory/` 手写库 | **保持独立**。手写库是人工策展的高信噪比层，插件产出的是自动捕获的低信噪比层，两者定位不同，硬合并会稀释手写库质量。 |
| 新插件 vs `~/.agent-memory/` | **保持独立**。后者的价值在"人工 approve"这道门，插件无法替代。 |
| 新插件的产出是否需要回流到策展层 | 建议**定期人工挑选**：自动捕获层里反复出现的稳定结论，手动提升进 `~/.claude-memory/`。这与 `~/.agent-memory/` 的 staging→canonical 是同一套思路。 |

**装任何插件都会形成"两套并行记忆"——这不是问题，前提是你明确它们各自的分工。**

---

## 6. 当前状态与回滚方式

### 6.0 最终采用：deja + memsearch 双轨（2026-09-10 实测落地）

原推荐的"路线 A（deja）"与"路线 B（memsearch）"**已同时装上并验证**。二者分工不重叠：

| | dsh-deja | @zilliz/memsearch-dsh |
|---|---|---|
| 管什么 | **已有历史** | **新对话** |
| 检索方式 | 词法 BM25（Go 本地索引） | 向量 bge-m3 int8（Milvus Lite） |
| 是否写入 | ❌ 不写入任何内容 | ✅ 写 `<project>/.memsearch/memory/*.md` |
| LLM 依赖 | 无 | DeepSeek（摘要用，`deepseek-flash`） |
| 索引规模 | 1380 会话 / 107,626 消息 | 按项目增量 |
| 磁盘占用 | 205 MB | 模型 560 MB + Milvus 24 KB |

**实测验收结果**：

| 项 | 结果 |
|---|---|
| deja 识别 DSH 会话 | ✅ `deepseek: 567 files, 558 indexed sessions` —— **裸 UUID 布局未漏读**（此前列为唯一未验证点） |
| deja 建索引耗时 | 39 秒（1.06 GB 语料，1380 会话） |
| deja 中文召回 | ✅ 查「初中物理 机械效率」精准命中 8/24 断更期会话 |
| memsearch 中文**语义**检索 | ✅ 查「我不喜欢花钱」命中「成本敏感」（**字面零重叠**）—— 词法检索做不到 |
| memsearch 摘要链路 | ✅ DeepSeek 直连成功，中文摘要正常 |

**安装中解决的三个真实故障**（均非插件本身缺陷）：

1. **`no_proxy` 里的 `[::1]` 导致 httpx 崩溃**。方括号 IPv6 字面量被 httpx 的 URL 解析器读成主机 `[` + 端口 `:1]`，抛 `InvalidURL: Invalid port: ':1]'`，**在发出任何请求前就失败**。修法：在 `third-party/dsh-memsearch/index.js` 加了 `cleanEnv()` 助手，统一净化所有 5 处子进程 env（去掉 IPv6 方括号）。上游文件哈希存于 `.upstream-sha256`。
2. **DeepSeek key 无法到达子进程**。memsearch 的 `env:VAR` 只从 `os.environ` 解析，而 DSH 把密钥放在 `~/.dsh/.credentials.yaml` 且不导出到环境。修法：同一个 `cleanEnv()` 里按需从凭据库读取 `DEEPSEEK_API_KEY` **注入子进程环境**——**key 不落任何配置文件明文**（`config.toml` 里存的是 `env:DEEPSEEK_API_KEY` 引用）。
3. **默认 embedding 是 `openai`**，无 key 直接崩。已改为 `embedding.provider = onnx`（本地 bge-m3）。

**顺带发现**：DSH 凭据库里的 `DEEPSEEK_API_KEY`（`sk-e11...`）**是有效的**，与 sage-mem 那个失效的 `sk-bc7...` 不是同一个。sage-mem 当初其实可以修好——但既然已选定新方案，未再回填。

**其他改动**：`.gitignore` 新增 `.memsearch/memory/` 等条目（原始对话沉淀含本机细节，不应进仓库；`skill-candidates/` 按官方设计保持可跟踪）。

**双重注入评估**：deja 上限 1536 B/次（实测 1.4–2.2 KB），memsearch 约 0.9 KB，最坏合计 ~3 KB/轮；**两者都是"无命中则不注入"**，实际成本远低于此。

---

### 6.1 更早的改动（同日）：sage-mem 停用

**已完成（2026-09-10）**：sage-mem 已停用，热生效无需重启。

| 改动 | 位置 | 内容 |
|---|---|---|
| patch 禁用条 | `~/.dsh/profiles/web/cordis.patch.yml` | `- id: sage-mem` / `disabled: true` |
| bundles 移除 | `~/.dsh/profiles/web/package.json` | bundles 列表中删除 `"sage-mem"` |

**数据完好性验证**：DB 大小 45,551,616 B、`observations=1594`、`user_prompts=2790`、前 16 MB md5 `469c03c0649ea643b71500ce1f71d439` —— 全部与操作前基线一致，**未触碰任何记忆数据**。

**备份**：`.memresearch/backup-sage-mem-removal/`（package.json.bak + cordis.patch.yml.bak）

**保留项**：
- `deps` 中的 `"sage-mem": "link:..."` 与 `node_modules/sage-mem` 软链**保留未动**（便于回滚，且不影响加载——加载由 bundles/patch 决定）。
- **worker 进程保留运行**（`127.0.0.1:37700` health ok）。插件已摘除，不会再有 401 刷屏；保留它是为了后续迁移时可直接用它的检索 API 导出。

**回滚方式**（若要恢复 sage-mem）：
```bash
# 1) 删除 patch 中这两行
#    - id: sage-mem
#      disabled: true
# 2) package.json 的 bundles 列表加回 "sage-mem"
# 3) 重启 DSH
```

---

## 7. 调研方法与诚实边界

### 证据来源
四路独立调研并行执行，均为源码级核实而非文档转述：
- 三个 npm tarball 解包 + 源码阅读（OpenViking / ReMe / memsearch）
- 五个仓库 clone 后读源码（mneme / meow-memory / engramory / memory-git / memory-evolve）
- npm registry packument、PyPI API、HuggingFace API 实测
- awesome-dsh-plugins 的 `data/plugins.json` 权威快照（55 个 memory 分类 bundle）

### 明确「未查到」（不影响主结论）
- deja 是否识别裸 UUID 布局（153 会话）—— 静态调研未实测，已列为安装后第一验收项
- mneme `POST /memories` 是否严格校验 type 枚举
- **mneme / meow-memory 的中文召回质量未实测**（只有单元测试断言，无 benchmark）—— sage-mem 的卖点正是中文 trigram，换插件务必先验中文召回
- memsearch 的 BM25 analyzer 是否有中文处理
- OpenViking 是否真的不支持 DeepSeek provider
- 三者在 WSL2 上的实机安装结果（本次为静态调研，未执行安装）

### 版本号说明
awesome-dsh-plugins 的快照 `checkedAt` 停在 2026-08-25，其收录的版本号**普遍过期**。本档中所有版本号均为调研当天（2026-09-10）向 npm registry / GitHub 实测所得。

---

## 附：参考文档

| 文档 | 内容 |
|---|---|
| `docs/dsh-memory-plugins-comparison.md` | OpenViking / ReMe / memsearch 21 维度对比 |
| `docs/claude-mem-migration-research.md` | 迁移路径、字段映射、LLM 成本测算 |
| `.memresearch/dsh-memory-plugins-comparison.md` | 五个本地/离线插件对比（含模型实测体积） |
| `.memresearch/dsh-agent-memory_Culeot_调研报告.md` | 单插件深挖（源码级） |
