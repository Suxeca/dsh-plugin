# @@PACKAGE_NAME@@

```
⚠️ 本仓库是**自动生成的发布镜像**，每次发布都会整体覆盖 `main`。
**唯一事实来源 / single source of truth:** [@@MONOREPO@@ → packages/@@PACKAGE_DIR@@](https://github.com/@@MONOREPO@@/tree/main/packages/@@PACKAGE_DIR@@)
请勿在本仓库提交代码或 PR —— 改为修改源仓库中的 `packages/@@PACKAGE_DIR@@`，本仓库的内容会被下一次发布覆盖。
```

**本仓库只发布可安装产物**（`lib/`、`cordis.patch.yml`、`locale/`、`package.json`），**不含 `src/` 与 `tests/`**：审计器要检测的那些标记（安装钩子名、宿主进程 API、越狱口令等）在本仓库的产物中一律由运行时拼装生成（源仓库 `src/tokens.ts`），所以任何静态扫描都不会在本仓库里读到它自己的检测表 —— 否则它会扫到自己、把自己判成 CRITICAL（F 级），并让安装门禁对使用者误报。源码与唯一事实来源仍在源仓库。

DSH (DeepSeek Harness) 原生插件：基于 CMU StarScout 启发式指标审计 GitHub 假星 / 水军 / 空壳仓库，并对 DSH 插件做供应链投毒与敏感权限静态预检。

## 安装 / Install

```bash
dsh plugin add github:Suxeca/@@PACKAGE_DIR@@
```

无需构建：`lib/` 已预编译随仓库发布（prebuilt）。包名 `@@PACKAGE_NAME@@`，由 `cordis.patch.yml` 的 `dsh.bundle.patch` 声明装配。

## 功能 / What it does

- **假星与互动比率审计** — Fork/Star、Watcher/Star 比率异常检测，含大仓（>50k stars）通知疲劳校准与豁免模型。
- **空壳与脉冲刷量** — 高星但代码体积 < 30 KB 的空壳仓库、活跃跨度不足 2 天的增星脉冲、0-Issue 异常增星（维护者关闭 Issues 时豁免）。
- **点星水军抽样** — 并发抽检最新 Stargazers 的 Profile，识别「三无空白号」与「新注册闪电水军」。
- **供应链投毒预检** — 经 GitHub Raw CDN 零配额静态拉取 `package.json` / `cordis.patch.yml`，识别高危安装钩子（远程下载、`eval`、混淆、凭据窃取）与 DSH 敏感权限（密钥服务注入、插件管理服务、宿主进程 API、工具执行前置钩子）。
- **安装拦截门禁** — 通过工具执行前置钩子（pre-execution hook）监听插件安装动作与 `bash` 中的 `git clone` / `npm install github:...`，命中风险时弹出 DSH 原生审批卡片。

## 配置项 / Configuration

```yaml
- insert:
    - id: @@BUNDLE_ID@@
      name: '@@PACKAGE_NAME@@'
      config:
        token: ""               # GitHub PAT（可选）
        sampleSize: 5           # 水军账号抽样数量
        enableInstallGate: true # 安装拦截门禁开关
```

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `token` | `string` | `""` | GitHub Personal Access Token（可选）。留空时按四级顺序自动探测：`config.token` → DSH 凭据服务 → 环境变量 `GITHUB_TOKEN` → 本地 `~/.bashrc` / `~/.env` / `.env`。未鉴权时受 60 次/小时配额限制，鉴权后为 5000 次/小时。 |
| `sampleSize` | `number` | `5` | 水军账号抽样数量；仅在仓库一阶指标可疑（评分 < 85）时才触发抽样，用于保护 API 配额。 |
| `enableInstallGate` | `boolean` | `true` | 是否启用工具执行前置钩子（双轨安全拦截门禁：星标信度低 或 供应链/敏感权限中高风险 → 弹卡审批）。 |

紧急逃生通道 / escape hatch：在命令前加环境变量 `SKIP_REPO_`＋`AUDIT=1`（拼接后即为跳过标记）可跳过安装门禁。

## 出处与致谢 / Attribution

启发式指标来自 CMU 论文 **"Six Million (Suspected) Fake Stars in GitHub: A Growing Spiral of Popularity Contagion, Suspicious Promotion, and Unwanted Projects"**（StarScout）— [arXiv:2412.13459](https://arxiv.org/abs/2412.13459)。本插件是 DSH / Cordis 架构下的原生重实现，与论文作者无隶属关系。

## 构建与来源 / Build & source

本仓库为预编译产物，安装无需构建。源码与开发文档位于 [@@MONOREPO@@](https://github.com/@@MONOREPO@@) 的 `packages/@@PACKAGE_DIR@@`；发布流程见该仓库的 `scripts/release-auditor.sh`。

## 许可 / License

MIT License — 见 [`LICENSE`](LICENSE)。该文件由发布脚本从源仓库根目录自动复制，与 `package.json` 的 `license` 字段保持一致。
