# smooth-stream 字符重叠修复记录（2026-08-19）

## 现象
流式输出中，含「中文 + 超长路径」的消息在**跨行增长**时出现字符重叠（如路径 `0/g/relaxed/excited_pp_bundle.h5` 被渲染成"纯激发态xed/..."——上一行中文叠在下一行英文路径上）。

## 根因
`src/client/teleprompterGlide.ts` 的 `applyVisual()` 滚动滞后补偿：
- 流式期间给消息容器加 `translate3d(0, lag px, 0)` 位移模拟滚动滞后
- `lag = contentHeight - animatedH`，而 `animatedH` 逐帧**插值逼近** `scrollHeight`
- 当流式文本**跨行增长**时（中文换行密集 + 长路径换行），插值滞后使 `lag` 瞬时超过**一行高（28px）**，`scrollTop` 又钉在底部 → 第 N+1 行被位移到第 N 行视觉位置 → 字符重叠

## 修复
新增 `clampLag()`，把 glide 位移**钳制在单行高度内**（28px 上限，极小视口取 25% 兜底）：

```ts
function clampLag(lag: number, port: HTMLElement): number {
  if (lag <= 0) return 0
  const viewportCap = Math.max(0, port.clientHeight * 0.25)
  return Math.min(lag, Math.min(28, viewportCap))
}
```

应用于 `applyVisual` 的 shiftRoot/shiftRows 分支与 `handBackVisual`。剩余位移由帧循环的 `lag <= 0.1` 快路径下一帧归零。

## 验证（headless 实测）
场景：中文+长路径跨行，内容 60px → 144px（+84px = 3 行高），animatedH 滞后 80px：

| | 旧逻辑 | 新逻辑 |
|---|---|---|
| 应用位移 | 80.0px | 9.5px |
| 判定 | ✗ 跨行重叠风险 | ✓ 安全 |

## 部署
- 源码副本：`dsh-plugin/third-party/dsh-smooth-stream/`（含修复 + 构建配置 tsconfig/tsdown）
- 构建：`tsc -p tsconfig.json`（host）+ `tsc -p tsconfig.client.json`（client 中间产物）+ `tsdown`（bundle）
- 运行目录：`~/.dsh/profiles/web/node_modules/dsh-smooth-stream` → junction → 工作区副本
- profile 依赖：`dsh-smooth-stream: link:/home/suxeca/Workspace/dsh-plugin/third-party/dsh-smooth-stream`
- 生效方式：刷新页面（HTML boot rev 自动更新，`cache-control: no-cache`）
- 原 npm 版 client.js 备份：`lib/client.js.npm.bak`（已随 junction 移除，npm tgz 可从 registry 取回）

## 构建注意事项
- smooth-stream npm 包**不带 tsconfig/tsdown 配置**，需自行补齐（参考 `dsh-agent-teams`）
- client tsc：`rootDir=src`（继承主 tsconfig）+ include `src/client`，输出 `lib/client/`（不要单独设 rootDir=src/client，会多一层目录）
- 类型错误（缺 @deepseek-ai/dsh-client-*/client 子路径类型）**不影响产物**（tsc 默认 noEmitOnError=false，tsdown 用 rolldown 不查类型）
- 依赖：node_modules junction 指向 agent-teams 的（有 tsdown/tsc/lightningcss/typescript/@types）+ profile 的（有 react/cordis/运行时依赖）+ harness 的（@deepseek-ai/dsh-* 类型包）

## 上游提交建议
给 laplace-bit/dsh-smooth-stream 提 PR：clampLag 位移钳制，附本记录。

---

## 2026-08-19 晚间更新：上游 v0.3.3 重写取代本地补丁

**PR #6 结果**：上游维护者审查后未合并——v0.3.3（commit de30e05 "unify adaptive reveal and conversation follow"）已**重写 teleprompterGlide.ts**（986 行变化），用 `safeShiftLimit()` 基于真实 DOM 几何（消息底部到 composer 距离）计算安全位移边界，取代固定值钳制；不再使用 clip-path；测试 112 passed。固定 28px 行高无法代表代码块/工具行/不同缩放的真实行高，且 clampLag 不修改 animatedH 会立即丢弃视觉补偿——PR 方向有价值但实现被新架构取代。

**处置**：
1. PR #6 已关闭（附说明）
2. 本机从 v0.3.2 + clampLag 补丁 **升级到 npm v0.3.3**（本地副本 `third-party/dsh-smooth-stream/` 已替换 src/lib，运行目录 junction 自动生效）
3. 本地补丁备份：`/tmp/smooth-stream-local-fix-backup/`（src + lib）

**后续**：若 v0.3.3 在真实浏览器（中文+长路径换行）仍复现重叠，基于新架构（safeShiftLimit）提供逐帧几何回归测试复现材料给上游。
