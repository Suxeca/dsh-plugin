/**
 * The content-boundary signal: does a section read like a definition, or like a
 * record of one run?
 *
 * The calibration these tests pin is the whole value of the detector. A signal
 * that flags frozen definitions is worse than no signal — the human learns to
 * ignore it, and the real drift it exists to catch goes unread. So the cases
 * below are the ones that must stay **clean**, and they are drawn from the real
 * Z3 ledger: provenance dates inside a frozen entry, a verdict that talks about
 * failure without narrating a run, and an on-demand evidence section.
 *
 * @module @suxeca/dsh-note-board/tests/hygiene
 */
import { describe, expect, it } from 'vitest'
import { smellOf, smellOfSection } from '../src/host/hygiene.ts'

describe('the episodic signal', () => {
  it('stays quiet on a frozen entry that carries a provenance date', () => {
    const frozen = [
      '## FROZEN-1 · 规范冻结：Φ_raw（2026-09-26 定稿）',
      '$$',
      '\\Phi_{\\rm raw}(x_m, y) \\equiv 2\\left(\\frac{c_s \\mathcal{P}^+}{L_z}\\right)\\mathrm{Re}[\\cdots]',
      '$$',
      '分量定义（全部冻结，不得改写）：$y \\in \\{0,1,\\dots,L_\\perp-2\\}$；$W_{\\rm Hann}$ 含端点半权。',
    ].join('\n')
    expect(smellOf(frozen)).toBeNull()
  })

  it('stays quiet on a verdict that mentions failure without narrating a run', () => {
    const verdict = [
      '## VERDICT-1-V9',
      '- **V9｜胶子数算符与动量切片合法性门禁**：',
      '  静止系胶子数算符非法；严禁单行二次归一化；红外生长辨伪。',
      '  预登记解释：本判据是可分辨性判据，故 FAIL 只表示该能级不可分辨，**不等于**物理失败。',
      '  （2026-09-27 独立对抗审计裁决）',
    ].join('\n')
    expect(smellOf(verdict)).toBeNull()
  })

  it('stays quiet on an evidence section whose prose is measured but not anecdotal', () => {
    const evidence = [
      '## STAGE1-EVIDENCE · 实现与实测（按需核查）',
      '关联判据：FROZEN-3；执行 Stage-1 判定时按需读取本节的实现路径和实测，不得把样本结果当普遍定理。',
      '实现：`workflows/stage1_acceptance.py`（旁路后处理器，只读输入 CSV，输出 `<csv>.stage1.md`）。',
      '9×4 结论（证据支持，Tier-3）：K=20 表 6 个已实现通道，甲′ 口径下 5/6 PASS。',
    ].join('\n')
    expect(smellOf(evidence)).toBeNull()
  })

  it('flags a section that narrates a fault and a dead end as knowledge', () => {
    const record = [
      '## VERDICT-4 · 设备与算法问题记录',
      '本次尝试在 9×6 上跑了 K=32，提交作业后发现显存不够，报错内存墙；当时怀疑算法写错了，',
      '后来试了另一种写法仍然走不通，实测失败三次，教训是设备故障会误导判据。',
    ].join('\n')
    const hint = smellOf(record)
    expect(hint?.smell).toBe('episodic')
    // The markers travel with the flag: a human has to be able to see why.
    expect(hint?.markers.length).toBeGreaterThan(0)
    expect(hint?.markers.some(marker => ['显存', '走不通', '失败'].includes(marker))).toBe(true)
  })

  it('reports at most a handful of markers', () => {
    const noisy = '失败 报错 崩溃 卡住 故障 显存 内存 超时 排队 踩坑 教训 误判 写错 算错 走不通 行不通 不可行'
    const hint = smellOf(`## X · x\n${noisy}`)
    expect(hint).not.toBeNull()
    expect(hint?.markers.length).toBeLessThanOrEqual(6)
  })

  it('scores repeats, not distinct words', () => {
    // The first shipped rule counted *distinct* marker words, which silently
    // missed exactly the section it was built to catch: a measurement narrative
    // repeats one vocabulary ("实测" six times) instead of varying it. This test
    // pins the correction.
    const narrative = [
      '## FROZEN-3 · 判据冻结',
      '已裁决。实测：4×3 上源码复合门 0/8，一致化后 8/8。',
      '实测（二轮）：9×4 上 ε_T 命中，守卫未命中。',
      '实测：两轮口径下的排除由 G2 驱动。',
      '实测：4×3 上三守卫均未命中，判据退化。',
      '实测：结论以同 j proxy 为准，失败不等于物理失败。',
    ].join('\n')
    expect(smellOf(narrative)?.smell).toBe('episodic')
  })

  it('does not flag the discipline section that names the forbidden patterns', () => {
    // Found the hard way: the first draft of the content-boundary rule was
    // itself reported as a run record, because a rule has to quote the words it
    // bans. Meta content is exempt by id; the same words in a knowledge entry
    // are still scored.
    const rule = [
      '## RULES · 记账纪律',
      '7. 本笔记只承载框架级、决定性内容。一次尝试中的观察——设备/环境故障、某个算法或脚本走不通、',
      '   某次作业为何失败——不写进知识条目：写 `## RUN-LOG · 运行日志`。',
    ].join('\n')
    expect(smellOf(rule)).not.toBeNull()
    expect(smellOfSection('RULES', rule)).toBeNull()
    // The exemption is about the id, not a general amnesty.
    expect(smellOfSection('VERDICT-4', rule.replace('## RULES · 记账纪律', '## VERDICT-4 · x'))).not.toBeNull()
  })
})
