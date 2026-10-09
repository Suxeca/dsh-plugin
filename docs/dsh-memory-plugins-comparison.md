# DSH 生态三大记忆插件对比报告

> 调研时间：2026-09-10（所有版本号/时间戳均为当日实测）
> 调研方式：npm registry 元数据 + 三个包的 release tarball 源码 + GitHub raw 文档 + 官方文档站 + npm/GitHub API + PyPI API
> 环境假设：Linux/WSL2 · 中文为主 · 只有 DeepSeek API key · 成本敏感 · 偏爱纯本地 · 已自建文件型记忆系统
> 纪律：未查到的信息一律写「未查到」，不做推测填充。`推断` 字样表示有依据的推断而非官方声明。

## 三个目标的身份确认

三个插件均真实存在，且均来自 `jqueryscript/awesome-dsh-plugins` 的 **Memory & Knowledge** 分类（条目里写明安装命令，与 npm 实际包名一致）。用户给的三条线索基本准确，只有 **license 一处需要修正**：

| 目标 | awesome 列表标注 | npm 元数据 | 仓库根 LICENSE | 结论 |
|---|---|---|---|---|
| `@openviking/dsh-memory-plugin` | Apache-2.0 | Apache-2.0（4 个版本一致） | AGPL-3.0（`volcengine/OpenViking` 仓库根） | **口径冲突**，见下文详述 |
| `@agentscope-ai/reme` | Apache-2.0 | Apache-2.0 | Apache-2.0 | 一致 |
| `@zilliz/memsearch-dsh` | MIT | MIT | MIT | 一致 |

---

## 横向对比表

| 维度 | ① OpenViking Memory | ② ReMe | ③ MemSearch (Zilliz) |
|---|---|---|---|
| **仓库** | [volcengine/OpenViking](https://github.com/volcengine/OpenViking) → `examples/dsh-memory-plugin/` | [agentscope-ai/ReMe](https://github.com/agentscope-ai/ReMe) → `typescript/` | [zilliztech/memsearch](https://github.com/zilliztech/memsearch) → `plugins/dsh` |
| **stars / 最近 push** | 36,398 / 2026-09-10 | 3,442 / 2026-09-09 | 2,583 / 2026-09-10 |
| **DSH 插件包版本** | `0.3.0`（2026-08-28；共 0.1.0→0.3.0 四版） | `0.1.2`（2026-09-01；共 0.1.0→0.1.2 三版） | `0.1.4`（2026-08-28；共 0.1.0→0.1.4 五版） |
| **License** | npm 元数据 Apache-2.0；**包内 package.json 无 license 字段**，包内也无 LICENSE 文件；仓库根为 AGPL-3.0 | Apache-2.0（仓库 + npm） | MIT（仓库 + npm） |
| **DSH 原生 Cordis 插件** | 是。`dsh.bundle.patch = ./cordis.patch.yml`，`cordis-plugin-group` 分组 + `isolate` | 是。`dsh.bundle.patch = ./dsh/cordis.patch.yml`，另有 `dsh.client`（Web 设置页 UI） | 是。`dsh.bundle.patch = ./cordis.patch.yml`，另有 `dsh.client`（Web 面板） |
| **安装命令** | `dsh plugin --profile web add @openviking/dsh-memory-plugin` | `dsh plugin --profile web add @agentscope-ai/reme` | `dsh plugin --profile web add @zilliz/memsearch-dsh` |
| **额外安装** | OpenViking **server**（`pip install openviking`，Python ≥3.10） | ReMe **service**（`pip install "reme-ai[core]"`，Python ≥3.11 + `reme start`） | `uv tool install "memsearch[onnx]"`（Python ≥3.10） |
| **存储后端** | OpenViking 服务端（内置本地 backend；可选 Redis；云端 VikingDB） | Markdown（frontmatter + wikilink）本地目录；可选 FAISS / Neo4j / zvec | Markdown 为真相源 + **Milvus** 影子索引（默认 Milvus Lite 单文件） |
| **检索方式** | 服务端语义检索（`/api/v1/search/*` 的 context face），配额 + 服务端摘要 | **默认 BM25 + wikilink 扩展**；可开向量（RRF 加权，默认 `vector_weight=0.7`） | Dense（bge-m3）+ BM25 sparse + **RRF** rerank；三层 recall（search→expand→transcript） |
| **需要外部服务** | **需要**：自建 `127.0.0.1:1933` 或火山云 OpenViking Cloud | **需要**：自建 `127.0.0.1:2333` | **不需要**：Milvus Lite 在 Python 进程内；无守护进程 |
| **付费 API / 云账号** | **需要模型能力**：Embedding + VLM。配置示例为火山引擎豆包（需付费/key），官方支持 OpenAI、Codex OAuth、Kimi、GLM；Ollama 可作 embedding（本地免费）。**DeepSeek 未出现在 provider 列表 → 未查到** | 要点：`auto_memory` / `auto_dream` 等功能**需要 LLM 凭证**；文件操作、BM25、wikilink 不需要。内置 provider 含 **deepseek** / ollama / openai / dashscope 等 | **默认零 key 零费用**：ONNX bge-m3 本地推理 + Milvus Lite。摘要可选 `custom-llm` 复用你已有的 DeepSeek key |
| **能否纯本地离线** | 可以（本地 server + Ollama embedding），但首次安装与模型需联网；本地 VLM 走 Ollama 的可行性 **未查到** | 服务在本地，但无 LLM 凭证时只有检索能力，沉淀/整理/做梦不工作 | **是**（首次需联网下 558MB 模型与 Python 依赖，之后缓存） |
| **中文支持** | 最明确：代码里做了 CJK 感知的 token 预算（CJK 字符按 1.5 token/字、ASCII 0.25），避免"5000 token 预算"在中文下严重超支；官方有完整中文文档；默认演示模型为中文系（Doubao / doubao-embedding-vision） | 官方中文 README + `language: zh` 指引文本；BM25 分词器：默认 `regex`（**中文字符逐字成 token**，注释说是为避免引入分词器），另有 `jieba` / `rjieba` 实现 | bge-m3 为多语言模型，官方评测页明确写它在中文检索上优于 `text-embedding-3-small`（Recall@5 0.776 vs 0.71）；但配置/文档层面**未查到**中文专项设置 |
| **注入方式** | **自动注入**：session-start 注入画像块 + 可用记忆索引；每个模型步骤前按当前输入检索，把 profile + recall 作为持久 user message 追加 | **仅会话开始注入一条短指引**（默认英文，可切 `zh`）；召回完全靠模型自己调 `reme_search` | **按需注入**：每轮第一步做一次有界检索；**只有当真有相关 chunk 才注入**，无命中则上下文完全不变 |
| **上下文开销** | 最高：profile 预算 10,000 token（每 session 一次），recall 预算 2,000 token（每步），代码对 CJK 有密度修正；pre-step 阻塞预算 15s | 最低：常驻只有一条几行的指引；检索结果只在模型显式调用时进上下文 | 低且有条件：`--top-k 5`、15s 超时；无命中零开销 |
| **常驻进程 / 资源** | DSH 内 Cordis 插件（**零 npm runtime 依赖**）+ **每 profile 一个 MCP stdio 代理子进程** + Python 服务端 + 向量存储 | DSH 内插件（唯一 npm 依赖 `typebox`，运行期只发 HTTP）+ **常驻 Python FastAPI/uvicorn 服务** | DSH 内插件（纯 ESM、**零依赖、无构建步骤**）+ **无守护进程**（检索/索引/摘要按需起子进程） |
| **部署复杂度（WSL2）** | 中—高：`pip install openviking` + `openviking-server init/doctor` + VLM/Embedding 配好，才谈得上记忆质量 | 中：`pip install "reme-ai[core]"` + `reme start`；`[core]` 依赖栈很重（fastapi/uvicorn/polars/numpy/faiss/zvec/neo4j/agentscope/pyinstaller 级重量） | 低—中：`uv tool install "memsearch[onnx]"`；无服务、无端口、无 Docker |
| **已知局限（要点）** | 工具面完全取决于 server（连不上就没有记忆工具）；多一层 Python 服务与模型成本；`remember` 不绑定当前会话；`forget` 永久删除；包内无 LICENSE 文件 | 默认分词是逐字 regex（中文检索体感偏弱）；沉淀依赖 LLM 且每次调用烧 token；插件安装包实际只发 0.1.x 的 DSH 适配层 | 首次下 558MB 模型；摘要默认会起 DSH headless 子代理（文档自述"无任何静默回退"，配错就明着失败）；暂无中文独立文档 |

---

## 一、OpenViking Memory（`@openviking/dsh-memory-plugin`）

### 查证到的事实

- **仓库/包**：源码在 `volcengine/OpenViking` 的 [`examples/dsh-memory-plugin/`](https://github.com/volcengine/OpenViking/tree/main/examples/dsh-memory-plugin)，npm 包名 `@openviking/dsh-memory-plugin`，最新 `0.3.0`（2026-08-28 发布），历史版本 0.1.0 / 0.2.0 / 0.2.1 / 0.3.0。
- **License 口径冲突（重要）**：仓库根是 **AGPL-3.0**；npm 元数据与 awesome 列表都写 **Apache-2.0**；但包内 `package.json` **没有 license 字段**，`files` 清单里也**没有 LICENSE 文件**（tarball 实测）。也就是说「Apache-2.0」目前只存在于 registry 元数据里，**没有可核验的许可证文本**。要不要在 AGPL 仓库的分发物里使用，建议自行确认——我未查到官方对此的说明。
- **依赖与版本要求**：`engines.node = ^22.19.0 || >=24`；peerDeps 为 `@deepseek-ai/dsh-llm`、`dsh-mcp-client`、`dsh-skill-filesystem`（`>=0.1.0-rc.6 <0.2.0`）；**运行时 npm 依赖为 0**。需要 DSH `0.1.0-rc.6` 以上（`0.1.x` 线）。
- **架构**：插件在 DSH 进程内以 Cordis 插件运行，另起一个 **MCP stdio 代理**（`servers/mcp-proxy.mjs`）连到 OpenViking server；工具面是 server 的 MCP 工具全集（能力参考文档记为 **15 个**，以 `mcp__openviking__*` 前缀发布）。默认 endpoint `http://127.0.0.1:1933`。代理在 `apply()` 里 mount 一次（源码实测），即**一个 profile 一个代理进程**，与官方 README 的「one process per profile」一致。
- **外部服务**：必须有可达的 OpenViking server——自建（`pip install openviking`，Python ≥3.10，`openviking-server init/doctor/start`）或 [火山云 OpenViking Cloud](https://www.volcengine.com/product/openviking-service)。仓库明确写「开源版不是阉割版：无功能门禁、无需账号、无激活码」。
- **模型要求（成本核心）**：服务端需要 **Embedding 模型 + VLM 模型**。`ov.conf.example` 的默认示例是火山引擎豆包系（`doubao-embedding-vision-251215` / `doubao-seed-2-0-lite`，需火山账号与 key）；也支持 OpenAI、OpenAI Codex（OAuth）、Kimi、GLM，以及 **Ollama 本地 embedding**（示例 `nomic-embed-text`，注释写明 "no API key required"）。**DeepSeek 作为 provider：未查到**。官方另提示记忆抽取需要约 32768 输出 token，小输出模型可能截断记忆重写。
- **中文**：`shared/profile-inject.mjs` 里的预算估算器明确处理 CJK 密度（CJK 按 1.5 token/char，ASCII 0.25），注释解释这是为了避开 `chars/4` 在纯中文下的 6 倍超支。中文文档完整（含 [`docs/zh/agent-integrations/17-dsh.md`](https://github.com/volcengine/OpenViking/blob/main/docs/zh/agent-integrations/17-dsh.md)）。
- **注入方式与开销**：session-start 注入画像块 + 记忆索引（每 session 一次，官方记 10,000 token 预算）；`agent/pre-step` 每步检索并把 profile/recall 追加为持久 user message（recall 预算 2,000 token）。DSH 侧 pre-step 阻塞预算 15s。
- **评测口径提醒**：仓库 README 的 LoCoMo 是「OpenViking 0.3.22 在 LoCoMo 上 80–83% accuracy」，评测用 Doubao 2.0 Pro + Doubao embedding。**讨论帖 #1436 里的「91.7% fact-level recall / 58.9% token 压缩」不属于本插件**——那是同一作者另一个仓库 [`zouyuanqing/dsh-memory-openviking`](https://github.com/zouyuanqing/dsh-memory-openviking) 的数据，对应包名 `@deepseek-ai/dsh-memory-openviking` + `@deepseek-ai/dsh-tool-memory`，工具名也不同（`memory_write/recall/search/profile/forget`），与本包不是同一份实现。
- **已知局限**：① 记忆工具全在 server 侧，server 挂了就没有工具（README 的失败隔离只保证「不阻塞会话」）；② 多一层 Python 服务 + 模型成本；③ `mcp__openviking__remember` 不落在当前会话流；④ 一个 profile 一个代理进程，工具调用的 peer 是启动时解析的，多 workspace 需显式 `OPENVIKING_PEER_ID`；⑤ `forget` 是永久删除；⑥ Web 形态关标签页不触发 teardown commit；⑦ 中文文档列出的坑：pnpm `minimumReleaseAge` 导致新版本 24h 内装不上、prerelease tag 不同步触发 `ERESOLVE`。

### 适合谁 / 不适合谁

- **适合**：已经在用 OpenViking（或有火山引擎账号/预算）的人；想要「开箱即自动召回 + 全套记忆工具 + 服务端 LLM 蒸馏」的重型方案；愿意为记忆质量付出一个常驻 Python 服务和模型调用费；需要跨 harness 共享同一份记忆（OpenViking 覆盖 10 个 harness）。
- **不适合**：成本敏感 + 只有 DeepSeek key 的纯本地用户——它的模型供给列表里没有 DeepSeek，Embedding/VLM 要么另买（火山/OpenAI/Kimi/GLM），要么自己搭 Ollama（只确认了 embedding 一项，VLM 未查到）；不想再跑一个 Python 服务的人；对许可证口径敏感的人（AGPL 仓库 vs 仅存在于 registry 元数据的 Apache-2.0，包内无 LICENSE 文件）。

---

## 二、ReMe（`@agentscope-ai/reme`）

### 查证到的事实

- **仓库/包**：`agentscope-ai/ReMe`（Apache-2.0，3,442 stars，最近 push 2026-09-09）；npm `@agentscope-ai/reme` 最新 `0.1.2`（2026-09-01）。README 自述定位是 "local-first, self-evolving personal knowledge base"，明确列出 DeepSeek Harness 为一等公民。
- **两部分**：① npm 插件（TS/ESM，`dist/dsh/*`，唯一运行期依赖 `typebox`）；② **Python 服务** `reme-ai`（PyPI 最新 `0.4.1.11`，2026-09-01；`pip install "reme-ai[core]"`，Python ≥3.11，`reme start` 监听 `127.0.0.1:2333`）。插件本身只是 HTTP 客户端。
- **DSH 集成形态**：`dsh.bundle.patch = ./dsh/cordis.patch.yml`，用 `cordis-plugin-group` 装两个条目（`@agentscope-ai/reme/dsh` + `@agentscope-ai/reme`）；另有 `dsh.client`（Web 端设置/状态页，注入 locale / runtime / ui-settings 等）。peerDeps 含 `@deepseek-ai/cordis ^4.0.1`（本机 web profile 实测装的就是 cordis 4.0.1，兼容）。
- **存储与检索**：Markdown 文件 + frontmatter + wikilink 是真相源；**默认纯 BM25 + wikilink 扩展**，向量检索**默认关闭**（官方原话：`embedding_store: Disabled`，「Out of the box, search therefore uses primarily BM25 plus link expansion」）。要开向量需三步：启用 `as_embedding`、启用 `embedding_store`、把 `file_store.embedding_store` 从 `""` 改成 `default`。开后 `vector_weight=0.7` 与 BM25 做 RRF 融合。
- **LLM 依赖（成本核心）**：官方明确「文件操作、BM25 检索、wikilink 遍历、`proactive_read` 不需要 LLM；而 `auto_memory`、`auto_resource`、`auto_dream`、proactive refresh 需要」。插件默认 `autoMemoryEnabled: true`、`autoDreamEnabled: true`（cron `0 23 * * *`）、`autoMemoryInterval: 5`（攒 5 轮调一次）。**内置 provider 注册包含 `deepseek`**，用 `LLM_API_KEY` / `LLM_BASE_URL`（OpenAI 兼容）即可指向 DeepSeek。
- **中文**：官方中文 README；插件配置有 `language: "en" | "zh"`，`zh` 会注入中文的长期记忆指引（源码 `dist/core/guidance.js` 有完整中文文案）。BM25 侧最关键的细节：**默认分词器是 `regex`**，源码注释写「每个 CJK 字符各自成 token，以避免引入中文分词器，同时给 BM25 提供可用的 unigram」；另有 `jieba`（纯 Python）与 `rjieba`（Rust，默认 backend，快 10–30×）实现，但**默认配置写的是 `regex`**，切 jieba 需要自己改配置。
- **注入方式与开销**：`agent/session-start` 注入一条指引（内容固定，几行）；`session/event` 异步攒轮，按 `autoMemoryInterval` 批量 POST `/auto_memory`。**没有自动召回注入**——召回靠模型主动调 `reme_search(query, limit, min_score)`。常驻上下文开销因此是三个里最小的。
- **已知局限**：① 必须常驻一个 Python 服务（含 `[core]` 的重量级依赖栈）；② 默认中文分词是逐字 regex，实际中文 BM25 召回质量需要自行验证（我没查到官方中文检索评测的具体数字）；③ 若无 LLM 凭证，插件会保持「只读检索」，你没配好会以为它在记，其实 `auto_memory` 全失败；④ 它本质上是把整套 ReMe 知识库搬进来，跟你已有的文件型记忆体系是**两套并行**，需要你自己决定谁是谁的上游；⑤ 官方在 LongMemEval/BEAM 上的分数（89.4% 等）是 ReMe 服务体系的成绩，**不是 DSH 插件形态下的实测**。

### 适合谁 / 不适合谁

- **适合**：已经/愿意跑 ReMe 服务的人（比如同时用 QwenPaw、Claude Code）；想要「Markdown 是唯一真相源 + wikilink 知识网 + 不用向量库也能检索」的人；能接受把 token 花在后台 `auto_memory`/`auto_dream` 上的人（有 DeepSeek key 就能接）；想要按需召回、不想每步都注入上下文的人。
- **不适合**：不想再维护一个 Python 常驻服务 + 重量级依赖的人；指望开箱就有强中文召回的人（默认分词器是逐字 regex，jieba 要自己开）；纯本地零成本党（可用 LLM 关掉后退化成 BM25 检索，但那就等于放弃了它的"self-evolving"卖点）；已经有一套自己满意的中文记忆系统、不想并行维护第二套的人。

---

## 三、MemSearch（`@zilliz/memsearch-dsh`）

### 查证到的事实

- **仓库/包**：`zilliztech/memsearch`（MIT，2,583 stars，最近 push 2026-09-10；Zilliz 即 Milvus 背后公司）；npm `@zilliz/memsearch-dsh` 最新 `0.1.4`（2026-08-28）；Python 引擎 `memsearch`（PyPI `0.4.19`，2026-08-23，47 个版本）。
- **DSH 集成形态**：`dsh.bundle.patch = ./cordis.patch.yml`；`dsh.client.platform = web`（自带 Web 端技能候选审阅面板）；`dependencies: {}`，只 peer 一个 `@deepseek-ai/dsh-llm: "*"`。插件是**纯 ESM 无构建步骤**，装了即生效。
- **存储**：**Markdown 是真相源**（`.memsearch/memory/YYYY-MM-DD.md`，人类可读、可编辑、可版本控制），`README` 原话「Milvus 是影子索引：一个派生的、可重建的缓存」。**Milvus 默认 = Milvus Lite（单文件 `~/.memsearch/milvus.db`，零配置、无需 Docker/服务）**；可选 Zilliz Cloud（免费 tier，商业推广）或自建 Milvus Server（要 Docker）——但**不是必需**。
- **Embedding（离线关键）**：默认 **ONNX bge-m3 int8，本地 CPU 推理，无需 API key、零成本**；首次使用从 HuggingFace 下载约 **558 MB** 并缓存。官方评测页写明该模型在 955 chunks / 2172 条**双语**查询上，比全精度 PyTorch 版只丢 ~1% recall，体积从 2.2GB 降到 558MB，**且在中文检索上优于 OpenAI `text-embedding-3-small`（Recall@5 0.776 vs 0.71）**。其它可选 provider：ollama（本地）、openai、google、voyage、jina、mistral。
- **检索**：Dense（bge-m3）+ BM25 sparse + RRF rerank 的混合检索；三层 recall（search → 展开 markdown 段落 → 读原始 DSH transcript）。
- **注入方式与开销**：`agent/pre-step` **只在每轮第 1 步**跑一次有界检索（`--top-k 5`，15s 超时）；**只有真的搜到 chunk 才注入**并附一条 `[memsearch] Memory available.` 提示，**搜不到直接返回原 decision，上下文零成本**。另有 `memory-recall` 技能供模型显式深挖。
- **后台开销**：维护任务（`PROJECT.md` / `USER.md` / memory-to-skill）**默认全关**，触发点是 `session/disposed` + 6 小时兜底定时器，每个任务最多 `min_interval_hours`（默认 24h）跑一次。
- **摘要后端（成本关键）**：`summarizeMode` 三选一——`auto`（默认：配置了 provider 就用 `custom-llm`，否则用 `dsh-headless`）、`dsh-headless`（起一次性 `dsh --profile headless` 子代理，模型取 `~/.dsh/settings.yaml` 的 `agent-default-model`，也就是**你的 DeepSeek key**）、`custom-llm`（直接调 `[llm.providers.*]`，可精确指到 `deepseek-v4-flash` 之类）。文档明确：**模式之间没有静默回退**，失败会写一条"unavailable"短note 并打日志。
- **和你已有系统的关系**：`MEMSEARCH_DIR` 可显式指定记忆目录（插件源码 `resolveMemoryDir`：`process.env.MEMSEARCH_DIR || join(projectDir, '.memsearch')`）。也就是说**理论上可以把它指向你现有的 markdown 记忆目录**——但记忆写入格式是按它自己的锚点约定（`<!-- session:<id> turn:<N> db:<path> -->`），与你现有体系是否兼容，我**未实测**。
- **CLI 探测有兜底**：插件 `detectMemsearchCmd()` 先找 PATH 上的 `memsearch`，找不到就退回 `~/.local/bin/uvx` 或 `uvx`，拼成 `uvx --from 'memsearch[onnx]' memsearch`——所以即使 CLI 不在 PATH，只要装了 uv 也能跑（兜底路径是源码实测，非文档声明）。
- **已知局限**：① 首次需联网下 558MB 模型（HuggingFace 可达性要自己确认）；② Python 3.10+ / `uv` 仍是前提（插件只能兜底调用方式，不能替你装 Python）；③ 默认 `auto` 摘要可能起 headless DSH 子代理，长会话下 token 与延迟需自己评估，建议显式改成 `custom-llm`；④ 记忆按项目路径派生 collection 隔离（`ms_<basename>_<hash8>`），跨项目共享要额外配置；⑤ 文档站未提供独立中文版（**未查到**中文页面）；⑥ 我**没有实际安装运行**，以上架构结论来自 tarball 源码 + 官方文档。

### 适合谁 / 不适合谁

- **适合**：中文为主 + 成本敏感 + 想要"不新增任何付费 API、不出本机"的人——默认组合就是**本地 ONNX bge-m3 + Milvus Lite**，摘要可以直接复用你已有的 DeepSeek key（`custom-llm`）；已经有文件型 markdown 记忆习惯的人（它的真相源就是 markdown，理念最接近你现有的自建系统）；不想再养常驻服务/Docker 的人（无守护进程、无端口）；WSL2 上部署面最小。
- **不适合**：完全不能联网（首次 558MB 模型与 Python 依赖下载绕不过）；不想在本机引入 Python/uv 工具链的人；需要"每次对话都强注入画像"的重注入型体验的人（它是按需、无命中即零注入）；需要跨项目/跨机器统一记忆且不想折腾 collection 配置的人；要求每个组件都有完整中文文档的人。

---

## 结论：针对你的环境（WSL2 · 中文 · 只有 DeepSeek key · 成本敏感 · 偏爱纯本地 · 已有自建文件型记忆）

按"与你约束的贴合度"排序（这是我的判断，依据在上文事实）：

1. **MemSearch 最贴合**：唯一一个「默认配置就是纯本地零 key」的方案（本地 ONNX bge-m3 + Milvus Lite），中文检索有明确评测（优于 OpenAI small），摘要可以精确指到你现有的 DeepSeek key 而不是新买一家模型，且没有常驻服务/Docker。代价是首次 558MB 下载与 Python/uv 依赖，加上把 `summarizeMode` 从默认 `auto` 改成 `custom-llm` 这一步必做。
2. **ReMe 次之但要改造**：「已内置 DeepSeek provider」这点很友好，且不注入、开销最小；但它要求常驻 Python 服务，默认中文分词是逐字 regex（要手动切 jieba 才有像样的中文 BM25），而且它的自我演化能力离了 LLM 就不工作。
3. **OpenViking 与你的约束冲突最大**：能力上限最高（自动召回 + 15 个工具 + 服务端蒸馏），但它要一个 Python 服务 + **Embedding 与 VLM 两套模型**，而它的 provider 列表里**没有 DeepSeek**——要么另买火山/OpenAI/Kimi/GLM，要么自搭 Ollama（我只确认了 embedding 可用，VLM 未查到）。对"只有 DeepSeek key + 成本敏感"的用户，这是最贵、最重的选择。

**一个必须点明的现实**：这三个都是"再建一套记忆"，而不是接管你已有的文件型系统。如果你现有系统已经满足需求，引入它们的边际收益主要在①自动捕获、②语义检索、③跨会话召回这三项；如果这三项你已经自建，那么本次调研的实际结论可能是"继续自建 + 参考它们的注入时机设计（如 memsearch 的按需零注入、OpenViking 的 CJK 预算修正）"更划算。

---

## 查证过的 URL 清单

**仓库与包**
- https://github.com/volcengine/OpenViking
- https://github.com/volcengine/OpenViking/tree/main/examples/dsh-memory-plugin
- https://github.com/volcengine/OpenViking/blob/main/examples/dsh-memory-plugin/README.md
- https://github.com/agentscope-ai/ReMe
- https://github.com/agentscope-ai/ReMe/tree/main/typescript
- https://github.com/zilliztech/memsearch
- https://www.npmjs.com/package/@openviking/dsh-memory-plugin
- https://www.npmjs.com/package/@agentscope-ai/reme
- https://www.npmjs.com/package/@zilliz/memsearch-dsh
- https://pypi.org/project/reme-ai/
- https://pypi.org/project/memsearch/

**registry / API 元数据（实测查询）**
- https://registry.npmjs.org/@openviking%2fdsh-memory-plugin
- https://registry.npmjs.org/@agentscope-ai%2freme
- https://registry.npmjs.org/@zilliz%2fmemsearch-dsh
- https://api.github.com/repos/volcengine/OpenViking
- https://api.github.com/repos/agentscope-ai/ReMe
- https://api.github.com/repos/zilliztech/memsearch
- https://pypi.org/pypi/reme-ai/json
- https://pypi.org/pypi/memsearch/json

**发布 tarball（源码级查证）**
- https://registry.npmjs.org/@openviking/dsh-memory-plugin/-/dsh-memory-plugin-0.3.0.tgz
- https://registry.npmjs.org/@agentscope-ai/reme/-/reme-0.1.2.tgz
- https://registry.npmjs.org/@zilliz/memsearch-dsh/-/memsearch-dsh-0.1.4.tgz

**官方文档**
- https://docs.openviking.ai/zh/agent-integrations/17-dsh
- https://docs.openviking.ai/en/agent-integrations/17-dsh
- https://docs.openviking.ai/en/guides/01-configuration
- https://docs.openviking.ai/en/getting-started/02-quickstart
- https://github.com/volcengine/OpenViking/blob/main/docs/zh/getting-started/02-quickstart.md
- https://github.com/volcengine/OpenViking/blob/main/docs/zh/agent-integrations/16-capability-reference.md
- https://github.com/volcengine/OpenViking/blob/main/examples/ov.conf.example
- https://reme.agentscope.io/
- https://github.com/agentscope-ai/ReMe/blob/main/docs/en/configuration.md
- https://github.com/agentscope-ai/ReMe/blob/main/docs/en/memory_search.md
- https://github.com/agentscope-ai/ReMe/blob/main/reme/config/default.yaml
- https://zilliztech.github.io/memsearch/platforms/dsh/
- https://zilliztech.github.io/memsearch/platforms/dsh/installation/
- https://zilliztech.github.io/memsearch/platforms/dsh/how-it-works/
- https://zilliztech.github.io/memsearch/home/embedding-evaluation/
- https://zilliztech.github.io/memsearch/home/configuration/

**Discussions 与生态列表**
- https://github.com/deepseek-ai/deepseek-harness/discussions/1436（作者 zouyuanqing，2026-08-14 创建，2026-09-01 最后更新，5 条评论，Ideas 分类；文中的数据属于 `zouyuanqing/dsh-memory-openviking`，不是本报告第①个包）
- https://github.com/zouyuanqing/dsh-memory-openviking（讨论帖对应的另一个实现）
- https://github.com/jqueryscript/awesome-dsh-plugins（Memory & Knowledge 分类下同时收录三者）

**未查到的项（明确列出）**
1. OpenViking 官方对「npm 元数据 Apache-2.0 vs 仓库 AGPL-3.0 vs 包内无 LICENSE」的说明。
2. OpenViking 本地 VLM 走 Ollama 的可行性与配置（只确认了 embedding 走 Ollama）。
3. OpenViking 是否支持 DeepSeek 作为 VLM/Embedding provider。
4. ReMe 中文检索/分词的量化评测数字（官方中文文档未给）。
5. memsearch 文档站的中文版本。
6. 三个插件在你的 WSL2 环境下的实际安装/运行结果（本报告为静态调研，未执行安装）。
