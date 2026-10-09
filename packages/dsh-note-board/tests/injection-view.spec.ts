import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { isValidElement } from 'react'
import type { LedgerPayload } from '../src/shared.ts'
import { injectionPlan, selectNote } from '../src/sections.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ MarkdownText: () => null }))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}))

import { AbsorptionLine } from '../src/client/Body.tsx'

function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(textOf).join('\n')
  if (isValidElement(node)) return textOf((node.props as { children?: unknown }).children)
  return String(node)
}

const payload = (text: string, truncated = false): LedgerPayload => ({
  ref: { source: 'attached', path: '/example/notes/ledger.md', title: 'Example' },
  exists: true, mtime: 0, bytes: text.length, text, truncated, injectBudget: 6000,
  injection: injectionPlan(selectNote(text), 6000, truncated),
  injectionPreview: 'EXACT PREVIEW',
})

describe('truthful injection status', () => {
  it('reports resident scope rather than whole-file length or successful use', () => {
    const rendered = textOf(AbsorptionLine({ ledger: payload('## FROZEN-1\ncore\n## RUN-LOG\n' + 'X'.repeat(8000)) }))
    expect(rendered).toContain('运行日志 1 节（不自动注入）')
    expect(rendered).toContain('非已送达或已使用证明')
    expect(rendered).toContain('EXACT PREVIEW')
    expect(rendered).not.toContain('超出的尾部')
    expect(rendered).not.toContain('已与对话同步')
  })

  it('says over-budget core is still whole', () => {
    const rendered = textOf(AbsorptionLine({ ledger: payload('## FROZEN-1\n' + 'X'.repeat(7000)) }))
    expect(rendered).toContain('仍完整提供')
    expect(rendered).toContain('软预算')
  })

  it('warns on truncated reads and old-server missing metadata', () => {
    expect(textOf(AbsorptionLine({ ledger: payload('partial', true) }))).toContain('当前视图不完整')
    const { injection, injectionPreview, ...legacy } = payload('short')
    expect(textOf(AbsorptionLine({ ledger: legacy }))).toContain('未提供注入范围')
    expect(AbsorptionLine({ ledger: null })).toBeNull()
  })

  it('wires a distinct run-log pane without falling back to the knowledge body', () => {
    const source = readFileSync(new URL('../src/client/Body.tsx', import.meta.url), 'utf8')
    expect(source).toContain('label: t.segmentLogs')
    expect(source).toContain("segment === 'logs' ? ledgerPane(true)")
    expect(source).toContain("logs ? (ledger.runLogsText ?? '')")
  })
})
