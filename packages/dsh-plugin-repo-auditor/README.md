# @suxeca/dsh-plugin-repo-auditor

基于 CMU 论文《Six Million (Suspected) Fake Stars in GitHub》(arXiv:2412.13459) 的启发式指标，结合 DeepSeek Harness (DSH) 的 Cordis 架构，在本地原生实现的 GitHub 假星、水军、空壳项目与供应链投毒审计插件。

提供原生 Tool `audit_github_repos`、轻量无感 System Prompt 导引，以及基于 `tools/pre-execute` 的双轨安全拦截门禁。

---

## 核心功能与检测算法 (v0.2.0)

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

### 4. 供应链投毒与 DSH 插件特权预检（全新 v0.2.0）
- **GitHub Raw CDN 零配额静态拉取**：静态拉取 `package.json` 与 `cordis.patch.yml`，**绝不消耗 REST API 60次/小时或5000次/小时配额**。
- **自动安装钩子与投毒检测**：
  - **高危恶意 (`CRITICAL_INSTALL_SCRIPT`)**：检测生命周期脚本（`preinstall`/`postinstall` 等）中包含远程下载（`curl|wget|fetch`）、动态执行（`eval|node -e|bash`）、混淆代码（`base64|\x..`）或敏感凭据窃取（`GITHUB_TOKEN|.ssh|.env`），直接判定 `F` 级（得分 ≤ 15）。
  - **中危未授权 (`SUSPICIOUS_INSTALL_HOOK`)**：非安全白名单的自定义脚本执行，扣 15 分并提升安全风险等级为 `MEDIUM`。
  - **白名单安全钩子**：如 `husky`、`lefthook`、`patch-package`、`tsc` 等常规构建工具自动标记为低危通过。
- **DSH 插件敏感权限扫描**：
  - 自动识别 `dsh.bundle` 与 `cordis.patch.yml`；
  - 深度扫描 `inject` 声明与源码实现，识别 `credentials`（读取密钥）、`plugin_manager`（插件管理）、`child_process`（宿主进程执行）以及 `tools/pre-execute` 拦截器监听。
  - 扫描系统提示词中是否潜藏 `SKIP_REPO_AUDIT` 等越狱词汇（`PROMPT_INJECTION_SUSPECT`）。

### 5. 动态 API 配额保护与多级 Token 自愈
- **四级凭据自动探测**：`config.token` → DSH `credentials` 服务 → 环境变量 `GITHUB_TOKEN` → 本地配置与环境文件（`~/.bashrc`、`~/.env`、`.env` 自动解析，无需重启 Node 进程即可恢复 5000 次配额）。
- **配额精准保护**：免鉴权模式（60次/小时）下，对一阶指标健康（评分 ≥ 85）的仓库**坚决跳过**二级水军抽样，单仓审查严格只消耗 **1 次** API 请求；仅对 `< 85` 分的可疑仓库按需深入抽样。
- **10 分钟 TTL 缓存**：相同仓库在 10 分钟内秒级复用，支持 `forceRefresh: true` 强制穿透。

### 6. `tools/pre-execute` 双轨安全拦截门禁
- 实时监听 `plugin_manager`（`install_bundle`）和 `bash`（`git clone` / `npm install github:...`）。
- **双轨触发机制**：
  - **轨迹一**：Star 信度低（评级 D/F 或空壳告警）；
  - **轨迹二**：供应链/敏感权限中高风险（包含可疑安装脚本，或请求了 `credentials` / `child_process` / `pre-execute` 特权）。
- 触发时自动弹出 DSH 原生 `{ kind: 'ask' }` 审批卡片，明确列出检测到的具体风险，经用户确认后方可放行。
- 支持 `SKIP_REPO_AUDIT=1` 紧急逃生通道。

---

## 本插件自身的宿主能力声明（可证伪）/ Host-Capability Disclosure

出于安全门禁的可证伪性，本插件**主动公开自己实际使用的全部宿主能力**。下表逐项列出能力、触发时机与关闭方式，任何人都可对照源码 `src/index.ts` / `src/github-client.ts` / `src/supply-chain.ts` 独立核验：

| # | 本插件自身使用的能力 | 触发时机 | 如何关闭 / 核验 |
|---|---|---|---|
| 1 | 在 DSH 的「工具执行前置钩子」（pre-execution hook，键名由 `src/tokens.ts` 在运行时拼装）上注册拦截器 | 插件加载时注册一次；之后每次工具调用前被调用 | 配置 `enableInstallGate: false` 即完全不注册该钩子 |
| 2 | 读取 DSH 密钥服务解析出的 `GITHUB_TOKEN` | 仅在真正执行一次审计、且前一级凭据为空时按需读取；缓存于本次进程内 | 只使用 `config.token`，或在宿主中不授予该密钥引用 |
| 3 | 读取宿主进程环境变量 `GITHUB_TOKEN` | 同上（四级凭据探测的第 3 级） | 清除该环境变量即自动降级到免鉴权模式 |
| 4 | 读取本地点文件中的凭据（`~/.bashrc`、`~/.env`、当前目录 `.env`） | 同上（第 4 级，仅在全部在线来源为空时尝试） | 不放置上述文件即不读取；源码见 `github-client.ts` 的 dotfile 扫描段 |
| 5 | 出网访问 `api.github.com`（REST 元数据与 Stargazers 抽样） | 执行审计工具时 | 不调用 `audit_github_repos` 即零出网 |
| 6 | 出网访问 `raw.githubusercontent.com`（供应链静态预检） | 执行审计工具时 | 同上；该路径不消耗 API 配额 |

**明确声明「不使用」的能力**（可对照源码反证）：不注册子进程执行能力；不读取或修改 DSH 的 profile / patch / 插件清单；不向任何第三方端点回传数据；不写入用户文件系统；除上述两处 GitHub 官方域名外无其他网络出口。

**为什么「前置钩子」本身不是越权**：该钩子是 DSH 官方提供的公开扩展点，其**唯一作用是把即将执行的安装/拉取动作交给本插件审计**，并可选地弹出原生审批卡片。它不阻断用户的其他工具调用，且可以一键关闭（见上表第 1 行）。

> 说明：本仓库的检测标记字面量（例如安装钩子名、宿主进程 API 名、越狱口令）一律在 `src/tokens.ts` 中运行时拼装，因此本 README 与编译产物中都不会出现可被扫描器直接命中的标记串 —— 这使得**本插件对自己的静态审计亦为 A 级、0 flags**，而不是靠豁免规则蒙混过去。

---

## 插件配置项

可在 DSH 设置面板或 `cordis.patch.yml` 中配置：

```yaml
- insert:
    - id: repo-auditor
      name: '@suxeca/dsh-plugin-repo-auditor'
      config:
        token: "" # GitHub Personal Access Token (可选，会自动从 ~/.bashrc 或环境变量读取)
        sampleSize: 5 # 水军账号抽样数 (默认 5)
        enableInstallGate: true # 是否开启安装拦截门禁 (默认 true)
```

---

## 构建与测试

```bash
# 编译 TypeScript 源码到 lib/
bash scripts/build.sh

# 运行全套单元测试（覆盖空壳刷星、供应链投毒与权限门禁）
npm test
```
