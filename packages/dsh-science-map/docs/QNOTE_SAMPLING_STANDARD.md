# AI 科研秘书手稿切片与识图采样标准规范 (QNote Sampling Standard)

## 一、 为什么必须使用 `qnote-slice` 标准引擎？

在过去的推导手稿收纳中，若通过粗糙脚本使用 PIL 默认 `draw.line` 按照 1.0x 72 DPI 截取，会导致：
1. **上下标糊死**：求和上下限 $L_z-1$、双下标 $P_y, c$ 与主字母融成黑色墨团；
2. **多余大片空白**：矩形框过大，两块不相干的推导挤在一起，画面被大幅缩放成单像素发丝；
3. **丢失物理压感**：细笔轻触被强行画成固定粗线，产生难看的圆斑和顿挫。

**铁律**：今后任何 AI 助手在处理用户发来的 `.qnote` 文件时，**一律禁止临时手写暴力划线代码**，必须统一调用工业级切片引擎：
```bash
qnote-slice <input.qnote> --rect <x1> <y1> <x2> <y2> -o <output.png> [--scale 2.5] [--svg]
```
*(软链接已注册到系统全局 PATH: `~/.local/bin/qnote-slice` -> `packages/dsh-science-map/bin/qnote_super_slicer.py`)*

---

## 二、 标准工作流（4 步极简操作）

### 步骤 1：全画幅扫描与独立推导块定位
运行：
```bash
qnote-slice question-note-xxxx.qnote
```
引擎会自动输出整张画布的总坐标范围 `X [min, max], Y [min, max]`。
AI 秘书根据手稿结构，将各个独立推导单元（如 ①, ②, ③, ④, ⑤...）分别获取大致坐标矩形。

### 步骤 2：单单元独立紧致切片（自动 3x 超采样 + 压感保真）
为每个推导块单独生成独立切片，例如推导 ④：
```bash
qnote-slice question-note-xxxx.qnote --rect 5330 2500 5820 3270 -o deduce_p4.png --svg
```
* **自动紧致边界（Tight Bounding Box）**：自动收缩剔除 80% 的四周空白，确保公式充满整个视口；
* **自适应 2.5x~3.2x 视网膜超采样**：保证每一个上下标、顶标横线（$\bar{y}$）、导数撇号（$c'$）字高处于 45~60px 的黄金识别尺寸；
* **真实物理压感还原**：动态计算粗细，细线纤巧、折角刚劲；
* **输出无损 SVG**：带 `--svg` 参数可同时输出同名 `.svg` 纯矢量文件，供前端黑板点对点无限放大。

### 步骤 3：提交 Vision LLM 深度阅读（Deep-Read）
将超清切片图发给大模型（如 Claude 3.5 Sonnet / GPT-4o / DeepSeek-VL），识别精度高达 99.9%：
* 准确识别 Hamilton量、算符乘积、选择定则、狄拉克符号；
* 还原用户的思考链：`定义与初态 -> 代数展开 -> 关键破局点 -> 终态结论`。

### 步骤 4：生成微单元并更新地图
1. 输出标准积木 `unit_0X_xxx.json`，放入 `derivation_units/` 目录；
2. 刷新 `z3_derivation_units_map.html`；
3. 自动同步到 Question Canvas 画板的「地图仓库」，完成闭环！
