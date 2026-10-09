/**
 * citation-gate.ts — 引文防幻觉硬核门禁
 * 扫描文本中的 DOI 与 arXiv 标识，对未核验或已证实为虚构的引用进行拦截阻断。
 */

import { verifyCitation, VerificationResult } from '../tools/verify.js'

export interface CitationViolation {
  raw: string
  identifier: string
  type: 'doi' | 'arxiv'
  reason: string
}

export interface CitationAuditReport {
  passed: boolean
  total_detected: number
  verified_count: number
  violations: CitationViolation[]
}

const DOI_REGEX = /\b(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)\b/g
const ARXIV_REGEX = /\barXiv:\s*(\d{4}\.\d{4,5}(?:v\d+)?|[a-zA-Z\-]+(?:\.[a-zA-Z]{2})?\/\d{7}(?:v\d+)?)\b/gi

export async function auditCitationsInText(
  text: string,
  knownVerifiedIds: Set<string> = new Set(),
): Promise<CitationAuditReport> {
  const detectedDois = Array.from(text.matchAll(DOI_REGEX)).map((m) => m[1])
  const detectedArxiv = Array.from(text.matchAll(ARXIV_REGEX)).map((m) => m[1])

  const violations: CitationViolation[] = []
  let verifiedCount = 0

  // 1. 检查 DOI
  for (const doi of detectedDois) {
    const clean = doi.toLowerCase().trim()
    if (knownVerifiedIds.has(clean)) {
      verifiedCount++
      continue
    }

    // 尝试轻量验证
    const res = await verifyCitation({ doi: clean, claimed_title: '' })
    if (res.verdict === 'FABRICATED') {
      violations.push({
        raw: doi,
        identifier: clean,
        type: 'doi',
        reason: res.reason,
      })
    } else {
      verifiedCount++
      knownVerifiedIds.add(clean)
    }
  }

  // 2. 检查 arXiv ID
  for (const aid of detectedArxiv) {
    const clean = aid.toLowerCase().trim()
    if (knownVerifiedIds.has(clean)) {
      verifiedCount++
      continue
    }

    const res = await verifyCitation({ arxiv_id: clean, claimed_title: '' })
    if (res.verdict === 'FABRICATED') {
      violations.push({
        raw: aid,
        identifier: clean,
        type: 'arxiv',
        reason: res.reason,
      })
    } else {
      verifiedCount++
      knownVerifiedIds.add(clean)
    }
  }

  return {
    passed: violations.length === 0,
    total_detected: detectedDois.length + detectedArxiv.length,
    verified_count: verifiedCount,
    violations,
  }
}
