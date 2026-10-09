/**
 * @suxeca/dsh-research-core — DSH 原生科研学术核心底座插件
 *
 * 核心功能：
 * 1. 4 权威学术库并发硬印证检索（arXiv + S2 + INSPIRE-HEP + Crossref）
 * 2. arXiv 原版 LaTeX 源码公式提取（绕过 PDF OCR 损伤）
 * 3. DOI / arXiv 真实性探针（防模型捏造文献幻觉）
 * 4. Devil's Advocate 状态机审查门禁
 */

import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Config } from './config.js'
import { searchPapers } from './tools/search.js'
import { fetchTexSource } from './tools/tex-source.js'
import { verifyCitation } from './tools/verify.js'
import { checkStageGate, ResearchStage } from './guards/devils-gate.js'

export const name = '@suxeca/dsh-research-core'
export const inject = ['tools']
export { Config }

/** 工具统一返回强格式化 JSON 文本，兼顾大模型解析与类型安全。 */
const output = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }],
}

export function apply(ctx: Context, config: Config): void {
  // 会话内已核验文献集合（防幻觉缓存池）
  const verifiedCache = new Set<string>()

  // 1. 原生 Host Tool: research_search_papers
  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'research_search_papers',
          description: '4大权威学术库(arXiv/S2/INSPIRE-HEP/Crossref)并发检索并按ID硬印证去重与分级。',
          parameters: {
            topic: { type: 'string', required: true, description: '检索主题或关键词组' },
            count: { type: 'number', description: '期望返回的论文数量（默认 20）' },
            sources: {
              type: 'array',
              items: { type: 'string' },
              description: '可选指定学术库子集，默认全开',
            },
          },
          output,
          async execute(args: { topic: string; count?: number; sources?: any[] }) {
            const results = await searchPapers(
              {
                topic: args.topic,
                count: args.count || 20,
                sources: args.sources,
              },
              {
                s2ApiKey: config.s2ApiKey,
                crossrefMailto: config.crossrefMailto,
                tavilyApiKey: config.tavilyApiKey,
              },
            )

            let verifiedCount = 0
            let corroboratedCount = 0

            const formatted = results.map((p) => {
              if (p._cv?.tier === 'verified') verifiedCount++
              if (p._cv?.tier === 'corroborated') corroboratedCount++

              // 记入已核验证实池
              if (p.externalIds?.DOI) verifiedCache.add(p.externalIds.DOI.toLowerCase())
              if (p.externalIds?.ArXiv) verifiedCache.add(p.externalIds.ArXiv.toLowerCase())

              return {
                title: p.title,
                authors: p.authors?.slice(0, 5),
                year: p.year,
                venue: p.venue,
                citationCount: p.citationCount,
                cross_validation: {
                  tier: p._cv?.tier,
                  label: p._cv?.label,
                  sources: Array.from(p._sources || []),
                },
                score: p._scores?.final,
                arxiv_id: p.externalIds?.ArXiv,
                doi: p.externalIds?.DOI,
                url: p.url,
                scihub_url: p.externalIds?.DOI ? `${config.scihubBaseUrl}/${p.externalIds.DOI}` : undefined,
                abstract: p.abstract ? p.abstract.slice(0, 300) + '...' : undefined,
              }
            })

            return JSON.stringify(
              {
                topic: args.topic,
                total: formatted.length,
                verified: verifiedCount,
                corroborated: corroboratedCount,
                papers: formatted,
              },
              null,
              2,
            )
          },
        }),
      ),
    '@suxeca/dsh-research-core: research_search_papers',
  )

  // 2. 原生 Host Tool: research_fetch_tex_source
  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'research_fetch_tex_source',
          description: '从 arXiv 直拉解压原作者 LaTeX 源码，高保真提取定理、Hamiltonian 及物理算符公式。',
          parameters: {
            arxiv_id: { type: 'string', required: true, description: 'arXiv 编号，如 2405.12345' },
          },
          output,
          async execute(args: { arxiv_id: string }) {
            const res = await fetchTexSource(args.arxiv_id)
            return JSON.stringify(res, null, 2)
          },
        }),
      ),
    '@suxeca/dsh-research-core: research_fetch_tex_source',
  )

  // 3. 原生 Host Tool: research_verify_citation
  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'research_verify_citation',
          description: '直连官方注册局(Crossref/arXiv)硬核探测引文真实性，识别 404 与虚构幻觉。',
          parameters: {
            doi: { type: 'string', description: 'DOI 号，如 10.1103/PhysRevLett.132.011601' },
            arxiv_id: { type: 'string', description: 'arXiv 编号，如 2301.00001' },
            claimed_title: { type: 'string', required: true, description: '声称的论文标题' },
          },
          output,
          async execute(args: { doi?: string; arxiv_id?: string; claimed_title: string }) {
            const res = await verifyCitation(args)
            if (res.verdict === 'VERIFIED') {
              if (args.doi) verifiedCache.add(args.doi.toLowerCase())
              if (args.arxiv_id) verifiedCache.add(args.arxiv_id.toLowerCase())
            }
            return JSON.stringify(res, null, 2)
          },
        }),
      ),
    '@suxeca/dsh-research-core: research_verify_citation',
  )

  // 4. 原生 Host Tool: research_devils_checkpoint
  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'research_devils_checkpoint',
          description: '魔鬼代言人(Devil Advocate)对抗审查门禁：检查科学逻辑断裂、确认偏误与方法论漏洞。',
          parameters: {
            stage: {
              type: 'string',
              required: true,
              description: '当前阶段：scoping(选题) | investigation(检索) | analysis(分析) | review(终审)',
            },
            research_question: { type: 'string', description: '研究问题' },
            methodology: { type: 'string', description: '方法论说明' },
            sources_count: { type: 'number', description: '纳入的文献总数' },
            verified_sources_count: { type: 'number', description: '多源印证的文献数' },
            claims: { type: 'array', items: { type: 'string' }, description: '提炼的结论列表' },
            limitations_acknowledged: { type: 'boolean', description: '是否已诚实陈述局限性' },
          },
          output,
          async execute(args: any) {
            const res = checkStageGate(args.stage as ResearchStage, args)
            return JSON.stringify(res, null, 2)
          },
        }),
      ),
    '@suxeca/dsh-research-core: research_devils_checkpoint',
  )
}
