# dsh-plugin-llm-verifier 移植审查结论

> 审查日期：2026-08-19 · 对照版本：插件 v0.7.2 / 论文仓库 main（LLM-as-a-Verifier）
> 材料：`/tmp/verifier-review/plugin`（uson1x/dsh-plugin-llm-verifier）与 `/tmp/verifier-review/paper`（llm-as-a-verifier/llm-as-a-verifier）

## 结论：移植正确，忠实且有据可查的偏差

插件对论文方法的移植是**正确且忠实**的，核心算法一一对应；因 DeepSeek Harness 不暴露 logprobs，把论文的「logprob 分布期望」换成了「温度采样 Monte Carlo 平均」——这是**无法避免的工程取舍**，且插件文档明确披露了此偏差。

## 逐项对照

| 论文（Python 参考实现） | 插件（JS engine） | 判定 |
|---|---|---|
| 细粒度奖励 R=(1/CK)Σφ(v)（1-20 或 A-T 分档） | `comparePair`/`score`：C 准则 × K 重复，`normalizeScore=(v-1)/(G-1)` | ✅ 公式一致 |
| `extract_score`：对 logprob 分布取期望 | Monte Carlo：temperature=1 采样 K 次取平均 | ⚠️ 偏差，等价估计（无 logprobs 的必然替代） |
| `ring_cycle` 随机哈密顿环消除槽位偏置 | `shuffle` 环 + `alternate` 槽位对调 | ✅ 语义一致 |
| `bradley_terry` σ(Ra−Rb) 软胜 | `sigmoid(Ra−Rb)` | ✅ 一致 |
| `select_pivots` top-k 按 w/c | `pivots` 按 ring 均值选 top-k | ✅ 一致 |
| `pivot_round_pairs` 非 pivot×pivot + pivot×pivot | `tournamentPairs` 同样构造 | ✅ 一致 |
| 最终 argmax w_i/c_i | 同 | ✅ 一致 |
| `track` 逐步前缀评分 | 同（每前缀 K 次独立采样） | ✅ 一致（但见下方差异） |

## 差异（均为已披露的有意变更）

1. **logprobs → 采样**：核心偏差，README 明说「Same quantity, estimated more noisily」。
2. **track 的批量**：论文把全部 checkpoint 放进**一次**调用（每重复一次）；插件每个前缀**独立调用 K 次**——更盲、更贵（文档已注明）。
3. **compare 平局**：论文无平局；插件允许 tieMargin≥0 时判 tie。
4. **prompt 形态**：论文用字母 A-T + 分布读取；插件用整数 1-20 + 标签解析。论文自己也在 README 注明用字母而非数字是为了 logprob 抽取——整数是采样方案的合理伴随。

## 插件本身质量（独立验证）

- **23 个单元测试全部通过**（`npm test`），覆盖配置校验、PPT 选择、顺序去偏、track、超时/重试、rollout 生成-判优全链路。
- **独立深检**（自写 judge 注入，非其自带 mock）：
  - `compare` 2 重复时槽位偏置消除（margin 0.658→0.842 说明偏置被对调抵消）；1 重复偏置保留——与论文「K≥2 抵消」一致。
  - `select` 在 judge 偏向槽位 A 的对抗设置下仍选出真正最优（index 2），PPT 语义成立。
  - 6 个随机环下选择结果稳定（全部选中 GOOD）。
- **依赖真实**：peerDeps 为 `@deepseek-ai/cordis/dsh-llm/dsh-tools`，devDeps 为真实官方包（`npm install` 可解析），无伪造。
- 配置 fail-loud（缺 provider/model 直接拒绝加载）、JSON 框架化防 prompt 注入、rollout 子代理禁递归、presentationMeta 纯投影可序列化。

## 遗留观察（非阻断）

- 插件把 `select` 的环判定与 pivot 判定都聚合进同一 win/count（`winMass` 累计 ring+rounds），与论文实现一致；论文另有 cache（score cache），插件无——重复调用会重复计费，工程上可后续加。
- 插件的 `track` 语义与论文 `ProgressTracker`（在线）更接近，与离线 `track`（一次批量）不同——README 已注明。

## 结论

「是否正确移植」→ **正确**。所有论文方法学要素（细粒度分布奖励、准则分解、重复评估、PPT 锦标赛、进度跟踪）都被忠实搬移；唯一实质偏差是 logprob→采样，属 DSH 平台能力限制下的合理等价替代，且已披露。插件自带测试与独立复验均通过。
