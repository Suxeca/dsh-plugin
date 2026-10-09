# Science Map：基于 Archify 架构哲学的科研思维与计算流演化地图
## 体系设计与多模型对抗审计执行计划书

---

## 一、项目背景与核心设计哲学

### 1. 痛点根源：事后法庭审判 vs 事中荒野求索
当前 AI 科研与可视化生态存在严重的断层：
- **形式化工具（如 Gaia / LKM）**：做的是“事后法庭审判（Post-mortem Audit）”。它假设物理学家已经推导完、写完代码、跑完超算，再来做严格的贝叶斯置信度或定理证明。这适合写论文答辩，但完全无法服务日常科研过程。
- **架构图工具（如 Archify）**：拥有极佳的前端交互与编译流水线，但其默认语义完全硬编码在“互联网微服务工程”（frontend、backend、database、cloud、VPC 安全边界），对于高能物理（HEP）、凝聚态与计算物理完全不适用。
- **真实科研过程的本质**：是一个在连续对话与超算实验中推进的**多维有向无环图（Dynamic DAG）**。它包含：物理动机、代数约束、代码改动对应的物理图像、HPC 调度与实际参数偏差、以及被推翻的负面假设（踩坑墓地）。

### 2. 深度借鉴 Archify 的内在设计哲学
我们不把 Archify 仅仅当作一个“SVG 排版工具”，而是**全面继承其深层的系统设计思想**，并将其“代码工程端”的底层概念全面替换为“科学研究与思维推理”：

| Archify 的工程原生层 | 对应设计哲学 | **在 Science Map 科学世界中的重构映射** |
|---|---|---|
| **声明式 Typed IR (`components`)** | 语义建模与几何排版分离，模型只负责表达拓扑与事实，编译器负责直角布线与端点分布 | **`epistemic_nodes`（认知图元）**：<br>• `theoretical_axiom`（理论公理/代数基础，如 Weyl 代数）<br>• `model_mapping`（模型映射/对偶变换，如 2D 3-state Potts）<br>• `code_operator`（物理算符的代码落地）<br>• `hpc_campaign`（超算计算战役）<br>• `observable`（物理观测量，内嵌学术矢量图表）<br>• `refuted_hypothesis`（被否决的死胡同/踩坑记录） |
| **真实证据验证引擎 (`repository-evidence`)** | 拒绝模型臆造，所有图元必须锚定到不可篡改的 Git SHA 和具体行号 | **`quad_evidence`（四维真实科学证据链）**：<br>1. **理论推导证据**：LaTeX 公式、代数对易子判据、文献定理<br>2. **代码物理映射**：Git Commit + 代码行 + **物理图像与修改原因**<br>3. **算力偏差审计**：**用户期望跑的数据 vs LLM 实际提交的数据之账本**（Job ID、节点、参数网格、偏差原因）<br>4. **会话溯源**：产生该灵感与决策的具体 Session ID + Turn 索引 |
| **Fail-Closed 确定性门禁 (`validate`)** | 不靠玄学 Prompt，通过确定性规则检查拓扑与合规性，输出精确诊断与修复建议 | **`scientific_gates`（科学一致性门禁）**：<br>• **No Floating Claims**：任何结论节点必须有理论推导或 HPC 观测支撑<br>• **Execution Fidelity Gate**：拦截“无 SLURM Job 凭证”或“参数偏离且未记录偏差理由”的虚假节点<br>• **Cemetery Invariant**：负面/失败尝试必须记录具体驳回原因（Rationale） |
| **演化与差分引擎 (`architecture-delta`)** | PR 级代码变更审查：精确展示 Before / Delta / After | **`research_evolution`（课题演化与意图差分）**：<br>• **模型路线差分**：Kogut-Susskind 直接表象 vs 对偶自旋表象的拓扑与自由度对比<br>• **意图与现实差分**：用户意图拓扑 vs 实际计算拓扑的 Delta 审查 |
| **信息收敛与下钻 (`drilldown bundles`)** | 首屏保持高层主线（Main Line）清晰，复杂子系统通过摘要下钻到子图 | **`main_line + figure_drawers`**：<br>• 主屏仅保留一条贯穿全流程的 **Main Line 脊梁**<br>• 侧边抽屉直接嵌入学术矢量图表（能隙标度、色散曲线、波函数），取代死板的原始矩阵与表格 |

---

## 二、多模型对抗审计架构（Multi-Model Adversarial Audit）

鉴于当前环境暂时无法使用 GPT 模型，系统充分调动本地现存的三大独立模型家族（**Google Gemini、DeepSeek、Alibaba Qwen、Zhipu GLM**），利用不同模型的推理特长与偏差倾向构建**三方交叉红蓝对抗制衡**：

```text
               ┌─────────────────────────────────────────────────────────┐
               │              原始历史事实挖掘与初步 IR 生成              │
               │         Model: Gemini-3.8-Flash-Tiered (Agy)            │
               └───────────────────────────┬─────────────────────────────┘
                                           │ 初步候选 IR (Draft IR)
             ┌─────────────────────────────┼─────────────────────────────┐
             ▼                             ▼                             ▼
   【理论推导审计员】             【HPC 与执行偏差审计员】        【代码-物理对齐审计员】
Model: DeepSeek-V4.1-Flash       Model: Qwen-3.8-Flash            Model: GLM-5.3-Flash
  (专注代数严谨性与逻辑链)      (专注代码执行真实性、参数查验)      (专注 Julia 算符语义与张量缩并)
             │                             │                             │
             └─────────────────────────────┼─────────────────────────────┘
                                           ▼
                                 三方交叉质询与反驳
                               (Adversarial Round-Table)
                                           │
                                           ▼ 形成一致裁决 (Consensus Receipt)
                                 【Science Map 编译器】
                               (交付最终可交互的 HTML)
```

### 1. 各模型的角色与“挑刺”职责

1. **候选提取专家：`Gemini-3.8-Flash-Tiered`**
   - **职责**：依靠其超长上下文和敏锐的信息抽取能力，通读 `Z3model` 目录下所有 Julia/Python 脚本、SLURM 提交记录、TOML 基准数据及相关对话切片，生成首版全量覆盖的 Draft IR。
2. **理论一致性审计员（Theory Critic）：`DeepSeek-V4.1-Flash`**
   - **职责**：专盯数学与物理漏洞。
   - **挑刺维度**：
     - 从 Kogut-Susskind 到对偶 Potts 的映射中，周期性边界条件（PBC）是否遗漏了拓扑缠绕（Winding flux）？
     - 高斯定律在截断到 3 态时，是否破坏了局部规范对称性？
     - 理论推导步骤是否存在未经证明的近似跃迁？
3. **算力与执行偏差审计员（Execution & Discrepancy Auditor）：`Qwen-3.8-Flash`**
   - **职责**：专盯真实数据与偷工减料。
   - **挑刺维度**：
     - 严格对照用户的会话要求与磁盘上的真实 SLURM 脚本（如 `hot_campaign_8gpu.sh`、`jobA`...`jobR`、TOML 数据）。
     - 抓取**“用户要求跑 $12\times 4$ 网格，为什么实际上提交了 $8\times 6$”**的具体技术原因（如显存超出、收敛过慢、排队超时）。
     - 查验是否有未跑完却声称收敛的虚假节点。
4. **代码与物理对齐审计员（Code-Physics Bridge）：`GLM-5.3-Flash`**
   - **职责**：专盯代码实现与物理图像的映射保真度。
   - **挑刺维度**：
     - 审查 Julia 代码（`z3_puregauge_cylinder_tn/`）中具体改动的行数，解释该改动在物理上代表了哪个哈密顿量算符或基底重排。
     - 检查张量网络收缩顺序是否改变了物理态的归一化或对称性块对角结构。

---

## 三、切入标杆工程：Z3model 的真实科研全景

我们以用户本地真实的 `~/Workspace/Z3model` 作为首个试点验证工程：

### 1. 真实主干（Main Line）设定
* **M1（理论代数）**：(2+1)D $Z_3$ 纯规范场 Kogut-Susskind 哈密顿量与 Weyl 对易关系 $PQ=\omega QP$。
* **M2（模型对偶）**：映射到 2D 3-state Potts / Clock 模型，锁定局部 3 维物理基底。
* **M3（圆柱张量网络）**：基于 ITensors.jl 建立 $PBC_z \times OBC_\perp$ 圆柱几何上的 MPS/DMRG 计算框架。
* **M4（基态与对称性验证）**：小尺寸（$4\times 4, 5\times 4$）Lanczos 精确对角化与宇称扇区分解。
* **M5（能谱与质量间隙标度）**：大尺寸 DMRG 虚时间演化与通量激发胶球谱（Glueball spectrum）计算。
* **M6（禁闭相变与物理综合）**：Wilson 环弦张力随 $g_c^2 \approx 2.0$ 的面积律/周长律转变。

### 2. 真实执行偏差（Discrepancies）审计点
* **偏差实例 A**：用户要求在全尺寸圆柱上扫描 $L_z=12, L_\perp=4$，但实际运行脚本切换为 $8\times 6$ 与 $5\times 9$。
  - *原因*：虚时间演化中键维 $\chi > 128$ 时单卡显存（16GB）溢出，LLM 自行降维以保全计算吞吐。
* **偏差实例 B**：用户要求测试 30 个连续激发态，实际提交的脚本为分段分批提交（`jobG1`...`jobG3`）。
  - *原因*：集群 QOS 单任务时限 30 分钟限制，脚本被迫做分段检查点（Checkpointing）。

### 3. 学术矢量绘图（Figure Assets）内嵌点
* 内嵌图 1：`benchmark_z3_comparison_with_emonts.png`（与 Emonts 权威文献数据的精密对标）。
* 内嵌图 2：`z3_eta_and_parity_spectrum_comparison.png`（宇称扇区与质量间隙对比）。
* 内嵌图 3：`z3_dual_cylinder_figure.png`（圆柱对偶几何晶格示意图）。

---

## 四、分阶段详细执行计划（Roadmap）

### 阶段一：规范与编译器框架设计（Day 1）
1. **Schema 落地**：
   - 编写 `science-map.schema.json`，严格定义 `epistemic_nodes`、`quad_evidence`、`discrepancy_audit` 和 `figure_drawers`。
2. **校验门禁实现**：
   - 移植 Archify 的几何校验，追加 `scientific_gates`（证据链完整性、参数保真门禁）。
3. **交付产物**：
   - `schemas/science-map.schema.json`
   - `scripts/validate-science-map.mjs`

### 阶段二：Z3model 全量事实打捞与初版 Draft IR 提取（Day 1 - 2）
1. **启动数据挖掘 Subagent**（基于 `Gemini-3.8-Flash-Tiered`）：
   - 全面解析 `~/Workspace/Z3model` 下的代码、脚本、TOML 与会话历史。
   - 梳理出主干节点、分支计算、被否决假设、代码 Diff 物理意义及执行偏差清单。
2. **交付产物**：
   - `Z3model/z3_science_map.draft.json`

### 阶段三：三模型对抗审计圆桌会（Day 2）
1. **理论审查**：由 `DeepSeek-V4.1-Flash` 执行，输出 `audit_report_theory.md`。
2. **执行偏差审查**：由 `Qwen-3.8-Flash` 执行，输出 `audit_report_execution.md`。
3. **代码物理对齐审查**：由 `GLM-5.3-Flash` 执行，输出 `audit_report_code_bridge.md`。
4. **裁决收敛**：合并三方意见，修正 Draft IR 中的盲点与过度声明，生成 `z3_science_map.verified.json`。

### 阶段四：渲染引擎扩展与交互产物交付（Day 2 - 3）
1. **渲染器改造**：
   - 继承 Archify 原生 SVG 直角布线算法、快捷键与主题系统。
   - 改造节点外观（物理符号、Belief 进度、偏差角标）。
   - 增加**学术图表侧边抽屉（Scientific Figure Drawer）**与**执行偏差审查弹窗**。
2. **最终交付**：
   - 独立单文件可交互网页：`~/Workspace/Z3model/z3_science_map.html`。
   - 伴随视觉与结构回执，用户双击即可在浏览器中全屏交互。
