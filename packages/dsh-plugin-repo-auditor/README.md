# @suxeca/dsh-plugin-repo-auditor

基于 CMU 论文《Six Million (Suspected) Fake Stars in GitHub》(arXiv:2412.13459) 的启发式指标，结合 DeepSeek Harness (DSH) 的 Cordis 架构，在本地原生实现的 GitHub 假星、水军和空壳项目审计插件。

提供原生 Tool `audit_github_repos`、轻量无感 System Prompt 导引，以及基于 `tools/pre-execute` 的插件安装安全门禁。

---

## 核心功能与检测算法

### 1. 互动比率异常检测（针对 Star >= 30）
- **Fork / Star 比率**：
  - `< 0.05`：扣 15 分，警告 `LOW_FORK_RATIO`
  - `< 0.02`：扣 30 分，标记 `CRITICAL_LOW_FORK_RATIO`（重度刷星嫌疑）
- **Watcher (Subscribers) / Star 比率**：
  - 正常基准 ≥ 0.5%，`< 0.005` 扣 15 分，`< 0.001` 标记 `CRITICAL_LOW_WATCHER_RATIO`
  - **大仓校准模型**：针对超高星仓库（> 50k Stars）的通知疲劳现象，阈值动态调整为 0.15% 与 0.05%；当代码体积 > 10 MB 且 Fork 率 ≥ 10% 时自动降权豁免。

### 2. 代码体积与时间序列异常
- **空壳项目检测**：Star >= 100 但仓库代码体积小于 30 KB，扣 35 分，标记 `HOLLOW_REPO_SIZE`。
- **脉冲刷量与弃坑检测**：Star >= 200 但活跃跨度（`pushed_at - created_at`）不足 2 天，扣 30 分，标记 `SHORT_LIFESPAN_SPIKE`。
- **0-Issue 增星异常**：日均 Star 增长率高但 `open_issues_count === 0`。
  - *已支持豁免逻辑*：若维护者主动关闭 Issues 面板（`has_issues === false`），或 Fork 数 ≥ 50 且 Fork 率 ≥ 8% 时豁免扣分。

### 3. 点星水军（Stargazers）特征抽样
- 并发抽检最新点赞用户的 Profile，识别以下两类低质量水军账号：
  1. **三无空白号**：`public_repos === 0 && followers === 0 && !bio && !company`
  2. **新注册闪电水军**：注册时间不足 30 天且 `public_repos <= 1 && followers === 0`
- 当检出水军占比 ≥ 25% 扣 15 分，≥ 50% 扣 30 分。

### 4. 动态 API 配额保护与三级 Token 降级
- **三级凭据解析**：`config.token` → DSH `credentials` 服务 → 环境变量 `GITHUB_TOKEN` → 免鉴权模式。
- **配额精准保护**：免鉴权模式（60次/小时）下，对一阶指标健康（评分 ≥ 85）的仓库**坚决跳过**二级水军抽样，单仓审查严格只消耗 **1 次** API 请求；仅对 `< 85` 分的可疑仓库按需深入抽样。
- **10 分钟 TTL 缓存**：相同仓库在 10 分钟内秒级复用，支持 `forceRefresh: true` 强制穿透。

### 5. `tools/pre-execute` 拦截门禁
- 实时监听 `plugin_manager`（`install_bundle`）和 `bash`（`git clone` / `npm install github:...`）。
- 自动前置审计，若目标仓库评级为 D/F 或触发空壳/低 Fork 率告警，触发 DSH 原生 `{ kind: 'ask' }` 审批弹窗，需用户确认方可继续。
- 支持 `SKIP_REPO_AUDIT=1` 紧急逃生通道。

---

## 插件配置项

可在 DSH 设置面板或 `cordis.patch.yml` 中配置：

```yaml
- insert:
    - id: repo-auditor
      name: '@suxeca/dsh-plugin-repo-auditor'
      config:
        token: "" # GitHub Personal Access Token (可选)
        sampleSize: 5 # 水军账号抽样数 (默认 5)
        enableInstallGate: true # 是否开启安装拦截门禁 (默认 true)
```

---

## 构建与测试

```bash
# 编译 TypeScript 源码到 lib/
bash scripts/build.sh

# 运行门禁单元测试
npm test
```
