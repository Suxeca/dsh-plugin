/**
 * search.ts — 4 大权威学术索引并发检索与实体硬印证引擎
 * 来源重构自 paper-finder/search.js，去除对脆弱外部脚本调用的依赖，
 * 采用原生 TypeScript + 全局 fetch 实现。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

export interface ExternalIds {
  ArXiv?: string
  DOI?: string
  CorpusId?: string | number
  [key: string]: any
}

export interface PaperRecord {
  title: string
  authors?: string[]
  year?: number | null
  abstract?: string
  venue?: string
  citationCount?: number
  url?: string
  externalIds?: ExternalIds
  _sources?: Set<string>
  _scores?: {
    relevance: number
    importance: number
    cross_boost: number
    final: number
  }
  _cv?: {
    count: number
    total: number
    label: string
    tier: 'verified' | 'corroborated' | 'single' | 'web_only'
  }
}

export interface SearchOptions {
  topic: string
  count?: number
  sources?: ('arxiv' | 's2' | 'inspire' | 'crossref' | 'tavily')[]
}

// 标题归一化：小写 + 只留字母数字
export function normTitle(t?: string): string {
  return (t || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// 合并单条记录（补全缺失元数据）
function mergeRecord(base: PaperRecord, extra: PaperRecord): void {
  if (!base.abstract && extra.abstract) base.abstract = extra.abstract
  if ((!base.year || base.year === 0) && extra.year) base.year = extra.year
  if ((!base.authors || base.authors.length === 0) && extra.authors && extra.authors.length > 0) {
    base.authors = extra.authors
  }
  if (!base.venue && extra.venue) base.venue = extra.venue
  if ((base.citationCount == null || base.citationCount === 0) && extra.citationCount != null) {
    base.citationCount = extra.citationCount
  }
  if (!base.url && extra.url) base.url = extra.url

  // 合并 externalIds
  base.externalIds = base.externalIds || {}
  const eExt = extra.externalIds || {}
  for (const k of Object.keys(eExt)) {
    if (!base.externalIds[k] && eExt[k]) base.externalIds[k] = eExt[k]
  }
}

// 从已有的 ArXiv ID / DOI 派生隐式权威来源
function _impliedSourcesFromIds(extIds?: ExternalIds): string[] {
  if (!extIds) return []
  const out: string[] = []
  if (extIds.ArXiv) out.push('arxiv-via-id')
  if (extIds.DOI) out.push('crossref-via-id')
  return out
}

// 把一批新记录合并入 pool，按 ArXiv ID / DOI / 归一化标题硬去重
export function mergeIntoPool(
  papers: PaperRecord[],
  indexes: {
    arxiv: Map<string, number>
    doi: Map<string, number>
    title: Map<string, number>
  },
  batch: PaperRecord[],
  sourceTag: string,
): void {
  for (const p of batch) {
    const aid = p.externalIds?.ArXiv
    const doi = (p.externalIds?.DOI || '').toLowerCase()
    const tkey = normTitle(p.title)
    const implied = _impliedSourcesFromIds(p.externalIds)

    let idx = -1
    if (aid && indexes.arxiv.has(aid)) idx = indexes.arxiv.get(aid)!
    else if (doi && indexes.doi.has(doi)) idx = indexes.doi.get(doi)!
    else if (tkey && indexes.title.has(tkey)) idx = indexes.title.get(tkey)!

    if (idx >= 0) {
      mergeRecord(papers[idx], p)
      papers[idx]._sources = papers[idx]._sources || new Set<string>()
      papers[idx]._sources!.add(sourceTag)
      for (const s of implied) papers[idx]._sources!.add(s)
      if (aid) indexes.arxiv.set(aid, idx)
      if (doi) indexes.doi.set(doi, idx)
      if (tkey) indexes.title.set(tkey, idx)
    } else {
      const rec: PaperRecord = { ...p }
      rec._sources = new Set<string>([sourceTag])
      for (const s of implied) rec._sources.add(s)
      papers.push(rec)
      const newIdx = papers.length - 1
      if (aid) indexes.arxiv.set(aid, newIdx)
      if (doi) indexes.doi.set(doi, newIdx)
      if (tkey) indexes.title.set(tkey, newIdx)
    }
  }
}

// 计算交叉印证评级（Tavily/Google Scholar 不计入权威印证）
export function crossValidationLabel(sources?: Set<string>): {
  count: number
  total: number
  label: string
  tier: 'verified' | 'corroborated' | 'single' | 'web_only'
} {
  const raw = sources ? Array.from(sources) : []
  const n = raw.length
  const auth = new Set<string>()

  for (const s of raw) {
    if (s === 'tavily' || s === 'scholar' || s === 'serpapi') continue
    if (s === 'arxiv-via-id') auth.add('arxiv')
    else if (s === 'crossref-via-id') auth.add('crossref')
    else auth.add(s)
  }

  const a = auth.size
  if (a >= 3) return { count: a, total: n, label: '多源印证 (≥3权威库)', tier: 'verified' }
  if (a === 2) return { count: a, total: n, label: '双索引印证 (2权威库)', tier: 'corroborated' }
  if (a === 1) return { count: a, total: n, label: '单源 (1权威库)', tier: 'single' }
  return { count: 0, total: n, label: '仅 web 检索', tier: 'web_only' }
}

// 关键词相关度简单打分
function calcRelevance(paper: PaperRecord, queryTerms: string[]): number {
  if (!queryTerms.length) return 0.5
  const full = `${paper.title || ''} ${paper.abstract || ''}`.toLowerCase()
  let hits = 0
  for (const term of queryTerms) {
    if (full.includes(term.toLowerCase())) hits++
  }
  return Math.min(1, hits / queryTerms.length)
}

// 重要度打分（基于真实引用数与权威发表）
function calcImportance(paper: PaperRecord): number {
  const cites = paper.citationCount || 0
  if (cites > 200) return 1.0
  if (cites > 50) return 0.8
  if (cites > 10) return 0.6
  if (paper.venue) return 0.4
  return 0.2
}

/* ──────────────── 官方学术 API 客户端 ──────────────── */

// 1. arXiv 官方 API
export async function fetchArxiv(topic: string, count: number): Promise<PaperRecord[]> {
  try {
    const q = encodeURIComponent(`all:${topic}`)
    const url = `http://export.arxiv.org/api/query?search_query=${q}&start=0&max_results=${count}&sortBy=relevance&sortOrder=descending`
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (!res.ok) return []
    const xml = await res.text()

    const entries = xml.split('<entry>').slice(1)
    const out: PaperRecord[] = []
    for (const entry of entries) {
      const getTag = (t: string) => {
        const m = entry.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`, 'i'))
        return m ? m[1].trim() : ''
      }
      const rawId = getTag('id')
      const mId = rawId.match(/arxiv\.org\/abs\/(.+)$/i)
      const aid = mId ? mId[1] : ''
      const title = getTag('title').replace(/\s+/g, ' ')
      const summary = getTag('summary').replace(/\s+/g, ' ')
      const pubDate = getTag('published')
      const year = pubDate ? parseInt(pubDate.slice(0, 4), 10) : null

      const authors: string[] = []
      const aMatches = entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)
      for (const am of aMatches) {
        authors.push(am[1].trim())
      }

      if (title) {
        out.push({
          title,
          authors,
          year,
          abstract: summary,
          venue: 'arXiv',
          url: rawId,
          externalIds: aid ? { ArXiv: aid } : {},
        })
      }
    }
    return out
  } catch {
    return []
  }
}

// 2. Semantic Scholar 官方 API
export async function fetchSemanticScholar(topic: string, count: number, apiKey?: string): Promise<PaperRecord[]> {
  try {
    const q = encodeURIComponent(topic)
    const fields = 'title,authors,year,abstract,venue,citationCount,externalIds,url'
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${q}&limit=${count}&fields=${fields}`
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (apiKey) headers['x-api-key'] = apiKey

    const res = await fetch(url, { headers, signal: AbortSignal.timeout(12000) })
    if (!res.ok) return []
    const data: any = await res.json()
    if (!data.data || !Array.isArray(data.data)) return []

    return data.data.map((item: any) => ({
      title: item.title || '',
      authors: (item.authors || []).map((a: any) => a.name),
      year: item.year,
      abstract: item.abstract,
      venue: item.venue,
      citationCount: item.citationCount || 0,
      url: item.url,
      externalIds: item.externalIds || {},
    }))
  } catch {
    return []
  }
}

// 3. INSPIRE-HEP 官方 API（高能物理/理论物理金标）
export async function fetchInspireHep(topic: string, count: number): Promise<PaperRecord[]> {
  try {
    const q = encodeURIComponent(topic)
    const url = `https://inspirehep.net/api/literature?q=${q}&size=${count}&format=json`
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (!res.ok) return []
    const data: any = await res.json()
    if (!data.hits || !Array.isArray(data.hits.hits)) return []

    const out: PaperRecord[] = []
    for (const h of data.hits.hits) {
      const meta = h.metadata || {}
      const title = meta.titles?.[0]?.title || ''
      if (!title) continue

      const authors = (meta.authors || []).slice(0, 10).map((a: any) => a.full_name)
      const year = meta.earliest_date ? parseInt(meta.earliest_date.slice(0, 4), 10) : null
      const abstract = meta.abstracts?.[0]?.value || ''
      const cites = meta.citation_count || 0

      const externalIds: ExternalIds = {}
      if (meta.arxiv_eprints?.[0]?.value) {
        externalIds.ArXiv = meta.arxiv_eprints[0].value
      }
      if (meta.dois?.[0]?.value) {
        externalIds.DOI = meta.dois[0].value
      }

      out.push({
        title,
        authors,
        year,
        abstract,
        venue: 'INSPIRE-HEP',
        citationCount: cites,
        externalIds,
        url: `https://inspirehep.net/literature/${h.id}`,
      })
    }
    return out
  } catch {
    return []
  }
}

// 4. Crossref 官方 API（DOI / 期刊权威）
export async function fetchCrossref(topic: string, count: number, mailto?: string): Promise<PaperRecord[]> {
  try {
    const q = encodeURIComponent(topic)
    const url = `https://api.crossref.org/works?query=${q}&rows=${count}`
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (mailto) headers['User-Agent'] = `DSH-Research-Core/0.0.1 (mailto:${mailto})`

    const res = await fetch(url, { headers, signal: AbortSignal.timeout(12000) })
    if (!res.ok) return []
    const data: any = await res.json()
    const items = data.message?.items
    if (!Array.isArray(items)) return []

    const out: PaperRecord[] = []
    for (const it of items) {
      const title = it.title?.[0] || ''
      if (!title) continue

      const authors = (it.author || []).map((a: any) => `${a.given || ''} ${a.family || ''}`.trim())
      const year = it.issued?.['date-parts']?.[0]?.[0] || null
      const venue = it['container-title']?.[0] || ''
      const cites = it['is-referenced-by-count'] || 0
      const doi = it.DOI || ''

      out.push({
        title,
        authors,
        year,
        venue,
        citationCount: cites,
        externalIds: doi ? { DOI: doi } : {},
        url: it.URL || (doi ? `https://doi.org/${doi}` : undefined),
      })
    }
    return out
  } catch {
    return []
  }
}

/* ──────────────── 主调度器：并发碰撞与熔合打分 ──────────────── */

export async function searchPapers(
  options: SearchOptions,
  config?: { s2ApiKey?: string; crossrefMailto?: string; tavilyApiKey?: string },
): Promise<PaperRecord[]> {
  const { topic, count = 20, sources = ['arxiv', 's2', 'inspire', 'crossref'] } = options

  const pool: PaperRecord[] = []
  const indexes = {
    arxiv: new Map<string, number>(),
    doi: new Map<string, number>(),
    title: new Map<string, number>(),
  }

  const tasks: Promise<void>[] = []

  if (sources.includes('arxiv')) {
    tasks.push(
      fetchArxiv(topic, count).then((res) => {
        mergeIntoPool(pool, indexes, res, 'arxiv')
      }),
    )
  }

  if (sources.includes('s2')) {
    const s2Key = config?.s2ApiKey || process.env.S2_API_KEY
    tasks.push(
      fetchSemanticScholar(topic, count, s2Key).then((res) => {
        mergeIntoPool(pool, indexes, res, 's2')
      }),
    )
  }

  if (sources.includes('inspire')) {
    tasks.push(
      fetchInspireHep(topic, count).then((res) => {
        mergeIntoPool(pool, indexes, res, 'inspire')
      }),
    )
  }

  if (sources.includes('crossref')) {
    const mailto = config?.crossrefMailto || process.env.CROSSREF_MAILTO
    tasks.push(
      fetchCrossref(topic, count, mailto).then((res) => {
        mergeIntoPool(pool, indexes, res, 'crossref')
      }),
    )
  }

  // 并发等待所有源完成
  await Promise.allSettled(tasks)

  // 计算可信度评级与综合得分
  const queryTerms = topic.split(/\s+/).filter(Boolean)
  for (const p of pool) {
    p._cv = crossValidationLabel(p._sources)
    const rel = calcRelevance(p, queryTerms)
    const imp = calcImportance(p)
    const crossBoost = Math.min((p._cv.count - 1) * 0.04, 0.16)
    const finalScore = Number((rel * 0.5 + Math.min(imp, 1) * 0.4 + crossBoost).toFixed(3))

    p._scores = {
      relevance: rel,
      importance: imp,
      cross_boost: crossBoost,
      final: finalScore,
    }
  }

  // 按综合评分从高到低排序，截取前 count 篇
  pool.sort((a, b) => (b._scores?.final || 0) - (a._scores?.final || 0))
  return pool.slice(0, count)
}
