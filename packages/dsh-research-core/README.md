# @suxeca/dsh-research-core

DSH 原生科研学术核心底座插件：4 权威学术库并发硬印证、原版 TeX 源码公式提取、引文真实性守卫与 Q1 同行评议编排。

彻底贯彻 **Guides（认知指南）与 Sensors/Gates（原生硬门禁）分离** 的设计法则，脱离对脆弱 bash 命令拼装的依赖，纯 TypeScript 原生实现，且**不依赖 `dsh-typesafe`**。

---

## 核心功能与 Host Tools

### 1. `research_search_papers`（4 官方库并发硬印证检索）
* 并发请求 **arXiv**、**Semantic Scholar**、**INSPIRE-HEP**、**Crossref** 官方 API；
* 依据 ArXiv ID、DOI、归一化标题建立 Hash 池进行实体去重与元数据熔合；
* 产出结构化置信度标签：
  * ✅ **多源印证 (verified)**：$\ge 3$ 个权威索引命中；
  * ☑️ **双索引印证 (corroborated)**：2 个权威索引命中；
  * ⚠️ **单源 (single)**：1 个权威索引；
  * 🌐 **仅 web 检索**：Tavily 等补充源，不计入学术印证。

### 2. `research_fetch_tex_source`（arXiv 原版 LaTeX 源码提取）
* 绕过 PDF OCR 造成的公式上下标断裂与算符残缺；
* 直拉解压原作者 `.tar.gz` 源码包，提取核心定理（`theorem` / `proposition`）与数学物理公式块（`equation` / `align` / Hamiltonian）。

### 3. `research_verify_citation`（文献真实性硬核防幻觉探针）
* 直连官方注册局 `doi.org` / Crossref API 与 arXiv 官方数据库；
* 智能计算声明标题与官方注册标题的文本相似度；
* 准确判定：`VERIFIED`（真实吻合）、`METADATA_MISMATCH`（标题不符需订正）、`FABRICATED`（404 伪造文献）。

### 4. `research_devils_checkpoint`（魔鬼代言人审查状态机）
* 阶段流转门禁：在 `scoping`（选题）、`investigation`（检索）、`analysis`（分析）、`review`（终审）设立严苛卡点；
* 检查多源印证比例（$\ge 50\%$）、反例排除与局限性声明（Acknowledged Limitations）。

---

## 配置项（Config Schema）

可在 DSH 的插件配置中设置，或自动平滑读取环境变量：

| 配置项 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `s2ApiKey` | `string` | `""` | Semantic Scholar API 密钥（可选，避免频繁 429） |
| `crossrefMailto` | `string` | `""` | Crossref polite pool 邮箱（可选，提升请求限额） |
| `scihubBaseUrl` | `string` | `"https://sci-hub.se"` | Sci-Hub 基础域名 |
| `tavilyApiKey` | `string` | `""` | Tavily API 密钥（可选） |

---

## 构建与安装

```bash
# 构建编译
bash scripts/build.sh

# 运行时热注入（免重启）
# 在 DSH 会话中调用：
dev_inject_plugin "/path/to/packages/dsh-research-core"
```
