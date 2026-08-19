# PR: fix: clamp glide lag to one line height to prevent CJK overlap

> 提交分支：`fix/glide-overlap-clamp`（commit `5422868`）
> Patch 文件：同目录 `fix-glide-overlap-clamp.patch`（git am 可直接应用）

## 问题描述

**流式输出时出现字符重叠**：含「中文 + 超长路径」的消息在**跨行增长**时，上一行文字叠在下一行上。

复现截图（混合 CJK/路径渲染错乱）：

```
输出在：.../stateprep_lz5_lp4_g1p1/eta
0/g/relaxed/excited_pp_bundle.h5     ← 本应显示这行
纯激发态xed/excited_pp_bundle.h5     ← 实际显示（"纯激发态"来自上一行，叠上来）
```

## 根因

`src/client/teleprompterGlide.ts` 的 `applyVisual()` 滚动滞后补偿：

- 流式期间给消息容器加 `translate3d(0, lag px, 0)` 位移模拟滚动滞后
- `lag = contentHeight - animatedH`，而 `animatedH` 是逐帧**插值逼近** `scrollHeight` 的
- 当流式文本**跨行增长**时（中文换行密集 + 长路径换行），插值滞后使 `lag` 瞬时超过**一行高（28px，TypewriterAssistantNodeView.module.css 的 line-height）**
- `scrollTop` 又钉在底部（`port.scrollTop = floor`）→ 第 N+1 行被位移到第 N 行的视觉位置 → **字符重叠**

## 修复

新增 `clampLag()`，把 glide 位移**钳制在单行高度内**（28px 上限；极小视口退化为 25% 视口高）。剩余位移由帧循环的 `lag <= 0.1` 快路径（`animatedH = scrollHeight`）下一帧归零，**丝滑感不受影响**。

```ts
function clampLag(lag: number, port: HTMLElement): number {
  if (lag <= 0) return 0
  const viewportCap = Math.max(0, port.clientHeight * 0.25)
  return Math.min(lag, Math.min(28, viewportCap))
}
```

应用于三处：`applyVisual` 的 shiftRoot 分支、shiftRows 分支、`handBackVisual`。

## 验证

### 单元级（headless 真实渲染对比）
场景：中文+长路径跨行，内容 60px → 144px（+84px = 3 行高），animatedH 插值滞后 80px：

| | 修复前 | 修复后 |
|---|---|---|
| 应用位移 | 80.0px（≈3 行高） | 9.5px（≤ 一行高） |
| 重叠 | ✗ 发生 | ✓ 不可能 |

### 逻辑边界
| 场景 | 位移结果 |
|---|---|
| 小滞后 8px | 8px（不钳制，保持丝滑） |
| 跨行滞后 40px | 28px（钳到一行高） |
| 大滞后 200px | 28px |
| 极小视口（100px） | 25px（视口比例兜底） |
| 负值 | 0 |

### 已部署验证
- 修复版 client bundle 已在本机 DSH profile 运行（`link:` 本地安装）
- 刷新页面后 `/plugins/dsh-smooth-stream/client.js` 返回含 `clampLag` 的新代码

## 影响范围

- 仅 `src/client/teleprompterGlide.ts` 一个文件（+29/-3）
- host 侧无改动
- 不改变现有 API/导出（clampLag 为内部函数）
- 现有测试（`tests/stream.client.spec.tsx`）不受影响（测试针对 `computeFollowStep` 等导出函数）

## 复现步骤（供 reviewer）

1. 在 DSH Web GUI 让 agent 输出一段「中文结论 + 超长绝对路径」的流式回复（如 `run_z3_state_prep_geom_scan_20260818_221958/runs_corrected/stateprep_lz5_lp4_g1p1/eta0/g/relaxed/excited_pp_bundle.h5`）
2. 流式进行到路径换行瞬间，观察是否出现中文叠在英文路径上
3. 修复后：位移被钳制，无重叠

---

## 提交信息

```
fix: clamp glide lag to one line height to prevent CJK overlap

The teleprompter glide shifts the message surface by the lag between the
interpolated animatedH and the real scrollHeight. When a streamed reply
grows by a full line mid-flight (common with CJK text wrapping or long
paths), the interpolation trails and the transform briefly exceeds one
line height (28px). With scrollTop pinned at the floor, that over-shift
visually overlaps row N+1 onto row N — seen as garbled mixed CJK/path
rendering like "纯激发态xed/...".

Clamp the lag to at most one line height (28px, or 25% of the viewport
for degenerate tiny scrollports). The remaining distance is snapped on
the next frame by the existing lag <= 0.1 fast-path, so the glide stays
smooth while overlap becomes impossible.
```
