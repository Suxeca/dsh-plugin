# @suxeca/dsh-external-dirs

给 **DSH 官方右侧 Sidebar** 增加一个「外部目录」tab：浏览**会话工作区之外**的绝对目录（只读），点击文件用官方预览打开。

## 为什么需要它

DSH 官方的文件树被宿主钉死在会话工作区，且这是**设计边界**而非缺陷：

> `packages/client/ui-sidebar-files/README.md:61` — **One root.** The tree is rooted at the session's working directory; **there is no way to browse above it**, and the Host refuses paths outside the workspace root anyway.

`@deepseek-ai/dsh-api-workspace-files` 的 `list` 因此对工作区外路径返回 `outside-workspace`。
这个插件补上那一块：**自己**用 `node:fs` 列目录（host 路由），**复用**官方的文件预览（client 侧把绝对路径交给官方 `dsh-resource://file/...` viewer）。

## 用法

1. 打开右侧 Sidebar（会话头右侧的展开按钮）。
2. 在指南页里选 **「外部目录」**。
3. 顶部输入框填一个**绝对路径**（如 `/mnt/data`）按 Enter 添加；也可点「主目录」一键加入 `$HOME`。
4. 展开目录树；点击文件即在侧边栏用官方预览（Markdown / 代码 / 图片 / PDF）打开。
5. 目录行右侧的 `×` 移除该根目录。

根目录列表持久化在 `~/.dsh/settings.yaml` 的 `external-dirs.roots`（命名空间必须是 kebab-case，
provider 会校验 `/^[a-z][a-z0-9-]*$/`）。

## 能力与边界

| 能力 | 状态 |
|---|---|
| 列任意绝对目录（工作区外） | ✅ 自建 host 路由 |
| 展开/折叠、目录优先排序、软链接目录可展开 | ✅ |
| 点击文件用官方预览打开（含工作区外文件） | ✅ 官方 `dsh-resource://file/<绝对路径>` + workspace-files 的绝对读 |
| 单一根目录 + 每级懒加载 + 条目上限 5000（超出标记截断） | ✅ |
| **写 / 重命名 / 删除** | ❌ **刻意不做**：只读，不绕过 workspace 写围栏 |
| 文件系统 watcher | ❌ 需手动重新展开刷新 |

## 安全

- **路由自守卫**：裸 `webServer` 路由**不会**继承宿主的浏览器信任围栏（官方已知 caveat）。
  本插件的每条路由都先调 `connection.requestRejection(req)`，未受信任的请求直接 401/403 ——
  与官方 `dsh-host-open-in-app` 同一做法。所以经局域网/远程暴露时**不会**变成未鉴权文件浏览器。
- **只读**：路由只做 `readdir`/`realpath`/`stat`，没有任何写操作。
- **只接受绝对路径**：相对路径一律 400 拒绝，避免"我到底打开了哪个目录"含糊。
- 添加根目录时会 `realpath` + 校验确实是目录，打错的路径不会被存成死根。

## 结构

```
src/
  index.ts                host：inject 声明 + 注册 settings 命名空间 + 挂路由
  host/routes.ts          两条前缀路由（/external-dirs/api/{roots,list}）
  shared.ts               两端共享的 wire 契约
  shared-routes.ts        两端共享的路由前缀常量（浏览器安全，不引 node:*）
  client/
    index.ts              注册 tab 类型 + tab body + chip title
    definition.ts         tab 类型定义（page 型，不认领资源地址）
    Body.tsx              目录树 UI
    Title.tsx             页签标题
```

## 两个踩过的坑（留给后来者）

1. **`webServer`/`connection` 是 Cordis accessor，只能在"声明过注入的那个 ctx"上取。**
   从 `ctx.inject([...])` 的**嵌套回调**里注册路由会拿不到 accessor，结果是**路由静默不挂载**
   （插件照常加载、零报错）。必须像 `dsh-pdf-drop` / 官方 `dsh-host-open-in-app` 那样，
   在**外层 ctx**（`inject = [...]` 声明的那个）上调用 `ctx.webServer.register(...)`。
   另外 `ctx.get('webServer')` **不等价**于 accessor。

2. **settings 命名空间必须 kebab-case。** `externalDirs` 会被
   `register()` 以 `must match /^[a-z][a-z0-9-]*$/` 拒绝；若不捕获，插件会静默失去根目录存储
   （其余功能照常，只有 `/roots` 一直 503）。

## 安装（本机 web profile）

已通过 `dev_install_package` 装配：profile 的 `dependencies`（`link:`）与
`dsh.profile.bundles` 各一条，另有 `cordis.patch.yml`（`dsh.bundle.patch`）提供插件行。

改完源码后重建并硬刷新浏览器即可（client 改动热加载；host 改动需重启 `dsh web`）：

```sh
cd ~/Workspace/dsh-plugin/packages/dsh-external-dirs && pnpm run build
```
