# dsh-plugin 仓库大更新 — 现状盘点与待确认清单

> 生成时间：2026-08-19 16:20
> 目标：大更新前梳理「需要更新/提交/清理」的内容，供仓库所有者确认。

---

## 一、仓库结构总览

```
dsh-plugin/
├── packages/          # 自有插件（5 个）
│   ├── dsh-client-ui-session-switcher  v0.1.0-rc.6  (活跃)
│   ├── dsh-custom-thinking             v0.0.1       (注入式)
│   ├── dsh-lab-kit                     v0.1.0       (活跃,研究台)
│   ├── dsh-plugin-manager              v0.1.0-rc.4  (⚠️ 已被 super-injector 替代)
│   └── dsh-secure-context-polyfill     v0.1.0-rc.2  (gitignore 不入库)
├── third-party/       # 第三方（submodule / 嵌套 / 纯目录）
│   ├── [submodule] dsh-vision-toolkit      v0.1.6
│   ├── [submodule] sage-mem                v0.1.3
│   ├── [submodule] dsh-conversation-share  v0.1.1
│   ├── [submodule] dsh-super-injector      v0.3.3  ⚠️ 有本地修改
│   ├── [嵌套]      dsh-agent-teams         v0.1.7  (未跟踪)
│   ├── [嵌套]      dsh-synapse             v0.3.0  (未跟踪)
│   ├── [嵌套]      dsh-wallpaper-engine    v0.2.2  (未跟踪)
│   ├── [纯目录]    dsh-smooth-stream       v0.3.2  (未跟踪,今天新增+修复)
│   └── [gitignore] dsh-better-sidebar      v0.12.0 (不入库)
├── presets/
│   └── router-standard/        (路由预设,有本地改动)
├── shared/          tsdown.client.ts + web-platform.ts
├── scripts/         10 个 verify-*.mjs 回归脚本
├── docs/            兼容性审计等新文档
└── 根文件           README / pnpm-workspace.yaml / tsconfig.base.json
```

---

## 二、需要「提交/更新」的内容（按优先级）

### 🔴 P0 — 未跟踪的新目录（大更新必含）

| 目录 | 版本 | 来源 | 说明 |
|---|---|---|---|
| `third-party/dsh-smooth-stream/` | 0.3.2 | **今天本地修复** | 含 clampLag 修复（PR #6 已发上游）+ 构建配置 + FIX-NOTES.md |
| `third-party/dsh-agent-teams/` | 0.1.7 | 嵌套 git | 今天装配的团队协作插件 |
| `third-party/dsh-synapse/` | 0.3.0 | 嵌套 git | 工作区投影/画布 |
| `third-party/dsh-wallpaper-engine/` | 0.2.2 | 嵌套 git | 壁纸引擎 |
| `docs/client-ui-compat-audit.md` | — | 新 | 客户端兼容审计 |
| `docs/context-preset-compat-audit.md` | — | 新 | 预设兼容审计 |
| `docs/plugin-compat-review.md` | — | 新 | 插件兼容审查 |
| `presets/router-standard/router-bootstrap-v1.mjs` | — | 新 | 路由引导 v1 |
| `.agent-teams/` `.dsh-vision-toolkit/` | — | 运行时 | ⚠️ 建议 gitignore |

### 🟡 P1 — 有本地修改的已跟踪文件

| 文件 | 改动 | 说明 |
|---|---|---|
| `third-party/dsh-super-injector/`（submodule） | +121/-57 src/index.ts | 历史改进（DSH_HOME 支持等）+ **今天修复（purge 顺序 + 记账）** → 需 commit + push 回 submodule |
| `README.md` | 修改 | 需更新（反映新插件/新结构） |
| `pnpm-lock.yaml` | 修改 | 跟随包变化 |
| `presets/router-standard/agent.cordis.yml` + `router-core.mjs` | 修改 | 路由预设更新 |
| **删除**：`presets/router-commandcode/`、`presets/router-opencode-go/`、`docs/compare-v4-godmode.md`、`docs/measurements-router-opencode-go.md`、`scripts/verify-alt-u-line-delete.mjs` | D | 确认这些删除是否是有意的清理 |

### 🟢 P2 — 建议清理/决策

| 项 | 现状 | 建议 |
|---|---|---|
| `packages/dsh-plugin-manager/` | v0.1.0-rc.4，已被 super-injector 替代 | 删除 or 保留归档？ |
| `third-party/dsh-better-sidebar/` | gitignore 不入库 | 确认是否继续本地维护 |
| `packages/dsh-secure-context-polyfill/` | gitignore 不入库 | 确认 |
| `third-party/dsh-conversation-share/` | submodule，npm 也装了 | 二选一？ |
| `.agent-teams/` `.dsh-vision-toolkit/` | 运行时产物 | 加入 .gitignore |

---

## 三、装配清单（运行时）健康度

- ✅ **100+ 官方 bundle 全部 active**（dsh-base 等）
- ✅ 6 个 MCP bridge 正常
- ✅ 本地插件全部 active：lab-kit / session-switcher / vision-toolkit / sage-mem / conversation-share / better-sidebar / secure-context-polyfill / super-injector / smooth-stream / agent-teams / synapse / wallpaper-engine
- ✅ 注入器修复已生效（inject 22 次失败开始带原因：`no-active-fiber (client=client ✓)`）
- ⚠️ 今天的失败记录已显示新原因格式（修复验证 ✓）

---

## 四、待你确认的问题

1. **super-injector submodule 的本地修改**：是否 commit + push 回 `yjh051108/dsh-super-injector`？（含今天的 purge/记账修复，值得）
2. **4 个未跟踪 third-party**：直接 add 进 dsh-plugin 仓库？还是转成 submodule？（agent-teams/synapse/wallpaper-engine 是嵌套 git，可转 submodule；smooth-stream 是纯目录，直接入库）
3. **dsh-plugin-manager**：删还是留？
4. **删除的 presets/docs/scripts**：确认是清理意图？
5. **.agent-teams/.dsh-vision-toolkit**：加入 .gitignore？
6. **README**：是否需要我重写（反映新结构）？
