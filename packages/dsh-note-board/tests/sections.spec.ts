import { describe, expect, it } from 'vitest'
import { DEFAULT_PINNED_SECTIONS, injectionPlan, knowledgeIndex, sectionsOf, selectNote } from '../src/sections.ts'
import { ledgerBody } from '../src/host/inject.ts'

const ref = { source: 'attached' as const, path: '/example/notes/ledger.md', title: 'Example' }
const note = [
  '# Example knowledge',
  '## FROZEN-1 · convention',
  'DEFINITION',
  '## OPEN-1 · hypothesis (unverified)',
  'HYPOTHESIS',
  '## RUN-LOG-1 · a run',
  'RAW-OUTPUT',
  '## MUTATION-LOG',
  'OLD-OUTPUT',
].join('\n')

describe('knowledge and run logs share one classification', () => {
  it('separates browsing content without modifying the source', () => {
    const selected = selectNote(note)
    expect(selected.knowledge.map(section => section.id)).toEqual(['FROZEN-1', 'OPEN-1'])
    expect(selected.logs.map(section => section.id)).toEqual(['RUN-LOG-1', 'MUTATION-LOG'])
    expect(selected.knowledgeText).toContain('HYPOTHESIS')
    expect(selected.knowledgeText).not.toContain('RAW-OUTPUT')
    expect(selected.logsText).toContain('OLD-OUTPUT')
    expect(selected.residentText).toContain('DEFINITION')
    expect(selected.residentText).not.toContain('HYPOTHESIS')
  })

  it('excludes logs even from a wildcard pin', () => {
    const selected = selectNote(note, ['*'])
    expect(selected.residentText).toContain('HYPOTHESIS')
    expect(selected.residentText).not.toContain('RAW-OUTPUT')
    expect(selected.residentText).not.toContain('OLD-OUTPUT')
  })

  it('supports explicit custom log ids without guessing from prose', () => {
    const text = '## TASK-1\nrun progress\n## run-log-1\ndata'
    expect(selectNote(text).onDemand.map(section => section.id)).toEqual(['TASK-1'])
    expect(selectNote(text, ['*'], ['TASK*', 'run-log*']).knowledge).toHaveLength(0)
  })

  it('does not split fenced Markdown examples into knowledge', () => {
    for (const fence of ['```', '~~~~']) {
      const text = `## RUN-LOG\n${fence}md\n## FROZEN-FAKE\nSECRET-OUTPUT\n${fence}\n## FROZEN-REAL\nREAL`
      const selected = selectNote(text)
      expect(selected.pinned.map(section => section.id)).toEqual(['FROZEN-REAL'])
      expect(selected.logsText).toContain('SECRET-OUTPUT')
      expect(selected.residentText).not.toContain('SECRET-OUTPUT')
    }
  })

  it('keeps fences in a preamble and respects longer fence delimiters', () => {
    const text = '# Example\n````md\n```\n## FROZEN-FAKE\n````\n## FROZEN-REAL\nreal'
    expect(sectionsOf(text).sections.map(section => section.id)).toEqual(['FROZEN-REAL'])
    expect(sectionsOf(text).preamble).toContain('## FROZEN-FAKE')
  })

  it('preserves whole headingless knowledge beyond the soft budget', () => {
    const text = 'formula '.repeat(1000) + 'END-OF-FORMULA'
    const selected = selectNote(text)
    const plan = injectionPlan(selected, 6000)
    expect(plan.overBudget).toBe(true)
    expect(plan.residentChars).toBe(text.length)
    expect(ledgerBody(ref, text, 6000, DEFAULT_PINNED_SECTIONS)).toContain('END-OF-FORMULA')
  })

  it('counts preamble as resident, not just pinned sections', () => {
    const selected = selectNote('A'.repeat(6100) + '\n## OPEN-1\nB')
    expect(injectionPlan(selected, 6000).overBudget).toBe(true)
    expect(injectionPlan(selected, 6000).residentChars).toBe(6100)
  })

  it('does not confuse a long file with a long resident body', () => {
    const selected = selectNote(note + 'X'.repeat(10000))
    expect(injectionPlan(selected, 6000).overBudget).toBe(false)
    expect(injectionPlan(selected, 6000).logIds).toHaveLength(2)
  })

  it('indexes on-demand titles without bodies or log metadata', () => {
    const index = knowledgeIndex(selectNote(note))
    expect(index).toContain('OPEN-1 · hypothesis (unverified)')
    expect(index).toContain('依赖')
    expect(index).not.toContain('HYPOTHESIS')
    expect(index).not.toContain('RUN-LOG-1')
  })

  it('keeps snapshots stable across log additions, removals and growth', () => {
    const original = ledgerBody(ref, note, 6000, DEFAULT_PINNED_SECTIONS)
    for (const changed of [
      note + '\nmore run output',
      note + '\n## JOURNAL-2\nnew output',
      note.replace('## RUN-LOG-1 · a run\nRAW-OUTPUT\n', ''),
      note.replace('RAW-OUTPUT', 'RAW-OUTPUT\n'.repeat(1000)),
    ]) expect(ledgerBody(ref, changed, 6000, DEFAULT_PINNED_SECTIONS)).toBe(original)
  })

  it('blocks partial authoritative text at the independent file read cap', () => {
    const preview = ledgerBody(ref, note, 6000, DEFAULT_PINNED_SECTIONS, undefined, true)
    expect(preview).toContain('文件读取上限')
    expect(preview).toContain(ref.path)
    expect(preview).not.toContain('DEFINITION')
    const plan = injectionPlan(selectNote(note), 6000, true)
    expect(plan.blocked).toBe(true)
    expect(plan.residentChars).toBe(0)
    expect(plan.pinnedIds).toEqual([])
  })

  it('does not equate directory membership with verified or read knowledge', () => {
    const body = ledgerBody(ref, note, 6000, DEFAULT_PINNED_SECTIONS)!
    expect(body).toContain('收录本身不表示已证实')
    expect(body).toContain('不能仅凭目录作答')
    expect(body).toContain('先逐字抄录')
    expect(body).toContain(ref.path)
    expect(body).not.toContain('RAW-OUTPUT')
  })
})
