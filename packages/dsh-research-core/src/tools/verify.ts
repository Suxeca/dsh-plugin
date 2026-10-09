/**
 * verify.ts — 引文与论文真实性硬核探针
 * 直连 doi.org / Crossref / arXiv 官方服务器探测，防范模型编造幻觉论文。
 */

export type VerificationVerdict = 'VERIFIED' | 'METADATA_MISMATCH' | 'FABRICATED' | 'UNVERIFIABLE'

export interface VerificationResult {
  target: {
    doi?: string
    arxiv_id?: string
    claimed_title: string
  }
  verdict: VerificationVerdict
  real_title?: string
  real_authors?: string[]
  real_year?: number
  real_venue?: string
  confidence: number
  reason: string
}

// 简单相似度计算（词项 Jaccard 相似度）
function calculateTitleSimilarity(str1: string, str2: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)

  const words1 = new Set(norm(str1))
  const words2 = new Set(norm(str2))

  if (words1.size === 0 || words2.size === 0) return 0

  let intersection = 0
  for (const w of words1) {
    if (words2.has(w)) intersection++
  }

  const union = new Set([...words1, ...words2]).size
  return union === 0 ? 0 : intersection / union
}

// 验证 DOI
async function verifyDoi(doi: string, claimedTitle: string): Promise<VerificationResult> {
  const cleanDoi = doi.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
  const url = `https://api.crossref.org/works/${encodeURIComponent(cleanDoi)}`

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'DSH-Research-Core/0.0.1 (Anti-Hallucination-Probe)',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (res.status === 404) {
      return {
        target: { doi: cleanDoi, claimed_title: claimedTitle },
        verdict: 'FABRICATED',
        confidence: 0.99,
        reason: `DOI [${cleanDoi}] 在 Crossref 注册局中不存在（404 Not Found），疑似捏造引文。`,
      }
    }

    if (!res.ok) {
      return {
        target: { doi: cleanDoi, claimed_title: claimedTitle },
        verdict: 'UNVERIFIABLE',
        confidence: 0.3,
        reason: `DOI 解析服务异常（HTTP ${res.status}），暂无法完成验证。`,
      }
    }

    const data: any = await res.json()
    const item = data.message
    const realTitle = item.title?.[0] || ''
    const realAuthors = (item.author || []).map((a: any) => `${a.given || ''} ${a.family || ''}`.trim())
    const realYear = item.issued?.['date-parts']?.[0]?.[0]
    const realVenue = item['container-title']?.[0]

    const similarity = calculateTitleSimilarity(claimedTitle, realTitle)

    if (similarity >= 0.6) {
      return {
        target: { doi: cleanDoi, claimed_title: claimedTitle },
        verdict: 'VERIFIED',
        real_title: realTitle,
        real_authors: realAuthors,
        real_year: realYear,
        real_venue: realVenue,
        confidence: Math.min(0.99, 0.7 + similarity * 0.3),
        reason: `DOI 解析成功且标题高度吻合（相似度 ${(similarity * 100).toFixed(1)}%）。`,
      }
    } else {
      return {
        target: { doi: cleanDoi, claimed_title: claimedTitle },
        verdict: 'METADATA_MISMATCH',
        real_title: realTitle,
        real_authors: realAuthors,
        real_year: realYear,
        real_venue: realVenue,
        confidence: 0.85,
        reason: `DOI 真实存在，但注册标题与声称标题严重不符。真实: "${realTitle}"，声称: "${claimedTitle}"`,
      }
    }
  } catch (err: any) {
    return {
      target: { doi: cleanDoi, claimed_title: claimedTitle },
      verdict: 'UNVERIFIABLE',
      confidence: 0.2,
      reason: `网络超时或连接失败: ${err.message}`,
    }
  }
}

// 验证 arXiv ID
async function verifyArxiv(arxivId: string, claimedTitle: string): Promise<VerificationResult> {
  const cleanId = arxivId.trim().replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf|src)\//i, '').replace(/\.pdf$/, '')
  const url = `http://export.arxiv.org/api/query?id_list=${encodeURIComponent(cleanId)}`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) {
      return {
        target: { arxiv_id: cleanId, claimed_title: claimedTitle },
        verdict: 'UNVERIFIABLE',
        confidence: 0.3,
        reason: `arXiv API 服务异常 (HTTP ${res.status})`,
      }
    }

    const xml = await res.text()
    if (!xml.includes('<entry>') || xml.includes('<entry>\n    <title>Error</title>')) {
      return {
        target: { arxiv_id: cleanId, claimed_title: claimedTitle },
        verdict: 'FABRICATED',
        confidence: 0.98,
        reason: `arXiv 数据库中未找到 ID [${cleanId}]，疑似捏造。`,
      }
    }

    const titleMatch = xml.match(/<title>([\s\S]*?)<\/title>/i)
    // 跳过 feed 顶部的总体 title
    const entryTitle = xml.split('<entry>')[1]?.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || ''

    const similarity = calculateTitleSimilarity(claimedTitle, entryTitle)

    if (similarity >= 0.6) {
      return {
        target: { arxiv_id: cleanId, claimed_title: claimedTitle },
        verdict: 'VERIFIED',
        real_title: entryTitle,
        confidence: 0.95,
        reason: `arXiv ID 验证成功，文章真实存在且标题吻合。`,
      }
    } else {
      return {
        target: { arxiv_id: cleanId, claimed_title: claimedTitle },
        verdict: 'METADATA_MISMATCH',
        real_title: entryTitle,
        confidence: 0.85,
        reason: `arXiv ID 存在但标题不符。真实: "${entryTitle}"，声称: "${claimedTitle}"`,
      }
    }
  } catch (err: any) {
    return {
      target: { arxiv_id: cleanId, claimed_title: claimedTitle },
      verdict: 'UNVERIFIABLE',
      confidence: 0.2,
      reason: `网络连接失败: ${err.message}`,
    }
  }
}

export async function verifyCitation(input: {
  doi?: string
  arxiv_id?: string
  claimed_title: string
}): Promise<VerificationResult> {
  if (input.doi) {
    return verifyDoi(input.doi, input.claimed_title)
  }
  if (input.arxiv_id) {
    return verifyArxiv(input.arxiv_id, input.claimed_title)
  }
  return {
    target: { claimed_title: input.claimed_title },
    verdict: 'UNVERIFIABLE',
    confidence: 0.0,
    reason: '未提供 DOI 或 arXiv ID，无法进行确定性注册局核验。',
  }
}
