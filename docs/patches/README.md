# 本地插件修订补丁（patches）

第三方/外部插件的本地修订快照。这些插件**无法通过 npm 发布**（第三方仓库或
私有未发布），本地以 `link:`/`file:` 方式挂在 profile 中生效；为便于**其他机器
（如 Windows）同步同一套修订**，将本地改动导出为 patch 存档于此。

## 目录

| Patch | 适用仓库 | 基线 | 包含改动 |
|---|---|---|---|
| `better-sidebar-local.patch` | `third-party/dsh-better-sidebar`（[omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)） | `1e366d9` | 面板控制服务（`panelControl`：`togglePanel`/`toggleBottomPanel`/`setFullscreen`/`toggleFullscreen`/`toggleBottomTerminal`）；右侧栏/底栏全屏；终端可见时自动聚焦；explorer 外部目录根 |
| `dsh-super-injector-local.patch` | `third-party/dsh-super-injector`（yjh051108/dsh-super-injector） | `31a556a` | 版本 0.3.1→0.3.3：`DSH_HOME` 优先（web 进程 homedir 与 DSH_HOME 不一致时日志路径错位）；`Config` 类型显式标注（junction 依赖下 declaration 编译 TS2742）；tsdown/构建修复；CHANGELOG/INSTALL 同步 |

## 在其他机器应用

1. 确保对应 `third-party/<repo>` checkout 已处于上表「基线」commit：
   ```sh
   cd ~/Workspace/dsh-plugin/third-party/dsh-better-sidebar
   git checkout 1e366d9
   git apply ~/Workspace/dsh-plugin/docs/patches/better-sidebar-local.patch
   ```
2. 重新构建该插件（`pnpm build`），并确保 profile 以 `link:` 指向本地目录。
3. 若上游仓库已合入相同改动，以 `git apply --3way` 或干净重建替代手工应用。

> ⚠️ patch 仅供本机/自有机器同步用；**不要**推送到第三方上游或提交进上游 PR，
> 除非改动已获上游接受。引用外部路径时使用 `~/` 相对形式，避免泄露本机用户名。
