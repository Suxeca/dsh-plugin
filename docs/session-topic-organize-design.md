# 按讨论内容自动整理会话 + 接进对话地图 —— 调研与设计方案

> 调研时间：2026-09-10 ｜ 状态：**仅调研与设计，未改动任何数据或安装任何插件**
> 前置文档：[`session-organize-shortlist.md`](./session-organize-shortlist.md)（左侧栏整理插件清单）
> 分类粒度（已定）：**两级 —— 先分工作区，再在工作区内分主题**

---

## 目录

- [一、结论摘要](#一结论摘要)
- [二、生态现状：没有现成方案](#二生态现状没有现成方案)
- [三、本机画布实测：挂载点已具备](#三本机画布实测挂载点已具备)
- [四、顺带发现的 synapse bug：cardNotes 跨图串味](#四顺带发现的-synapse-bugcardnotes-跨图串味)
- [五、设计方案：两级分类](#五设计方案两级分类)
- [六、四个落点](#六四个落点)
- [七、分阶段实施计划](#七分阶段实施计划)
- [八、待决问题](#八待决问题)

---

## 一、结论摘要

| 问题 | 结论 |
|---|---|
| 有没有现成插件能"读懂每个会话在讨论什么"并自动归类？ | **没有**。npm 全库 + GitHub `dsh-plugin` topic（6000+ 仓库）+ 两份 awesome 全量清单，均无此形态 |
| 有没有人把它接进对话地图？ | **没有**。所有地图类插件（含 synapse）都是纯手动拖拽排列 |
| 那能不能做？ | **能，而且条件很好**。synapse 的 `cardNotes` + `mapState` 坐标 + 地图书架多图，三个落点全部现成 |
| 最大的障碍 | synapse 存在 `cardNotes` 跨图串味 bug，**必须先修**，否则自动写入的标签会污染所有地图 |

**核心洞察**：你**已经在手动执行"按内容做整理"这件事**——5 张地图里那些手写卡片标签（「傅里叶的误差」「忠实表示」「总结用dual表象的原因」）就是人工版的主题分类。缺的只是把这一步自动化。

---

## 二、生态现状：没有现成方案

### 2.1 检索范围（可复核）

| 渠道 | 查询 |
|---|---|
| npm registry search | `dsh session tag` / `session category` / `session classify` / `deepseek harness topic` / `dsh-plugin session group` |
| GitHub topic 搜索 | `topic:dsh-plugin` × `tag` / `classify` / `session summary` / `semantic` / `auto tag` / `session organize` / `conversation map` / `synapse` |
| awesome 全量清单 | [`kingselyjoe/awesome-dsh-list`](https://github.com/kingselyjoe/awesome-dsh-list)（1000+ 仓库按星排序）、[`beancookie/awesome-dsh-plugin`](https://github.com/beancookie/awesome-dsh-plugin) |

### 2.2 现有零件（均不足以满足需求）

| 插件 | ★ | 它能做什么 | 为什么不够 |
|---|---|---|---|
| [`xiaochaZ/dsh-session-title-summary`](https://github.com/xiaochaZ/dsh-session-title-summary) | 1 | **唯一的内容语义引擎**：监听 `agent/turn-stopping` → 起 subagent 生成「大主题-小主题」滚动大纲 → 经官方 `sessionTitle` 服务重命名会话。存 `$DSH_HOME/dsh-session-title-summary/<sessionId>.json` | 只产出标题+摘要，**不做归类分组**，不碰画布 |
| [`tuogusa/dsh-session-tags`](https://github.com/tuogusa/dsh-session-tags) | 2 | 会话标签 chip（≤32 字符、自动去重）+ `tag:xxx` 搜索。存 `$DSH_HOME/session-tags.json`；host 路由 `GET /api/session-tags`、`POST /api/session-tags/set` | **纯手动**，无 LLM 参与 |
| [`YeqingTang/dsh-session-flow`](https://github.com/YeqingTang/dsh-session-flow) | 4 | 会话档案卡墙：状态/错误/耗时 + **结论摘要行** + 首个任务；跨工作区检索、`tool:`/`file:`/`err:` 结构化搜索、全文召回 | 是「事后回顾/归档」层，无主题聚类 |
| [`WenhongPan/dsh-projects`](https://github.com/WenhongPan/dsh-projects) | 5 | 多文件夹项目、可搜索聊天、attention summaries、归档查看 | 手动建项目，无自动分类 |
| [`penguin-oo/dsh-bookmarks`](https://github.com/penguin-oo/dsh-bookmarks) | 11 | 助手回复级书签 + notes/tags + 跨会话中心 | 粒度是**消息**不是会话，且手动 |

### 2.3 对话地图生态全景（全部手动）

| 插件 | ★ | 形态 |
|---|---|---|
| [`liangmianya/dsh-synapse`](https://github.com/liangmianya/dsh-synapse) | **368** | 非线性会话画布（**你在用**，本地含增强） |
| [`Tasihi89/dsh-talk-map`](https://github.com/Tasihi89/dsh-talk-map) | 84 | 白板式会话卡片，拖拽排列 + 双击对话 |
| [`weien666/dsh-conversation-density-map`](https://github.com/weien666/dsh-conversation-density-map) | 4 | 对话密度地图（右侧历史标签） |
| [`afoxsss/dsh-conversation-map`](https://github.com/afoxsss/dsh-conversation-map) | 2 | 会话小地图 |
| [`ImCabbage/dsh-plugin-mindmap`](https://github.com/ImCabbage/dsh-plugin-mindmap) | 1 | 把对话蒸馏成持久故事线 + 交互地图 tab |
| [`haichangcharles/dsh-context-map`](https://github.com/haichangcharles/dsh-context-map) | 0 | 长程 agent 的可视上下文 |

> 无一具备「自动按主题聚类」能力。

---

## 三、本机画布实测：挂载点已具备

### 3.1 你的真实数据规模

| 指标 | 数值 |
|---|---|
| 总会话（投影缓存） | 550 |
| 已归档 | 177 |
| **未归档仍在左侧栏** | **373** |
| **超 14 天未动且未归档** | **287** |
| 零轮次空会话 | 3 |
| 无标题会话 | 10 |
| 工作区数 | 11 |

**工作区分布**（分类的第一级）：

```
dsh-plugin            166
公共/初中物理          142
Z3model               112
~（家目录）             46
Q8model                41
Workspace              20
资料参考                9
/tmp/ocgo-exp           5
/tmp/ocgo-test          4
/tmp                    3
deepseek-harness        2
```

### 3.2 synapse 数据模型（已实测）

**存储路径**

| 路径 | 内容 |
|---|---|
| `~/.dsh/synapse/maps/index.json` | `{version, activeMapId, maps[]}` —— 地图书架索引 |
| `~/.dsh/synapse/maps/maps/<mapId>.json` | `{version, id, title, createdAt, updatedAt, mapState, cardNotes}` |
| `~/.dsh/synapse/workspaces.json` | 遗留工作区数据（已被 maps 取代，保留兼容） |

**关键结构**

```jsonc
// mapState：键 = 会话 ID，值 = 卡片在画布上的关系元数据
"mapState": {
  "session-669f94a3-110b-4f6f-8242-6c847c140bbf": {
    "title": "掌握当前工作进展 (2)",
    "parentId": null,                    // 分支父节点（fork 关系）
    "sourceSeedLength": null
  }
}

// cardNotes：键 = 卡片 ID，值 = 自由文本标签
"cardNotes": {
  "loaded:session-669f94a3-110b-4f6f-8242-6c847c140bbf:turn:15197": "Q8 gauge"
}
```

**卡片 ID 推导规则**（`app.js:344`）

```js
function cardIdForTurn(threadId, turn) {
  return `${threadId}:turn:${turn.sourceSeq ?? turn.messageIndex ?? 0}`
}
// threadId 形如 `loaded:session-<uuid>`，故 cardId 可由 sessionId 直接推导
```

→ **结论：任何插件都能由 sessionId 精确算出 cardId，从而读写画布。**

### 3.3 你已有的 5 张地图（及你手写的标签）

| 地图 | 会话卡 | 卡片标签 | 你手写的标签样例 |
|---|---|---|---|
| `z3 model` | 18 | 36 | — |
| `z3 model 的benchmark` | 12 | 6 | 「总结用dual表象的原因」「两个图一起对比」「double check结果」 |
| `Q8model` | 18 | 22 | 「Q8 gauge」「忠实表示」「一维和二维的忠实表示的群论定义」 |
| `z3 model v2 discussion` | 6 | 38 | （36 条为越界 note，见第四章） |
| `z3model代码` | 5 | 3 | 「傅里叶的误差」「具体的激发态能量」「重新画图」 |

**这些手写标签就是人工版的"内容主题"**。自动化要复现的正是这个动作。

### 3.4 现存可复用机制

| 机制 | 位置 | 用途 |
|---|---|---|
| `GET/POST /synapse/api/map` | `index.js:927` | 读写当前地图的 `mapState` + `cardNotes` |
| `GET /synapse/api/maps`、`POST /maps/<id>/activate` | `index.js:899` | 地图书架翻页/新建/重命名 |
| `POST /synapse/api/sessions/sync` | `index.js:885` | 会话↔工作区同步 |
| `layoutConversationGraph()` | `app.js:1198` | 「整理节点」自动布局算法（可改造为按主题聚类的布局） |
| `ctx.effect(...)` 路由注册 | `index.js:962` | 插件热插拔的标准写法 |

---

## 四、顺带发现的 synapse bug：cardNotes 跨图串味

### 4.1 现象（实测证据）

```
43 条唯一 note  →  其中 36 条同时出现在多张地图里

跨图重复示例：
  loaded:session-669f94a3-...:turn:15197
    → 同时存在于「z3 model」「Q8model」「z3 model v2 discussion」

孤儿 note 统计（note 所属会话不在该图 mapState 中）：
  z3 model                | 19 / 36
  z3 model v2 discussion  | 36 / 38   ← 几乎整张图都是越界标签
  z3 model 的benchmark     |  0 / 6
  Q8model                 |  0 / 22
  z3model代码              |  0 / 3
```

「z3 model v2 discussion」只有 6 张会话卡，却挂了 38 条 note，其中 36 条属于根本没加载进这张图的会话。

### 4.2 根因

`app.js` 服务端状态合并逻辑（约 163–174 行）：

```js
if (notes !== null && typeof notes === 'object' && !Array.isArray(notes)) {
  for (const [cardId, note] of Object.entries(notes)) {
    if (typeof note === 'string' && note.trim() !== '') {
      state.cardNotes.set(cardId, note.trim())   // ← 无条件全量合并
    }
  }
  ...
} else if (state.cardNotes.size > 0) {
  // 服务端无记录时，把本地全部 note 上传
}
```

回写时（`app.js:98`）又整份提交 `state.cardNotes`：

```js
const notesPayload = Object.fromEntries([...state.cardNotes.entries()])
body: JSON.stringify({ map: mapPayload, notes: notesPayload })
```

**合并是全局累加、提交是整份覆盖** → 切换地图时 A 图的 note 被带进 B 图并持久化，从此永久串味。

### 4.3 影响与修复方向

| 项 | 说明 |
|---|---|
| 影响面 | 5 张地图中 2 张已被污染（`z3 model` 19 条孤儿、`z3 model v2 discussion` 36 条孤儿） |
| 对自动化的影响 | **必须先修**——否则自动写入的主题标签会瞬间串遍所有地图，方案直接失效 |
| 修复方向 | ① `cardNotes` 按 mapId 隔离命名空间；或 ② 合并时校验 `cardId` 所属 session 是否在当前 `mapState` 内，越界者不并入、不回写；③ 一次性清洗：按各图 `mapState` 反查，删除孤儿 note |
| 归属 | 属 synapse 本地增强（仓库已有 PR #5 等本地改进先例，可一并提上游） |

> 注：清洗需先备份 `~/.dsh/synapse/maps/`，且需你确认「孤儿 note 是误串还是有意保留的跨图参考」——后者概率低，但涉及删数据，必须你拍板。

---

## 五、设计方案：两级分类

### 5.1 分类粒度（已定）

```
Level 1  工作区         ← 直接复用 DSH 原生 cwd 归属，零成本、稳定
   └─ Level 2  主题      ← LLM 在单个工作区内聚类
```

**为什么这个粒度对**：
- 工作区是**天然且稳定**的一级边界（你已有 11 个），不需要 LLM 判断，也不会漂移
- 同一工作区内的会话上下文高度同质（如 `Z3model` 全是格点模型），**主题聚类在簇内更准**
- 避免全局聚类把「物理」和「插件开发」混到一起

### 5.2 分类输入特征

| 特征 | 来源 | 成本 |
|---|---|---|
| 会话标题 | `~/.dsh/storages/session_projcache.json` → `rows.title.val` | 零（DSH 已由 `session-title-llm` 生成） |
| 首轮用户消息 | 同上 / 会话 JSONL | 低 |
| 轮次/工具统计 | `rows.sessionStats.val`（turns/steps） | 零 |
| 创建/最后活动时间 | `rows.identity.createdAt` | 零 |
| 深度内容 | `session.jsonl.zstd`（zstd 解压） | 高，仅在标题不足以判断时按需取 |

> **默认只用标题 + 首轮消息**：550 个会话按 20–30 条/批送 LLM，约 20–30 次调用即可完成，成本极低。

### 5.3 产出物

```jsonc
// topics.json
{
  "version": 1,
  "generatedAt": "2026-09-10T...",
  "workspaces": {
    "/home/suxeca/Workspace/Z3model": {
      "sessionCount": 112,
      "topics": [
        {
          "id": "topic-lattice-model",
          "label": "格点模型与张量网络",
          "keywords": ["DMRG", "忠实表示", "激发态"],
          "sessionIds": ["session-...", "session-..."]
        }
      ],
      "unclassified": ["session-..."]
    }
  }
}
```

配套一份**可视化报告**（Markdown / HTML）：按工作区分节的树状结构，每个主题下列出会话标题+日期，附「未归类」与低置信度区，供人工复核。

### 5.4 分类引擎选型

| 方案 | 说明 | 评价 |
|---|---|---|
| **A. 离线脚本 + 现有 LLM 路由** | 直接读投影缓存批量分类，产出 `topics.json` | ✅ **推荐 Stage 1**：零插件、零风险、可反复调参 |
| **B. 复用 `dsh-session-title-summary` 的机制** | subagent + `agent/turn-stopping`，增量维护 | ✅ 适合 Stage 2 做**增量更新**（新会话自动归类） |
| **C. 独立守护循环插件** | timer 驱动定期全量重分类 | ⚠️ 550 会话全量重跑浪费，仅作兜底 |

**推荐组合**：Stage 1 用 A 做全量基线 → Stage 2 用 B 做增量维护。

---

## 六、四个落点

分类结果可写入以下位置，**可自由组合**：

### 落点 A：`cardNotes` —— 卡片直接显示主题标签

```jsonc
"cardNotes": {
  "loaded:session-<uuid>:turn:<seq>": "【格点模型】忠实表示"
}
```

- ✅ 视觉最直接，卡片上立刻看到主题
- ⚠️ **依赖第四章 bug 先修复**
- ⚠️ 会覆盖你现有手写标签 → 需要设计前缀或独立字段区分「人工」与「自动」

### 落点 B：`mapState` 坐标 —— 画布空间聚类 ⭐

改造 `layoutConversationGraph()`，让布局按 `topic` 分块：

```
┌─────────────┐  ┌─────────────┐
│  格点模型    │  │  张量网络    │
│  [卡][卡]    │  │  [卡][卡]    │
│  [卡]        │  │  [卡]        │
└─────────────┘  └─────────────┘
┌─────────────┐
│  代码/性能   │
│  [卡][卡]    │
└─────────────┘
```

- ✅ **最贴合你的诉求**——"结合对话地图做整理"，打开画布即是按主题整理好的
- ✅ 主题标题可作为画布上的分区标签渲染
- ⚠️ 注意：手动拖拽过的卡片位置会被覆盖 → 需提供「保留手动位置」开关

### 落点 C：地图书架多图 —— 一个主题一张地图

- ✅ 机制完全现成（`/synapse/api/maps` 新建 + `activate`）
- ✅ 天然契合你已按主题分图的习惯（`z3model代码`、`z3 model 的benchmark` 已经这么用了）
- ⚠️ 地图数量会膨胀，需要「主图聚合 + 子图细分」策略

### 落点 D：左侧栏 —— 浏览时也能用

| 路径 | 说明 |
|---|---|
| 配 `dsh-session-tags` 写 `session-tags.json` | 复用其 `tag:xxx` 搜索，成本低 |
| 自建侧栏分组插件 | 完全可控，但工作量大 |

---

## 七、分阶段实施计划

### Stage 1：离线验证分类质量（零风险）

| 项 | 内容 |
|---|---|
| 做什么 | 读 550 个会话的标题+首轮 → LLM 两级聚类 → 产出 `topics.json` + 可视化报告 |
| 不做什么 | **不装插件、不写 synapse、不改任何数据**（纯只读） |
| 产出 | 一份报告，按工作区分节展示主题聚类结果 |
| 验收 | 你看报告判断分类准不准、粒度合不合适 |
| 回滚 | 无需回滚（只新增一个报告文件） |

### Stage 2：修复 synapse 串图 bug

| 项 | 内容 |
|---|---|
| 前置 | 备份 `~/.dsh/synapse/maps/` + 你确认孤儿 note 的处理方式 |
| 做什么 | ① 修 `app.js` 合并逻辑；② 一次性清洗 5 张地图的越界 note |
| 验收 | 各图 `cardNotes` 不再跨图出现；切换地图后刷新仍隔离 |

### Stage 3：插件化 —— 分类写回画布

| 项 | 内容 |
|---|---|
| 形态 | 注入器插件（`dev_scaffold_plugin` → `dev_build_plugin` → `dev_inject_plugin`） |
| 能力 | 读 `topics.json` → 按落点 B 空间聚类 + 落点 A 标签 → 提供「按主题整理」按钮 |
| 增量 | 借 `agent/turn-stopping` + subagent，新会话自动归类 |
| 交付 | 免重启注入、可热重载、卸载即净 |

### Stage 4（可选）：落点 C/D 扩展

- 一个主题一张地图
- 左侧栏 `tag:xxx` 联动

---

## 八、待决问题

| # | 问题 | 需要你决定 |
|---|---|---|
| 1 | 分类准不准、粒度合不合适 | Stage 1 报告出来后判断 |
| 2 | 孤儿 note 是误串还是有意保留？ | 决定 Stage 2 清洗策略（涉及删数据） |
| 3 | 自动标签与手写标签如何共存？ | 前缀区分 / 独立字段 / 自动只填空白卡片 |
| 4 | 画布重排是否覆盖手动拖拽位置？ | 决定落点 B 的开关设计 |
| 5 | 落点优先级（A/B/C/D） | 决定 Stage 3 实现顺序 |
| 6 | 是否把 synapse 修复提回上游 | 你已有 PR #5 先例 |

---

## 附：关键路径速查

```
会话投影缓存      ~/.dsh/storages/session_projcache.json
逐会话投影        ~/.dsh/storages/session_projcache/sessions/<sid>.json
归档状态          ~/.dsh/storages/workspace.json → global.archivedSessionIds
会话正文          ~/.dsh/sessions/<cwd-slug>/<sid>/session.jsonl.zstd
synapse 书架      ~/.dsh/synapse/maps/index.json
synapse 地图      ~/.dsh/synapse/maps/maps/<mapId>.json
synapse 源码      ~/Workspace/dsh-plugin/third-party/dsh-synapse/
  ├─ map-store.js   MapDirectoryStore（地图持久化）
  ├─ index.js       host：/synapse/api/* 路由
  ├─ app.js         画布渲染 + 布局 + note 合并（bug 在此）
  └─ client.js      与 DSH 主客户端桥接
```
