# 集成：任务模式分流（`ctx.typesafeRouter`）

`ctx.typesafeRouter` 把「这条用户消息属于哪种工作模式」变成一次 `choice` 判断，
给上层路由（preset 行）一个**带概率、带降级路径**的输入。

它是**可选增强**：默认关闭，任何失败都返回 `undefined`，绝不阻断主流程。

> **模式轴由调用方定义，不是插件写死的。** 插件只提供内置的 `coding` 档
> （react / spec / chat）；一个 preset 关心什么轴（例如理论物理的
> 「例行改动 vs 形式审计」），由它自己带档位进来。理由：轴不同、判据不同、
> 连提问语言都不同，插件不该替调用方猜。

## 1. 打开它

分流服务只有在 `router.enabled` 为真时才 `provide` 到总线上
（装配层用 `ctx.provide('typesafeRouter', ...)`，关闭时撤销）。所以调用方
必须先软探测：

```ts
// 软探测：缺席时 undefined。不要写进 inject（那会把 preset 行卡在 waiting，
// 而它本该在插件缺席时照常工作）
const router = ctx.get('typesafeRouter')
if (router === undefined) return
```

打开方式二选一：

```bash
# 走设置命名空间（applies: 'live'，立即生效）
curl -sS -X POST http://127.0.0.1:3080/typesafe/settings \
  -H 'content-type: application/json' \
  -d '{"patch":{"router":{"enabled":true,"timeoutMs":2000}}}'
```

或在设置页把「任务模式分流」打开。`router.timeoutMs` 默认 `2000`。

## 2. 契约

```ts
export interface RouterProfile {
  readonly id: string
  readonly instructions: string                        // 提问正文（本轮文本追加在最后）
  readonly criteria: Readonly<Record<string, EntryType>>  // 模式 key → 判据，至少 2 项
}

export interface RouterVerdict {
  readonly mode: string                                 // 档位定义的 key，不限三种
  readonly confidence: number
  readonly probabilities: Readonly<Record<string, number>>
  readonly cached: boolean
  readonly model: string
  readonly profile: string                              // 实际使用的档位 id
}

export interface TypesafeRouterService {
  classify(text: string, options?: {
    readonly signal?: AbortSignal
    readonly profile?: RouterProfile   // 缺省用内置 coding 档
  }): Promise<RouterVerdict | undefined>
  readonly profiles: readonly string[]  // 内置档位 id（目前只有 'coding'）
}
```

`probabilities` 的键与档位 `criteria` 的键一一对应（缺失的补 0，
档位外的 key 一律丢弃）。

## 3. 语义与失败面

- 内置 `coding` 档的三条判据（`CODING_PROFILE`，字符串常量导出，便于文档与测试对齐）：
  - `react` —— 要**直接动手做出来**：新功能、新脚本、新目录、新插件；
  - `spec` —— 要**先搞清楚再动手**：修已存在的缺陷、排查失败、按既定约束改现有系统；
  - `chat` —— 要**解释、比较、判断或闲聊**：概念问答、方案讨论、评审意见、数据解读。
- 输入处理：`text` 先 `trim()`，空串直接返回 `undefined`；进入判据的文本截到 4000 字符。
- 调用参数：`label: 'router:<档位 id>'`、`timeoutMs = router.timeoutMs`、
  `maxRetries: 0`、`signal = options.signal ?? AbortSignal.timeout(budget)`。
- 返回 `undefined` 的五种情况：文本为空、档位不合法（选项少于 2 个或提问为空）、
  答案不在档位选项内、抛异常（含超时）、服务不在场。
  **调用方必须把 `undefined` 当作「没有意见」，回落到自己的默认路由。**
- **`confidence` 是分布集中度，不是「它对不对」**。判据区分度好时它会给出 1.00；
  边界样例（例如一句话既可能是例行查看、也可能是一个要写进账本的断言）会给出
  `p≈0.6` 的倾向值。把倾向值当硬指令，等于让一次掷硬币决定整轮工作的纪律。

## 4. 用法：两层，别混用

```ts
// ① 轻量：编码轴，用内置档位
const verdict = await ctx.get('typesafeRouter')?.classify(userText)
if (verdict !== undefined && verdict.confidence >= 0.7) routeTo(verdict.mode)
else routeTo(defaultMode)

// ② 自定义轴：把判据带进来（档位属于调用方，不属于插件）
const verdict2 = await router.classify(userText, { profile: MY_PROFILE })
```

## 5. 实测参考实现：`z3-theory-research` 的 A/B 分流

本部署里已落地一个真实用例，可直接照抄：
`~/.dsh/.agent-presets/z3-theory-research/mode-router.mjs`（约 220 行，零外部依赖）。

它的做法与踩过的坑，按顺序：

1. **在 `session/event` 里发起判断，在 `system-prompt/assemble` 里取用**。
   首次装配发生在用户消息落进 `session.events` **之前**（router-standard 的 issue #3），
   装配时才去读 transcript 会读到空历史。所以：消息事件里 `classify()` 并在
   `.then()` 里存结论，装配时只做**有界等待**（`Promise.race` + `budgetMs`，默认 1500ms）。
2. **只在真人消息上跑**：`event.data.source.kind !== 'user'` 直接跳过，
   否则工具结果与注入内容也会触发分流（既浪费钱，又会把模式来回拨）。
3. **同文本去重**：结论按 `session.id → { mode, text }` 记住，文本未变不再问。
4. **不替换 persona，只插一段**：`sections.filter(s => s.name !== SECTION)` 后
   在数组最前面插 `{ name: SECTION, text, order: 0 }`，其余原样保留
   （与 router-standard 的 `applyPersona` 同一手法，但不动 persona 本体）。
5. **三态指令**：`p >= 0.5` 时给硬指令（「本轮按 Mode B 处理」）；低于阈值时给
   倾向指令（「接近平分，先花一行自陈本轮是否触及定义可观测量/物理断言/写账本，
   然后自己定」）。偏差方向刻意选保守：模糊时倾向审计模式——判错成审计只多花严谨，
   判错成例行可能让未验证的结论进账本。
6. **人工兜底**：注册一个 `z3_mode` 工具（读状态 / 锁定 / `auto` 交回自动）。
   概率判断必然偶发失误，出口不能依赖模型自己「觉察」。
7. **零外部 import**：preset 行的裸模块说明符从用户 home 解析，那里没有
   `@deepseek-ai/*`，所以工具 schema 自己内联编译（见该文件的 `toJsonSchema`）。

实测（对 5 条真实消息，档位判据照抄 persona 的 A/B 触发条件）：

| 消息 | 结果 |
| --- | --- |
| 「把 fig3 的 y 轴标签改成 $a\Delta E$，重跑画图脚本」 | `agile` p=1.00 |
| 「squeue 看一下我的作业排到哪了」 | `agile` p=1.00 |
| 「把这次 fit 的 gap 写进 verified.csv，并把这个 run 从 diagnostic 晋级」 | `audit` p=1.00 |
| 「我们重新定义可观测量：把 P_y 当成本模型的宇称，讨论 C=-1 扇区的量子数」 | `audit` p=1.00 |
| 「这个 gap 收敛了吗？」 | 倾向 `audit`（agile 0.42 / audit 0.58，p=0.17）→ 走倾向分支 |

## 6. 注意事项

- 每次分流是一次网络往返（实测 250–610ms）。**只在需要的地方用**：
  z3 那种「每轮都可能换模式」的会话值得逐轮跑；只在首轮决定 persona 的场景
  （router-standard）跑一次就够。
- `maxRetries: 0`：分流是延迟敏感的增强项，超预算就放弃，别重试堆积。
- **模式切换应来自「这条消息要做什么」，不要来自关键词**：同一个 `rm` 打在
  `/tmp` 和打在 `runs/` 下性质完全不同——这正是要用语义判断而不是正则的理由。
- 分流结论是概率判断，不是确定性路由。**用户明确指定的模式永远优先**，
  人工锁定（`z3_mode`）优先级最高。
- 需要批量分类多条文本时，直接用 `ctx.typesafe.evaluate()` 一次问完，
  比逐条 `classify` 便宜一个数量级。
- 改了 preset 里的 `.mjs` 后，**新会话**才拿到新版本（模块在挂载时加载）；
  存量会话要么重开，要么等 preset 重挂。
