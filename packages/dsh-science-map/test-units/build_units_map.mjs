import { readFileSync, writeFileSync } from 'node:fs';
import { renderDerivationUnitsMap } from '../src/derivation_unit_view.mjs';

const b64 = JSON.parse(readFileSync('/tmp/b64_units.json', 'utf8'));

const unitsData = {
  unit1: {
    unitId: "Deriv-Unit 01",
    title: "Z₃ 对称性检查与 F^{+y} 量子数推导",
    brief: "从 Weyl 对偶基底出发，排除 ω^η 伪能量依赖，确定 C、P_y、P_z 的精确宇称",
    sourceFile: "z3对称性检查.qnote",
    strokeCount: 818,
    imageDataUri: b64.unit1,
    steps: [
      {
        title: "手征通量算符 F^{+y} 的定义",
        tag: "定义",
        summary: "写下 F^{+y}(z, r) = (E_y(z, r) + B(z, r)) / √2 的算符展开式，明确电场 E_y 与磁通 B 的定义。"
      },
      {
        title: "直接切入对偶表象展开",
        tag: "策略选择",
        summary: "为避免引入局域规范冗余与高斯定律约束，直接使用面心对偶算符 Q 与平移算符 P 展开场量。"
      },
      {
        title: "顿悟：消除 ω^η 的虚假能量漂移疑点",
        tag: "认知突破",
        summary: "草稿红叉！原以为 C 变换会使 ω^η → ω^-η 导致能量变化；顿悟突破：ω^η 是拓扑超选择扇区的 c-number，不是算符！"
      },
      {
        title: "C 变换对偶作用与 C-odd 确立",
        tag: "推导求解",
        summary: "由 C|0⟩=|0⟩, C|-1⟩=|+1⟩ 推出 Q → Q†, P → P†。直接导出 E_y → -E_y, B → -B，因此 F^{+y} 为严格的 C 奇宇称本征态。"
      },
      {
        title: "P_y 与 P_z 反射的非对称手征劈裂",
        tag: "物理结论",
        summary: "法向与切向分量性质不同：P_y 使 F^{+y} → -F^{+y}（单态本征值）；而 P_z 使 F^{+y} → F^{-y}（手征翻转，需配对组合对角化）。"
      }
    ],
    ahaMoments: [
      {
        title: "草稿红叉的认知跃迁（c-number vs 算符）",
        detail: "在检查边界扭折项时，你手写写下了 Q† + Q + ω^-η Q† + ω^η Q 并打上醒目的红叉，写下小字：'在这里 ω^η 作为 c-number，不是希尔伯特空间算符，η 本身是一个 d.o.f.'。彻底消除了'C 变换是否改变扇区基态能量'的困惑！"
      },
      {
        title: "P_y 与 P_z 的物理本质差异",
        detail: "手稿中清晰标明：E_y(法) 反号而 E_y(切) 不反号，磁场 B 恒反号。因此 P_y 是单一态本征反射（-1），而 P_z 产生手征映射 F^{+y} ↔ F^{-y}，解释了为什么后续代码中周向动量反演必须考虑双峰手征混和！"
      }
    ],
    synthesisHtml: `
      <p style="font-size:0.83rem; color:var(--text); line-height:1.5; margin-bottom:8px;">
        <strong>散落变换法则整理（对照表）：</strong>
      </p>
      <table class="table-clean">
        <thead>
          <tr>
            <th>变换算符</th>
            <th>对偶算符映射</th>
            <th>场分量变换</th>
            <th>F^{+y} 本征行为</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>电荷共轭 C</strong></td>
            <td>Q → Q†, P → P†</td>
            <td>E_y → -E_y, B → -B</td>
            <td><strong style="color:var(--accent);">F^{+y} → -F^{+y}</strong> (C-odd)</td>
          </tr>
          <tr>
            <td><strong>空间反射 P_y</strong></td>
            <td>r → -r (法向反射)</td>
            <td>E_y → -E_y, B → -B</td>
            <td><strong style="color:var(--emerald);">F^{+y} → -F^{+y}</strong> (P_y-odd)</td>
          </tr>
          <tr>
            <td><strong>空间反射 P_z</strong></td>
            <td>z → -z (切向反射)</td>
            <td>E_y → +E_y, B → -B</td>
            <td><strong style="color:var(--gold);">F^{+y} → F^{-y}</strong> (手征翻转)</td>
          </tr>
        </tbody>
      </table>
    `,
    codeLinks: [
      {
        path: "z3_puregauge_cylinder_tn/src/model.jl",
        desc: "在构建局域手征投影算符 F^{+y} 时，固化 C 奇宇称约束，排除非物理的 0++ 混杂。"
      },
      {
        path: "check_fpy_symmetry.jl",
        desc: "代码中验证 P_y 与 P_z 反演对称性矩阵元，数值验证 F^{+y} 在 P_z 下的非对角翻转行为。"
      }
    ]
  },
  unit2: {
    unitId: "Deriv-Unit 02",
    title: "局域两点关联函数与离散狄利克雷核色散解析解",
    brief: "严格利用 Z_{Lz} 平移群剥离空间相位，对称等比级数求和导出有限时间窗口谱展宽的解析闭合解",
    sourceFile: "z0y0phi0_equation.qnote",
    strokeCount: 1818,
    imageDataUri: b64.unit2,
    steps: [
      {
        title: "有限圆柱时空与离散平移群设定",
        tag: "格点设定",
        summary: "设定周向 z ∈ {0..Lz-1} (PBC_z) 与对称时间切片 t_m = m·dt (m ∈ {-Nt..Nt})，引入平移群 T_z^{Lz} = 1。"
      },
      {
        title: "两点关联函数的中间态本征展开",
        tag: "代数展开",
        summary: "插入动量本征基底 𝕀 = ∑_{n, kz} |n, kz⟩⟨n, kz|，将 raw correlator 表示为跃迁矩阵元 M_0(z, y, kz) 的双重求和。"
      },
      {
        title: "利用平移算符剥离空间 z 相位 (红蓝笔重点)",
        tag: "关键技巧",
        summary: "利用 F^{+y}(z, y) = T_z^z F^{+y}(0, y) T_z^-z 提取纯相位 e^{-i z · 2π kz / Lz}，使得空间 z 彻底与矩阵元解耦！"
      },
      {
        title: "空间离散傅里叶变换 (FFT) 触发正交性",
        tag: "正交选择",
        summary: "对 z 求和 (1/Lz) ∑ e^{i 2π(qz-kz)z/Lz} = δ_{qz, kz}，直接滤除全部非相干动量杂质，只保留确定的 q_z 单一动量！"
      },
      {
        title: "原点局域退化分析 (Case z=0, y=0)",
        tag: "局域对比",
        summary: "指出若不做空间投影，局域两点关联函数是所有动量 kz 态的非相干叠加，导致频谱混叠。"
      },
      {
        title: "有限对称时间等比求和导出狄利克雷核",
        tag: "解析闭合",
        summary: "对时间等比数列 ∑_{m=-Nt}^{Nt} e^{i m θ} 严格求和，借助 sin x 形式化简为完美的离散狄利克雷核 sin((Nt+1/2)θ) / sin(θ/2)。"
      }
    ],
    ahaMoments: [
      {
        title: "红字顿悟：把 z 从 correlator 中彻底剥离",
        detail: "手稿右侧蓝色与红色关键笔迹指出：通过平移群算符的共轭作用，将 z 依赖转化为纯标量相位因子，使得空间傅里叶变换能够直接化为克罗内克 δ_{qz, kz}，证明了周向 FFT 是唯一能够无损隔离动量扇区的正交操作！"
      },
      {
        title: "谱峰宽度的仪器假象揭秘",
        detail: "严格推导出时间傅里叶变换的解析因子是狄利克雷核而不是高斯分布或柯西分布，从根本上证明了当前数值拟合出的谱峰宽度是有限演化时间 T_max = Nt·dt 的仪器截断效应（Sinc 展宽），而不是物理上的粒子衰变激发态宽度！"
      }
    ],
    synthesisHtml: `
      <p style="font-size:0.83rem; color:var(--text); line-height:1.5; margin-bottom:8px;">
        <strong>解析闭合解与仪器展宽判据（完整公式）：</strong>
      </p>
      <div class="formula-card">
        $$\\Phi_0(\\omega) = \\sum_{k_z=0}^{L_z-1} \\sum_n |M_0(0,0,k_z)|^2 \\cdot dt \\cdot \\frac{\\sin\\left((N_t + \\frac{1}{2})(\\omega - \\Delta E_{p_z}) dt\\right)}{\\sin\\left(\\frac{(\\omega - \\Delta E_{p_z}) dt}{2}\\right)}$$
      </div>
      <div style="font-size:0.8rem; line-height:1.6; margin-top:8px;">
        <strong>关键定量推论：</strong><br>
        • 当 $dt \\to 0$ 时退化为标准 Sinc 函数：$2 T_{max} \\, \\text{sinc}(T_{max}(\\omega - \\Delta E))$<br>
        • 仪器半高全宽（FWHM）基线：<strong style="color:var(--gold);">$\\text{FWHM}_{\\text{inst}} = \\frac{2.783}{T_{max}}$</strong><br>
        • 第一零点宽度：$\\Delta \\omega_{\\text{zero}} = \\frac{\\pi}{T_{max}}$
      </div>
    `,
    codeLinks: [
      {
        path: "Z3model/calc_fwhm.py",
        desc: "拟合胶球能隙谱峰半高全宽时，必须先扣除手稿推导出的 2.783 / T_max 仪器展宽，才能提取真实固有衰变宽度。"
      },
      {
        path: "Z3model/analyze_tdvp_diag.py",
        desc: "根据手稿推导的 δ_{qz, kz} 选择定则，在分析 TDVP 两点关联函数时，先行执行周向 FFT 动量投影再进行时间谱分析。"
      }
    ]
  }
};

const html = renderDerivationUnitsMap(unitsData, {
  title: "Z₃ 格点规范理论 · 手稿推导微单元地图 (Derivation Micro Map)"
});

const outPath = '/home/suxeca/Workspace/Z3model/z3_derivation_units_map.html';
writeFileSync(outPath, html, 'utf8');
console.log('Compiled Derivation Units Map to:', outPath, 'Size:', (Buffer.byteLength(html) / 1024 / 1024).toFixed(2), 'MB');
