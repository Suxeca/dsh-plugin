# @suxeca/dsh-note-board

**笔记看板** —— 给 DSH 对话视图加第三个标签页，把「一份 Markdown 笔记 + 它的对抗审计判决」变成会话的一部分。

它在 `对话 | 轨迹` 之后注册 `笔记看板`，三件事一起做：

1. **看** —— 用平台自带的 KaTeX 渲染笔记正文（不自带数学渲染器）
2. **绑** —— 笔记**按会话绑定**：显式附加 / 从工作目录自动发现 / 不绑
3. **注** —— 自动提供常驻知识与按需目录，知识变化时发 `[LEDGER DELTA]`；运行日志不自动注入

它不限定课题：任何需要跨会话保持定义、结论与证据一致的 Markdown 知识库都适用。
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

### 知识库与运行日志：两个入口，两套规则

| 页签 | 内容 |
| --- | --- |
| **笔记目录** | 按项目发现或显式附加一份 Markdown 知识库；绑定仅影响本会话 |
| **知识库** | 定义、公式、结论、适用条件、关键证据和开放问题；Markdown + KaTeX。显示全部已读取的非日志节，不仅是常驻节 |
| **运行日志** | 只显示明确分类的日志节及其中的路径/链接。供复现、查证、排错；不自动注入，也不自动扫描或复制原始运行日志 |
| **审计判决** | 独立的审计收件箱；保留既有查看行为 |

**知识与过程不同**：一次运行完成不等于产生新知识。只有形成新结论、修正已有认识或明确开放问题时才更新知识库，并链接相应证据。条目应标明「已确认 / 待验证 / 已否决 / 已被替代」，收录本身不代表已证实。

这是兼容现有单文件笔记的分类视图，不搬动、不重写研究文件。`## RUN-LOG*`、`## EXECUTION-LOG*`、`## JOURNAL*` 和旧 `## MUTATION-LOG` 默认归入运行日志。其它节不凭正文含义自动归类，`TASK-1` 等旧任务节仍需人工整理，或显式配置 `runLogSections`。

最小运行日志入口：

```markdown
## RUN-LOG · 运行日志
- 目的：验证结论 K 的有限尺寸效应
- 代码版本：<revision>；配置：runs/example/config.json
- 结果：runs/example/result.json；原始日志：runs/example/stdout.log
- 对应知识条目：VERDICT-1（待验证）
```

可以只记录路径，不需要再写一遍过程。当前源码不能证明过去跑了什么，所以至少保留版本、配置和结果身份。入口中的外部文件**不会被自动展开**；排错或复现时用会话的文件工具读取。

### 超过 6000 如何处理

`injectBudget: 6000` 是**常驻正文的软预算，不是知识库存储上限**：

1. 前言 + `pinnedSections` 选中的知识节整段常驻。超过预算仍完整提供；无 `##` 的旧笔记也不按 6000 硬切。
2. 其它知识节保留在文件与看板中，自动上下文仅列 ID、标题和源文件路径。回答涉及某条目时，要求先读取完整正文及依赖、条件、证据；被文件工具截断时必须继续读取。
3. 运行日志既不进入常驻正文，也不进入知识目录或变更通知。新增、追加、删除日志节不会触发正文重投（同一文件仍在文件读取安全上限内时）。日志分类优先于 `pinnedSections: ['*']`。
4. 知识变更通知只点名变更并使旧副本作废，**不再附上正文或截断片段**，避免把按需知识又从通知渠道全部塞回去。

### 内容边界：笔记是「定义」，不是「记忆」

这个插件最贵的一种误用不是超预算，而是**把记忆写进知识库**：某次运行发现设备坏了、某个算法走不通、某个作业为什么失败——这些当时有效、质量也不高的观察，一旦写成知识条目，就会**每轮被当作框架性约束注入**，于是后来的发散工作被当初的结论绑住。这类内容应该进运行日志，或者进会话记忆工具（deja / memsearch）。

插件对此做三件事，都只做可见性与提醒，**不自动改写你的笔记**：

1. **读的一侧**：注入正文的抬头里写明本笔记只承载框架级、决定性内容，并指明过程记录该去哪里；
2. **写的一侧**：`[LEDGER DELTA]` 在**变化的节读起来像一次运行的记录**时，额外给出一段 `[内容边界]` 提醒（挂在同一条通知上，不新增投递），告诉写作者把它移到 `## RUN-LOG …` 或会话记忆；
3. **看的一侧**：看板「知识库」页顶部折叠的**内容边界（按节）**列出每节 ID、分类、字符数、是否变更，并把**疑似过程记录**的节排在前面、附上触发它的词；`/note-board status` 报同一份。

判定是**启发式，不是判决**（`src/host/hygiene.ts`，规则与词表都在那里）：

- **只有日期不会触发**——`（2026-09-26 定稿）`、`2026-09-26 用户裁决` 是某种程度的出处标注，冻结条目本来就该带；
- 单个「失败」也不会触发——判决说「FAIL 不等于物理失败」是正常的；
- 要成簇才触发：故障/不可行类词 ≥3，或它们与「本次/当时/实测/尝试」这类叙事 ≥3 且同时出现，或它们与运行产物引用同时成簇。

用真实 Z3 账本校准的结果：FROZEN-1/2、VERDICT-1-V1…V9、OPEN、RULES、STAGE1-EVIDENCE **全部不误报**；被标出的是 `FROZEN-3`（含 9×4/4×3 实测叙述）与 `TASK-1`（任务清单）。日志节永远不标——日志本来就是这类记录的正当去处。

### 预算明细

同一份列表里也带每节字符数与「自上次已注入以来是否变化」（与 `[LEDGER DELTA]` 同一份哈希）。**字符数不是重点**：能改变行为的是上面那条内容边界。

### 按知识条目读取：`note_board_read`

模型通过 `note_board_read({ section_id: 'OPEN-1' })` 读取本会话绑定的一个知识条目，不再为了找一个条目默认拉取整份混合文件。

- 会话身份与工作目录来自工具的真实调用 Agent；参数不接受其它会话 ID 或任意文件路径。
- 只返回精确 ID 对应的非日志知识节；日志节与歧义重复 ID 被拒绝。关闭本会话注入时，这个专用读取通道也关闭。
- 大条目按有界分页返回；按 `continuation.offset` 和 `continuation.revision` 续读，直到 `complete: true`。文件版本变化则丢弃旧页，从头读取，不能拼接两个版本。
- 如果文件读取安全上限导致无法确认完整条目，结果会明确报告缺口，不能把部分内容当作完整知识。
- 不自动展开原始日志路径，也不自动解析/装载依赖；模型仍须根据条目实际内容读取所需依赖。

**能力边界**：这是专用的按条目读取工具，不是语义检索或自动依赖装载。目录指引优先使用它；并未禁止普通文件工具，因此模型主动整文件读取时仍可能读到同文件日志。要进一步减小这种风险，应让运行日志入口只保留路径，原始日志独立存放。工具不可用、条目或依赖未读齐时，应报告缺口，不能声称核对完成。完整知识库不等于每次完整注入，也不等于保证模型正确使用。

### 实际注入范围与预览

界面显示后端按同一选择规则算出的：常驻字符数、常驻节数、按需知识节数、运行日志节数；可展开**下一次装配的准确文本预览**。它不是已送达或模型已使用的证明。字符按 JavaScript UTF-16 code units 计，说明头与目录另有开销，软预算并不约束整个消息的总长度。

`maxBytes`（历史名称，实际按字符计）是**另一个文件读取安全上限**，不是 6000。文件超过它时，看板明确标注视图不完整；自动注入只发缺口提示，不把半截定义标成最新知识，也不据部分文件生成删除通知或更新指纹基线。源文件不受修改，需用文件工具分段读取。较大的日志最好只在入口留下路径，不在同一个 Markdown 里无限堆正文。

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

`section` 通道在 `system-prompt/assemble` 中组装正文；`snapshot` 通道在可等待的 `agent/pre-step` 中读取并把最新正文放进**当前步骤**的消息列表。两者的变更通知也通过当前 pre-step 一起进入，不再从装配阶段排入下一步 inbox。

框架顺序是 `claim → assemble → pre-step → commit → model`。因此 snapshot 必须直接合并到 pre-step 的 `enter.messages`：本插件上下文在当前真人问题之前，真人问题和其它插件消息保留，不让新笔记把问题挤成上一条。拒绝、取消或被下游清空的步骤不会被本插件重新唤起。

`placement` 只影响 section 的呈现位置。**呈现顺序不是权限优先级**；默认后置，不把笔记当成高于 persona 的指令。

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

`delivery: 'snapshot'` 把同一份正文改投成 **durable user-role 快照**（`source: {kind:'plugin', form:'snapshot', sections}`）。快照追加在保留历史之后、当前问题之前。内容变化时，在当前 pre-step 补入；被 compaction 丢掉后，在下一次实际进入的步骤中补回。

去重比较**最新保留的快照**，不能因为历史里存在旧 A 就漏掉 `A → B → A` 中的新 A。未提交候选不视为已送达；提交事件释放在途标记，取消/结束时丢弃未送达候选。指纹基线也仅在对应消息 commit 后保存，避免被拒绝的步骤吞掉变更通知。历史依然只追加，会同时留有新旧正文，最新版本说明与作废通知仍然必要。

不再依赖异步 `agent/session-start` 抢先排队，也不在同步 `turn/start` 回调中重入追加会话记录。

两条通道**投递的文本完全相同**（同一段 header + 正文，测试里直接比对过），差别只在通道。默认 `'section'`：它给出的是不依赖历史与压缩的每轮保证。

**两条通道，各取所长**：

| 内容 | 通道 | 为什么 |
| --- | --- | --- |
| 笔记**正文** | system-prompt section 或当前 pre-step snapshot | 两者使用同一份选择结果；snapshot 在内容变化或被压缩丢弃后补入当前步骤 |
| **变更通知** `[LEDGER DELTA]` | 当前 pre-step 的 `form: 'notice'` 消息 | 点名变化、作废旧副本，与当前问题同一步进入；不把正文或日志再复制一遍 |

`source.kind` 使用封闭集合中的 `'plugin'`，不自造来源种类。选择 snapshot 是保留上下文前缀的成本权衡，不再以「允许晚一模型步」作为代价。

系统提示里注入的 section：

- `note-ledger` —— 正文，带 `[FROZEN LEDGER]` 抬头（「不得在未显式声明 `[SYMBOL MUTATION]` 的情况下改写」）
- `[LEDGER DELTA]` —— 仅当知识指纹变了：`新增 / 被替换 / 被删除` 逐节点名，声明旧副本作废，并要求读取完整最新条目；不附新正文

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
  inject.ts       section 组装 / pre-step snapshot + commit 后基线
  entry-read.ts   会话绑定的 note_board_read 知识条目读取工具
  fingerprints.ts 持久化基线（sha1/节，原子写，上限 512 会话）

client（浏览器）
  index.ts      slots.register('conversation.view', { id, order: 20, label: thunk })
  Body.tsx      知识库/运行日志/目录/审计、绑定栏、注入范围预览、错误边界
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
| GET | `/state?sessionId=` | **只要绑定状态**（`ref` + `exists` + `enabled`），不含正文；给输入框上方的常驻入口轮询用 |
| GET | `/audits?sessionId=` | 审计收件箱（只读最新的 `auditLimit` 份） |
| GET | `/known` | 曾经附加过的路径（切换器用，上限 256 条） |
| GET | `/catalog?sessionId=` | 机器上的笔记目录（含实际使用的候选文件名） |
| POST | `/attach` `{ sessionId, path }` | 显式绑定；路径不存在/不是普通文件返回 400 而不是 500 |
| POST | `/detach` `{ sessionId }` | 退回自动发现 |
| POST | `/injection` `{ sessionId, enabled }` | 按会话的注入开关；关闭时同时注入一条作废声明 |

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

**更新已存在的条目时，要明确替代旧版，而不是只在末尾追加更正。**否则常驻或按需读取时仍可能同时读到互相矛盾的两版；需要保留历史时标注「已被替代」并链接当前条目。

---

## 配置

全部有默认值，**默认即可用**。部署相关的路径留在**你自己的 profile patch 层**里，
不要写进这个包的 `cordis.patch.yml`——loader 会在每个 bundle 层之后应用 profile 层，所以覆盖是安全的。

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `registryPath` | `''` → `${DSH_HOME:-~/.dsh}/note-boards.json` | 附加登记表 |
| `maxBytes` | `262144` | **字符**上限：既截断返回正文，也约束底层读取（≤ `maxBytes*4+4` 字节）；硬钳 4M |
| `auditLimit` | `20` | 审计判决最多列几条（上限 500；只读最新的 N 份） |
| `injectBudget` | `6000` | 注入的**软上限**：超出会在正文里明说。固定节永不为凑预算被丢弃 |
| `scanRoots` | `[]` → `~/Workspace` | 目录扫描根 |
| `scanDepth` | `3` | 向下层数（3 层刚好到 `<workspace>/<项目>/notes/`，不会走进源码树；上限 8，不跟随符号链接目录） |
| `catalogTtlMs` | `30000` | 扫描结果缓存时长（上限 10 分钟） |
| `ledgerFiles` | `[]` → `['notes/ledger.md', '.notes/ledger.md', 'ledger.md']` | 逐级向上查找的相对路径，按顺序 |
| `pinnedSections` | `['FROZEN*', 'RULES', 'VERDICT*']` | 整节常驻的知识 id（精确或 `前缀*`）；其它知识仅列目录，变化只发读取提醒。`['*']` 也不会携带已分类日志 |
| `runLogSections` | `['MUTATION-LOG', 'RUN-LOG*', 'EXECUTION-LOG*', 'JOURNAL*']` | 运行日志分类，优先于常驻规则；不注入正文、不发变更通知。只影响分类，不移动文件 |
| `auditInboxName` | `''` → `.note-audit-inbox` | 审计收件箱目录名（位置固定在笔记同级） |
| `placement` | `'last'` | 注入 section 落在 `'first'` 还是 `'last'`；仅影响呈现顺序，不影响权威 |
| `delivery` | `'section'` | 正文走哪条通道：`'section'` 渲染进系统提示；`'snapshot'` 作为 durable user-role 快照投递（见下） |

注入开关不是配置项——它是**按会话**的运行时状态（`POST /note-board/api/injection`），写在 registry 里。三个入口写的是同一份状态：

| 入口 | 什么时候能用 |
| --- | --- |
| **输入框上方的常驻行**（`conversation.input.dock`） | 一打开新对话就有——这是唯一在**发出第一条消息之前**就存在的界面入口。没有绑定笔记的会话不显示它 |
| **看板绑定栏** | 标签页出现之后（会话已经存在时） |
| **`/note-board off丨on丨status`** | composer 里随时可用；`status` 是纯文本通道，看板渲染坏掉时仍然能回答「绑的是哪份、要注入什么」 |

**关闭的是注入，不是显示。** 关掉之后看板照常显示这份笔记正文（那是给你回顾用的），并且会说明它原本绑的是哪一份；只有模型上下文不再收到它。


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

测试覆盖行为契约与回归风险，不只追求覆盖率；实际条数以 `npm test` 输出为准：

| 文件 | 守的是什么 |
| --- | --- |
| `client-props.spec.ts` | `ref` 是 React **消费**而非透传的 prop：`createElement` 会把它从 props 里摘掉，于是 `props.ref` 是 `undefined`，`=== null` 的守卫不触发，`sourceLabel(undefined)` 抛错、整块看板卸载——**症状是「本会话没有笔记」**，最误导的那种。所以这个 prop 叫 `ledgerRef`，别改回去 |
| `cwd-fallback.spec.ts` | 内存 store 里没有的会话走持久化兜底；cwd 命中缓存、miss 不缓存；服务抛错时降级为「未绑定」而不是让路由失败 |
| `ledger-fingerprint.spec.ts` | 基线跨重启存活：停机期间的编辑在恢复后第一轮仍被播报；空转变不写盘；存的是哈希不是正文；单行损坏只丢那一行；上限内读取（超限的大文件直接不可解析）、`at` 非数字即丢、`__proto__` 键被拒且原型为 null、并发写不互相覆盖 |
| `i18n.spec.ts` | 中英键集一致、无空串、英文词典里没有中文残留、每条用户可见字符串都走词典 |
| `sections.spec.ts` | 知识/日志分类、日志优先于通配常驻、代码围栏内标题不误分类、整节保真、软预算与硬读取上限分离 |
| `entry-read.spec.ts` | 真实工具注册、会话隔离、off 与日志拒绝、歧义 ID、分页前进与 Unicode 边界、版本变化与文件读取上限 |
| `injection-view.spec.ts` | 界面显示真实注入范围与预览，不把全文长度当注入长度、不声称模型已读；运行日志独立入口 |
| `route-trust.spec.ts` | 路由鉴权：不可信请求在**碰文件系统之前**被拒；`connection` 缺席或**抛错**都 503 失败关闭；挂载中途失败要回滚已注册路由；attach 拒绝目录/`__proto__`；共享服务 `noteLedgers.read()` 同样有界；读取只认普通文件、FIFO 不阻塞、上限被钳、按码元计数；受污染的登记表被逐键丢弃 |

---

## English

A **note board** conversation view for DSH: a third tab after *Chat* / *Trajectory* that binds a
Markdown note to **each session** (explicit attach → walk-up discovery → none), renders it with the
platform's KaTeX pipeline, and separates **Knowledge base** from **Run logs**. Resident knowledge
and an on-demand title index share one selection policy and an exact next-assembly preview.
The 6000-character budget is soft: whole resident entries are not sliced. Run-log sections never
enter automatic bodies or change notices, even with wildcard pinning. Knowledge changes invalidate
old copies without copying new bodies. The session-bound `note_board_read` tool returns only the
requested knowledge section, never log sections, with bounded revision-checked pagination.
Snapshots and notices enter the awaited pre-step decision before the current question, rather than
being queued one model step late. Rejected/uncommitted steps do not advance the fingerprint baseline.
This is not automatic semantic retrieval or enforced dependency loading; ordinary file tools remain
available and can still read mixed files if explicitly used.

A separate file-read safety cap bounds I/O. When exceeded, the view is marked incomplete and
injection carries a warning rather than partial authoritative knowledge. No source note is rewritten.
Sessions with no note say so and land on the catalogue; bindings never silently fall back to someone
else's note.

Where notes live is configuration, not a convention baked into the code: `scanRoots`, `ledgerFiles`
and `auditInboxName` are overridable in a profile's own patch layer, which the loader applies after
every bundle layer.

- Licence: BSD-3-Clause
- Tests: `npm run test` · Typecheck: `npm run typecheck`

---

## License

BSD-3-Clause © 2026 Suxeca — 见 [LICENSE](./LICENSE)。
