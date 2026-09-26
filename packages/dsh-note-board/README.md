# @suxeca/dsh-note-board

**笔记看板** —— 给 DSH 对话视图加第三个标签页，把「一份 Markdown 笔记 + 它的对抗审计判决」变成会话的一部分。

它在 `对话 | 轨迹` 之后注册 `笔记看板`，三件事一起做：

1. **看** —— 用平台自带的 KaTeX 渲染笔记正文（不自带数学渲染器）
2. **绑** —— 笔记**按会话绑定**：显式附加 / 从工作目录自动发现 / 不绑
3. **注** —— 把绑定的那份笔记每轮注入系统提示，并在它变化时发一条 `[LEDGER DELTA]`

它不关心笔记里写的是什么：任何「值得每轮注入、且需要人工确认过才算数」的 Markdown 笔记都适用。
文件位置、文件名、审计收件箱名都是配置项，默认值只是约定，不是事实。

---

## 为什么需要它

一段长期、可累积的工作会死在同一件事上：**说好的定义会漂移**。会话被压缩、被新会话替换、
或者两个会话并行推进时，同一个记号在两边含义不同，而没有任何东西记得「哪个版本才是定下来的」。

把定义写进一个文件解决了一半问题。剩下一半是三个具体的坑，这个插件就是按它们长的：

| 坑 | 朴素做法 | 本插件的做法 |
| --- | --- | --- |
| **笔记是全局的** | 一个固定路径写死。于是一个跟该笔记毫无关系的会话，标签页里也赫然列着它的内容，而且 UI 不承认这里做过任何选择 | **按会话解析**（附加 → 发现 → 无），来源在界面上明说 |
| **「给你看的」和「模型真的收到的」不是一份** | 看板读一个文件，注入读另一个文件（或另一个插件）。两者只在「刚好写成同一个路径」时一致，一旦不一致**完全不可见** | 解析、显示、注入**同属一个插件**：「看板显示的即被注入的」是构造性成立的，不是两个模块的君子协定 |
| **注入是纯文本替换，没有版本语义** | 每轮重读文件、原样注入。文件确实更新了，但模型的**上下文里还压着旧版本**——它会继续照旧的记号往下推 | 逐节指纹比对，变化时先发 `[LEDGER DELTA]`：**点名哪几节变了，并声明旧版本作废** |

第三个坑最阴险，因为它**读起来像「什么都没发生」**。所以增量基线是**持久化**的
（`note-board-fingerprints.json`）：DSH 停机期间发生的编辑，在恢复后的第一轮依然会被播报，
而不是被当成「首次读取」吞掉。

---

## 功能

### 三个页签

| 页签 | 内容 |
| --- | --- |
| **笔记目录** | 扫机器上所有笔记，带大小、冻结/判决/未决节数、未读判决数、最后修改时间，比例条显示构成；点「附加」＝绑定到**本会话**并从下一轮起注入 |
| **笔记正文** | 本会话绑定的笔记，Markdown + KaTeX 渲染；顶部**绑定栏**说明这一份是怎么来的（附加 / 自动发现 / 未绑定）、绝对路径、发现时的祖先目录 |
| **审计判决** | 该笔记的审计收件箱（默认 `<笔记目录>/.note-audit-inbox`），按时间倒序、默认折叠展开；已消费（`.md.consumed`）的也列出并标注——**判决是用来复查的**，已经看过的那条恰恰值得再看 |

### 「吸收线」

看板显示**整个文件**，注入每轮只发前 `injectBudget` 个字符。文件长过预算时两者就悄悄分叉了，
所以界面上有一条常驻提示：`✓ 全文 X 字 ≤ 预算 Y 字` 或 `⚠ 已超出预算——模型只看到前 Y 字`。
它不猜，它把「你正在读的是不是模型正在收到的」变成可读的。

### 绑定语义

```
解析顺序（ledgers.ts，唯一的裁决处）
  1. 显式附加   note-boards.json 里 sessionId → 绝对路径（附加时路径必须已存在，防手滑）
  2. 自动发现   从会话工作目录逐级向上找约定位置（notes/ledger.md 等，可用 ledgerFiles 覆盖）
  3. 无         什么都不注入
```

第 3 条是**承重**的，不许软化成「沿用上一个」：一旦缺席会静默回退到别的笔记，
会话之间就会继续互相渗漏，隔离就成了谎话。一个跑别的事情的会话显示「未绑定」不是故障状态——
**那正是你被期望去选择的状态**，所以首次加载会落在目录页而不是错误页。

会话 `cwd` 的来源也是分层的：先查内存里的 `sessions` 服务，**miss 时**回退到 `sessionPersistence`
（已换出的会话不在内存里，但持久化元数据仍记得它的 `cwd`）。命中永久缓存（`cwd` 在会话头里是不可变的），
**miss 故意不缓存**——一个 id 未知也许只是因为它的会话还没落盘，把这个答案冻住会让「一秒钟后出现的会话」永久看起来未绑定。

### 注入

挂在 `system-prompt/assemble` waterfall 上。**顺序只是呈现顺序，不是优先级**——`sections` 没有 rank 字段，靠前并不会让它压过 persona。默认 `placement: 'last'`（后置）：账本是**数据**，persona 是**作业契约**，让契约先框住数据；后置也把「最前面」留给需要它的逐轮路由指令，并且不让一个带权威口吻的抬头占据首位（那正是提示注入想站的一侧）。若你希望定义先于一切出现，设 `placement: 'first'`。

### 会话级注入开关

**默认自动注入**：会话的工作目录向上能找到候选笔记就注入。两个入口，写的是同一份状态：

**① 斜杠命令**（可在**发第一条消息之前**用，看板标签页此时还不存在）：

```
/note-board off      本会话不注入
/note-board on       恢复注入
/note-board status   查看当前状态（等价于 /note-board）
```

**② 看板绑定栏**：

- 「**本会话不注入**」→ 停止把这份笔记注入**当前会话**，其它会话不受影响；
- 关闭态显示为「**注入已关闭**」，旁边是「恢复注入」。

关闭是**持久化**的（写进 registry 的 `off` 名单，跨重启记住），并且**压过自动发现**——否则下次装配会把刚关掉的笔记重新绑定。开关是**会话级**：项目里的其它会话、以及显式附加关系都不动（恢复时回到原来的绑定）。

一个必须说清的限制：`delivery: 'snapshot'` 下正文是**已提交进会话历史**的消息，而历史只追加。所以关闭时插件会**注入一条作废声明**（「此前注入的笔记副本已作废，不要再引用」），而不是假装它消失了；`section` 通道下关闭则立刻从系统提示消失。

### 为什么正文默认走系统提示，以及 `delivery: 'snapshot'` 是什么

系统提示是 agent loop 的 **surface 第 0 号节点**，渲染文本一变就**原位替换**（[决策记录](../../../deepseek-harness/.agents/notes/implemented/architecture/2026-09-02-system-prompt-as-surface-node.zh.md)）；而替换第 0 号节点意味着"提供方前缀从第一个 token 起改变"。于是**笔记每编辑一次，改动点之后的整段会话都在重算区间里**——代价随会话长度增长，而不是随笔记长度。

`delivery: 'snapshot'` 把同一份正文改投成 **durable user-role 快照**（平台自己的运行时上下文用的就是这种形状：`source: {kind:'plugin', form:'snapshot', sections}`）。快照追加在**保留历史之后**：内容变化时只追加，被 compaction 丢掉时在下一次装配自动补回（按 surface 里是否存在同一份正文判断，不另做记账）。代价是历史里会同时留有新旧的正文副本。

两条通道**投递的文本完全相同**（同一段 header + 正文，测试里直接比对过），差别只在通道。默认 `'section'`：它给出的是不依赖历史与压缩的每轮保证。

**两条通道，各取所长**：

| 内容 | 通道 | 为什么 |
| --- | --- | --- |
| 笔记**正文** | system-prompt section | 要的是**保证**：每个请求重新拼装，不漏轮、不被压缩吞掉。抬头里常驻一句「本节即最新版本，以本节为准」，覆盖通知送达前的那一步 |
| **变更通知** `[LEDGER DELTA]` | `agent.inject` 上下文注入 | 要的是**可见**：它以 `kind: 'plugin'`（`plugin: 'note-ledger'`）注入为一条 user 消息，在时间线上显示为可折叠的「上下文注入 · note-ledger」，折叠行是 `form: 'notice'` 的摘要，展开即正文。改动发生的那一轮你能直接看见，不必去 diff 两次请求的系统提示 |

注意 `source.kind` 只能用 `'plugin'`：会话持久化格式对 `kind` 做闭集校验，生产者不能自造。注入是在**下一个 pre-step** 被 claim 的（平台自身文档也写明可能错过某次请求），所以它承担"通知"，不承担"每轮必到"——那是正文留在系统提示里的原因。

系统提示里注入的 section：

- `note-ledger` —— 正文，带 `[FROZEN LEDGER]` 抬头（「不得在未显式声明 `[SYMBOL MUTATION]` 的情况下改写」）
- `note-ledger-delta` —— 仅当指纹变了：`新增 / 被替换 / 被删除` 逐节点名，并明确「下面正文是最新版本，以它为准；你上下文里的旧版本已作废」

`MUTATION-LOG` 节**故意排除**在指纹外：每次编辑都会往它追加一行，把它算进去会让「每次编辑都播报日志变了」，
把真正值得看的那条（哪条**定义**动了）淹掉。

### 界面细节

- **跟随皮肤**：颜色全是 `--dsw-alias-*` 变量，无主题分支代码
- **对齐对话列**：正文用 `--dsh-chat-content-width`（和 `对话`/`轨迹` 同宽），且控件**必须**落在列内——
  DSH 的列拖拽条从列外 24px 起向外延伸 40px，把按钮钉在面板右缘会让「点击刷新」变成「拖拽分栏」
- **双语**：中/英，切换走平台 `locale.setLocale`（**不是**插件私有状态）。因为标签页的 `label` 是 thunk、
  由对话容器在 locale 变化时重新投影——私有语言会让「标签中文、面板英文」且无法调和
- **错误边界**：看板是诊断工具，渲染抛错时最糟的失败是**空白面板**（看起来像「笔记是空的」）。
  边界把它变成一段可读的报错
- **轮询 5s**，人不动它就不抢焦点：落点只在**第一次**响应时决定，之后页签归属人

---

## 架构

```
host（Node）
  index.ts        挂路由 + provide('noteLedgers') 服务
  ledgers.ts      会话 → 笔记的唯一解析处；附加/解附；审计收件箱路径推断
  catalog.ts      有界扫描 + 缓存 + 节数统计
  routes.ts       HTTP 路由（会话寻址）
  inject.ts       注入 + 增量播报
  fingerprints.ts 持久化基线（sha1/节，原子写，上限 512 会话）

client（浏览器）
  index.ts      slots.register('conversation.view', { id, order: 20, label: thunk })
  Body.tsx      看板本体、三段落、绑定栏、吸收线、错误边界
  Catalog.tsx   笔记目录
  i18n.ts       中/英词典（同一 interface，缺一条是编译错误）
  theme.ts      --dsw-alias-* 令牌 + CONTENT_COLUMN
```

**服务契约**（`noteLedgers`，同一部署里的其它插件靠它拿到同一份解析结果）：

```ts
resolve(sessionId: string, cwd?: string): Promise<LedgerRef>
read(sessionId: string, cwd?: string): Promise<{ ref, text, inboxDir }>
```

调用方传入的 `cwd` **优先**：调用方手里就有 Agent，它对自己工作目录的看法比 `sessions` 服务更权威。
服务缺席时看板照常工作，调用方回退到自己的路径配置。

### HTTP 路由

前缀 `/note-board/api`，全部返回 `{ ok, data?, error? }` 信封。**每个路由在处理任何请求之前，先向 `connection` 服务询问该请求是否可信**，不可信一律拒绝（见下方「安全与信任边界」）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/ledger?sessionId=` | 绑定笔记正文（超 `maxBytes` 字符则截断并标注） |
| GET | `/audits?sessionId=` | 审计收件箱（只读最新的 `auditLimit` 份） |
| GET | `/known` | 曾经附加过的路径（切换器用，上限 256 条） |
| GET | `/catalog?sessionId=` | 机器上的笔记目录（含实际使用的候选文件名） |
| POST | `/attach` `{ sessionId, path }` | 显式绑定；路径不存在/不是普通文件返回 400 而不是 500 |
| POST | `/detach` `{ sessionId }` | 退回自动发现 |

`sessionId` 只接受 `[A-Za-z0-9._:-]{1,128}`，且拒绝 `__proto__` / `constructor` / `prototype`——它会成为登记表的对象键。

**「本会话没有笔记」是 200 + `ref.source === 'none'`，不是错误。** 跑别的事情的会话不是坏掉的会话。

### 安全与信任边界

这几条是**设计事实**，不是免责声明；发布前经跨厂商对抗审查逐条验证过：

1. **路由不自动在鉴权门后。** DSH 的 web 鉴权门属于「前端静态资源兜底」那条路径，而插件注册的具名路由**先于**它被匹配。所以本插件的每个路由都自己调 `connection.requestRejection(req)`，与 DSH 官方的 `open-in-app`、api gateway 一致；`connection` 缺席时**失败关闭**（503，绝不吐文件）。没有这一步，`POST /attach{path:"/etc/passwd"}` + `GET /ledger` 就是一个无需凭据的任意文件读。
2. **`path` 是用户选择的绝对路径，不是受限根内的路径。** 显式附加等于「用户授权读这个文件」，没有 allowlist——所以路由鉴权是这条设计的**前提**，而不是加分项。附加要求目标是**普通文件**（目录、FIFO、设备节点一律拒绝）。
3. **读取有界。** `maxBytes` 是**字符（UTF-16 码元）**上限（截断若正好落在代理对中间，会退一个码元，绝不吐出半个字符），同时约束底层读取（UTF-8 最多 4 字节/字符，故实际读取上界为 `maxBytes*4+4` 字节），并被硬钳到 4M 字符——配置本身也是输入，`maxBytes: 1e12` 不该变成一个 TB 级分配。打开时用 `O_NONBLOCK`，因此 FIFO 不会挂起请求、也不会拖垮 libuv 线程池。同一原语约束**所有**读者：路由、每轮注入、目录扫描、**以及 `noteLedgers` 服务**（共享服务留一处无界读，等于修复只做了一半）。
3b. **两个持久化 JSON 都是有界输入，且一视同仁。** `note-boards.json`（登记表）与 `note-board-fingerprints.json`（增量基线）都按上限读取，并逐键**重新校验**（只看自有属性、拒绝 `__proto__` 等保留名、类型不符即丢弃、字段长度与节数有上界）。基线尤其重要——它**每轮 assemble 都读**，所以无界读在那里是每轮的常驻成本，而不是一次性开销。两者的写入都用**每次唯一**的临时文件 + 原子 rename：共享 `${path}.tmp` 会让并发写者互相 rename 掉对方半写的文件，而两个会话同时 assemble 是常态，不是边角情况。
4. **笔记原文会进入系统提示。** 自动发现**不需要人工动作**：从会话工作目录逐级向上找到 `notes/ledger.md` 等候选即注入。因此**克隆一个含该文件的仓库，就可能把它的内容送进你的系统提示**——该文件是可信输入。要避免这一点，把 `ledgerFiles` 指到更独特的位置，或关掉自动注入（只保留显式附加）。
5. **会话隔离是名义上的。** 任何通过鉴权的调用方都能读/改任意 `sessionId` 的绑定（`sessionId` 由客户端提供，不与会话做归属校验）。在单用户、loopback 部署下这是可接受的；**不要**把 DSH 的端口暴露给不可信网络。
6. **「可信」的含义由 DSH 定义，不由本插件定义。** 鉴权判据来自 `connection.requestRejection`——它按 DSH 自身的连接权威判定，其中**包含被 DSH 有意视为已认证的 Tailscale 权威**。所以这道门挡的是「无凭据的本地进程 / 跨站浏览器请求」，**不是**「任何能连到该端口的网络位置」。把 DSH 暴露在 Tailscale/局域网/公网时，这一层就是你的网络信任边界；本插件不做额外鉴别。
7. **保留的标记是接受的残留项。** 注入抬头里的 `[FROZEN LEDGER]` / `[SYMBOL MUTATION]` 是**刻意保留**的：它们是与外部 writer 之间的活契约（改名的代价是与既有部署静默失同步），且属于「冻结定义 / 声明记号变更」这类通用形式化用语，不指向任何具体课题。跨厂商对抗审查的判定是：周边措辞已中性化，这两个标记本身不构成课题泄露。

---

## 笔记格式

正文是普通 Markdown，只有一条约定：`## <ID>` 开头的行划分节，`ID` 是后续编辑唯一的把手。

```markdown
## FROZEN-1 · 定义
$$ \boxed{\;f(x) \equiv \dots\;} $$

## FROZEN-2 · 术语与约定
| 符号 | 含义 | 定义域 |

## VERDICT-1 · 已判决（勿重开）
## OPEN · 未决问题
## RULES · 记账纪律
## MUTATION-LOG
```

按 ID 前缀分类（大小写不敏感）：`FROZEN*` / `VERDICT*` / `OPEN*`，其余归入「其它」。
`MUTATION-LOG` 不参与增量比对（理由见上）。

**要改一条已存在的条目就替换它，别在下面追加更正**——笔记每轮整份注入，追加的更正不会让被更正的那条退休，
两条会一起被注入、互相矛盾，直到会话结束。

---

## 配置

全部有默认值，**默认即可用**。部署相关的路径留在**你自己的 profile patch 层**里，
不要写进这个包的 `cordis.patch.yml`——loader 会在每个 bundle 层之后应用 profile 层，所以覆盖是安全的。

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `registryPath` | `''` → `${DSH_HOME:-~/.dsh}/note-boards.json` | 附加登记表 |
| `maxBytes` | `262144` | **字符**上限：既截断返回正文，也约束底层读取（≤ `maxBytes*4+4` 字节）；硬钳 4M |
| `auditLimit` | `20` | 审计判决最多列几条（上限 500；只读最新的 N 份） |
| `injectBudget` | `6000` | 每轮注入的**字符**上限（吸收线据此判断是否分叉） |
| `scanRoots` | `[]` → `~/Workspace` | 目录扫描根 |
| `scanDepth` | `3` | 向下层数（3 层刚好到 `<workspace>/<项目>/notes/`，不会走进源码树；上限 8，不跟随符号链接目录） |
| `catalogTtlMs` | `30000` | 扫描结果缓存时长（上限 10 分钟） |
| `ledgerFiles` | `[]` → `['notes/ledger.md', '.notes/ledger.md', 'ledger.md']` | 逐级向上查找的相对路径，按顺序 |
| `auditInboxName` | `''` → `.note-audit-inbox` | 审计收件箱目录名（位置固定在笔记同级） |
| `placement` | `'last'` | 注入 section 落在 `'first'` 还是 `'last'`；仅影响呈现顺序，不影响权威 |
| `delivery` | `'section'` | 正文走哪条通道：`'section'` 渲染进系统提示；`'snapshot'` 作为 durable user-role 快照投递（见下） |

注入开关不是配置项——它是**按会话**的运行时状态（`POST /note-board/api/injection`），写在 registry 里。

覆盖示例（放在 `~/.dsh/profiles/<profile>/cordis.patch.yml`）：

```yaml
- id: note-board
  config:
    scanRoots: ['/srv/work']
    ledgerFiles: ['docs/definitions.md', 'notes/ledger.md']
    auditInboxName: '.review-inbox'
    injectBudget: 8000
```

---

## 安装

```sh
# 1. 构建（在 DSH checkout 所在环境里）
cd packages/dsh-note-board
npm run build          # tsc -b && tsdown：host → lib/index.js，client → lib/client.js

# 2. 装进 profile（link 本地目录）
cd ~/Workspace/deepseek-harness
pnpm dsh plugin --profile web add link:/abs/path/to/packages/dsh-note-board
# 并把包名加进该 profile package.json 的 dsh.profile.bundles

# 3. 重启 dsh web
```

重启前建议先验证 bundle 层（缺 `dsh.bundle.patch` 声明会让 DSH 起不来），
再用 host 侧的 boot graph 确认客户端插件真的会被加载——`/plugins/<id>/client.js`
在鉴权门后面，`curl` 对能用的插件同样返回 404，证明不了任何事。

重启后：`对话 | 轨迹 | 笔记看板`。

**依赖**（peerDependencies，不打包）：`@deepseek-ai/cordis`、`dsh-client-ui-conversation`、
`dsh-client-ui-primitives`、`dsh-client-ui-slots`、`dsh-host-webserver`、
`@deepseek-ai/schemastery`、`react`、`@deepseek-ai/dsh-llm`（`createUserMessage`，用于构造上下文注入消息）。宿主侧还**必须**有 `connection` 服务（`inject` 的第三项）：
它是路由鉴权的来源，缺席时插件不会挂载（这是有意的：宁可挂不上，也不要在无法鉴别调用方时提供文件内容）。KaTeX 由 `dsh-client-ui-primitives` 的 `MarkdownText` 提供，
本包**不**自带数学渲染器。

---

## 开发

```sh
npm run build        # tsc -b && tsdown
npm run typecheck    # tsc -b --pretty false
npm run test         # vitest run
```

测试（85 条，6 个文件）覆盖的都是**踩过的坑**，不是覆盖率：

| 文件 | 守的是什么 |
| --- | --- |
| `client-props.spec.ts` | `ref` 是 React **消费**而非透传的 prop：`createElement` 会把它从 props 里摘掉，于是 `props.ref` 是 `undefined`，`=== null` 的守卫不触发，`sourceLabel(undefined)` 抛错、整块看板卸载——**症状是「本会话没有笔记」**，最误导的那种。所以这个 prop 叫 `ledgerRef`，别改回去 |
| `cwd-fallback.spec.ts` | 内存 store 里没有的会话走持久化兜底；cwd 命中缓存、miss 不缓存；服务抛错时降级为「未绑定」而不是让路由失败 |
| `ledger-fingerprint.spec.ts` | 基线跨重启存活：停机期间的编辑在恢复后第一轮仍被播报；空转变不写盘；存的是哈希不是正文；单行损坏只丢那一行；上限内读取（超限的大文件直接不可解析）、`at` 非数字即丢、`__proto__` 键被拒且原型为 null、并发写不互相覆盖 |
| `i18n.spec.ts` | 中英键集一致、无空串、英文词典里没有中文残留、每条用户可见字符串都走词典 |
| `route-trust.spec.ts` | 路由鉴权：不可信请求在**碰文件系统之前**被拒；`connection` 缺席或**抛错**都 503 失败关闭；挂载中途失败要回滚已注册路由；attach 拒绝目录/`__proto__`；共享服务 `noteLedgers.read()` 同样有界；读取只认普通文件、FIFO 不阻塞、上限被钳、按码元计数；受污染的登记表被逐键丢弃 |

---

## English

A **note board** conversation view for DSH: a third tab after *Chat* / *Trajectory* that binds a
Markdown note to **each session** (explicit attach → walk-up discovery → none), renders it with the
platform's KaTeX pipeline, and **injects the very same note** into the system prompt every turn —
announcing a per-section `[LEDGER DELTA]` when it moved, against a baseline that survives restarts.

The point is that display and injection live in **one** plugin, so "what you see is what the model
gets" holds by construction rather than by two modules agreeing. Sessions with no note say so and
land on a catalogue, because "unbound" is the state in which you are supposed to choose — never a
silent fallback to someone else's note.

Where notes live is configuration, not a convention baked into the code: `scanRoots`, `ledgerFiles`
and `auditInboxName` are overridable in a profile's own patch layer, which the loader applies after
every bundle layer.

- Licence: BSD-3-Clause
- Tests: `npm run test` (85 tests) · Typecheck: `npm run typecheck`

---

## License

BSD-3-Clause © 2026 Suxeca — 见 [LICENSE](./LICENSE)。
