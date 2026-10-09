/**
 * devils-gate.ts — 魔鬼代言人对抗审查状态机门禁
 * 阶段流转门禁：在关键阶段前强制检查科学逻辑漏洞与偏误。
 */

export type ResearchStage = 'scoping' | 'investigation' | 'analysis' | 'review'

export interface StageContext {
  research_question?: string
  methodology?: string
  sources_count?: number
  verified_sources_count?: number
  claims?: string[]
  limitations_acknowledged?: boolean
}

export interface GateVerdict {
  verdict: 'PASS' | 'REVISE' | 'BLOCK'
  stage: ResearchStage
  issues: string[]
  suggestions: string[]
}

export function checkStageGate(stage: ResearchStage, ctx: StageContext): GateVerdict {
  const issues: string[] = []
  const suggestions: string[] = []

  switch (stage) {
    case 'scoping': {
      if (!ctx.research_question || ctx.research_question.trim().length < 10) {
        issues.push('研究问题（RQ）过于单薄或未明确定义')
        suggestions.push('使用 FINER 标准重新精炼 RQ，明确自变量与因变量')
      }
      if (!ctx.methodology) {
        issues.push('未提供方法论或研究范式设计')
        suggestions.push('补充定性/定量/混合范式选择及合理性论证')
      }
      break
    }

    case 'investigation': {
      const total = ctx.sources_count || 0
      const verified = ctx.verified_sources_count || 0
      if (total < 5) {
        issues.push(`检索文献总量过少 (${total} < 5)，存在严重样本偏误风险`)
        suggestions.push('扩充关键词或利用 arXiv + S2 + INSPIRE 扩大检索池')
      }
      if (total > 0 && verified / total < 0.5) {
        issues.push(`多源印证文献比例低于 50% (当前: ${(verified / total * 100).toFixed(0)}%)`)
        suggestions.push('优先纳入被 2 个以上权威数据库交叉命中的核心文献')
      }
      break
    }

    case 'analysis': {
      if (!ctx.claims || ctx.claims.length === 0) {
        issues.push('未提炼出明确的结论性命题 (Claims)')
        suggestions.push('列出 2-3 个从证据直接支持的核心结论')
      }
      break
    }

    case 'review': {
      if (!ctx.limitations_acknowledged) {
        issues.push('未声明研究局限性与潜在反例（存在确认偏误）')
        suggestions.push('在报告末尾必须显式开辟 Acknowledged Limitations 小节')
      }
      break
    }
  }

  const verdict = issues.length === 0 ? 'PASS' : issues.some((i) => i.includes('严重') || i.includes('过少')) ? 'REVISE' : 'PASS'

  return {
    verdict,
    stage,
    issues,
    suggestions,
  }
}
