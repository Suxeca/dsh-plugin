import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { createNoteBoardReadTool, injectNoteBoardReadTool, MAX_ENTRY_PAGE_CHARS } from '../src/host/entry-read.ts'
import { readBoundedFile } from '../src/host/read.ts'
import type { LedgerRef } from '../src/shared.ts'

const root = mkdtempSync(join(tmpdir(), 'note-entry-read-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function notePath(name: string): string {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  return join(dir, 'ledger.md')
}

function agent(id: string, cwd: string) {
  return { id, session: { header: { cwd } } }
}

function runContext(id: string, cwd: string): ToolRunContext {
  return { agent: agent(id, cwd) } as unknown as ToolRunContext
}

function body(value: string): Record<string, any> {
  return JSON.parse(value) as Record<string, any>
}

function resolverFor(paths: Record<string, string>, state: Record<string, 'attached' | 'discovered' | 'none' | 'off'> = {}) {
  const seen: Array<{ id: string, cwd: string }> = []
  return {
    seen,
    resolve: async (id: string, cwd: string): Promise<LedgerRef> => {
      seen.push({ id, cwd })
      const source = state[id] ?? 'attached'
      if (source === 'none' || source === 'off') return { source }
      const path = paths[id]
      return { source, path, title: id }
    },
  }
}

const common = (resolve: ReturnType<typeof resolverFor>['resolve'], maxReadChars = 500_000) => ({
  resolve,
  maxReadChars,
  pinnedSections: ['*'], // Logs must remain excluded despite a wildcard pin.
})

describe('note_board_read', () => {
  it('registers only after tools mounts and unregisters with the late scope disposer', async () => {
    const pathA = notePath('register-a')
    writeFileSync(pathA, '## FACT-A\nalpha\n', 'utf8')
    const resolution = resolverFor({ sessionA: pathA })
    let onTools: ((scope: unknown) => void) | undefined
    const tools = new Map<string, ToolDefinition>()
    let unregister: (() => void) | undefined
    const ctx = {
      inject(names: string[], callback: (scope: unknown) => void) {
        expect(names).toEqual(['tools'])
        onTools = callback
      },
    } as unknown as Context

    injectNoteBoardReadTool(ctx, common(resolution.resolve))
    expect(tools.size).toBe(0)
    onTools?.({
      tools: { register(tool: ToolDefinition) { tools.set(tool.name, tool); return () => { tools.delete(tool.name) } } },
      effect(register: () => () => void) { unregister = register() },
    })
    const tool = tools.get('note_board_read')
    expect(tool).toBeDefined()
    const answer = body(await tool!.execute({ section_id: 'FACT-A' }, runContext('sessionA', '/work/a')))
    expect(answer.text).toContain('alpha')
    expect(resolution.seen).toEqual([{ id: 'sessionA', cwd: '/work/a' }])

    unregister?.()
    expect(tools.has('note_board_read')).toBe(false)
  })

  it('derives both session and cwd from each actual tool agent, never tool arguments', async () => {
    const pathA = notePath('isolation-a')
    const pathB = notePath('isolation-b')
    writeFileSync(pathA, '## KNOW-A\nonly-a\n', 'utf8')
    writeFileSync(pathB, '## KNOW-B\nonly-b\n', 'utf8')
    const resolution = resolverFor({ one: pathA, two: pathB })
    const tool = createNoteBoardReadTool(common(resolution.resolve))

    const first = body(await tool.execute({ section_id: 'KNOW-A', sessionId: 'two', path: pathB } as never, runContext('one', '/cwd/one')))
    const second = body(await tool.execute({ section_id: 'KNOW-B' }, runContext('two', '/cwd/two')))
    expect(first.text).toContain('only-a')
    expect(first.text).not.toContain('only-b')
    expect(second.text).toContain('only-b')
    expect(resolution.seen).toEqual([{ id: 'one', cwd: '/cwd/one' }, { id: 'two', cwd: '/cwd/two' }])
  })

  it('refuses off and none without reading a note', async () => {
    const read = async () => { throw new Error('must not read') }
    const off = createNoteBoardReadTool({ ...common(async () => ({ source: 'off' })), read })
    const none = createNoteBoardReadTool({ ...common(async () => ({ source: 'none' })), read })
    expect(body(await off.execute({ section_id: 'K' }, runContext('off-session', '/cwd'))).status).toBe('injection-off')
    expect(body(await none.execute({ section_id: 'K' }, runContext('none-session', '/cwd'))).status).toBe('no-note-bound')
  })

  it('excludes logs even with wildcard pinned and returns no log body on any path', async () => {
    const path = notePath('no-log-leak')
    const rawSecret = 'RUNLOG-UNIQUE-SECRET-93812'
    writeFileSync(path, `## OPEN-1\nknowledge-only\n## RUN-LOG-1\n${rawSecret}\n`, 'utf8')
    const resolution = resolverFor({ s: path })
    const tool = createNoteBoardReadTool(common(resolution.resolve))

    const knowledge = await tool.execute({ section_id: 'OPEN-1' }, runContext('s', '/work'))
    const blocked = await tool.execute({ section_id: 'RUN-LOG-1' }, runContext('s', '/work'))
    const wildcardAttempt = await tool.execute({ section_id: '*' }, runContext('s', '/work'))
    for (const output of [knowledge, blocked, wildcardAttempt]) expect(output).not.toContain(rawSecret)
    expect(body(knowledge).text).toContain('knowledge-only')
    expect(body(blocked).status).toBe('run-log-excluded')
    expect(body(wildcardAttempt).status).toBe('section-not-found')
  })

  it('rejects duplicate ids case-insensitively instead of choosing one', async () => {
    const path = notePath('duplicates')
    writeFileSync(path, '## TASK-4\nfirst\n## task-4\nsecond\n', 'utf8')
    const resolution = resolverFor({ s: path })
    const output = body(await createNoteBoardReadTool(common(resolution.resolve)).execute({ section_id: 'TaSk-4' }, runContext('s', '/work')))
    expect(output.status).toBe('ambiguous-section-id')
    expect(output.text).toBeUndefined()
  })

  it('pages large entries with revision-bound continuations and UTF-16-safe boundaries', async () => {
    const path = notePath('pagination')
    const content = `## LONG-ENTRY\n${'x'.repeat(MAX_ENTRY_PAGE_CHARS - 1)}🙂${'y'.repeat(MAX_ENTRY_PAGE_CHARS + 100)}\n`
    writeFileSync(path, content, 'utf8')
    const resolution = resolverFor({ s: path })
    const tool = createNoteBoardReadTool(common(resolution.resolve, 100_000))

    const pages: string[] = []
    let page = body(await tool.execute({ section_id: 'LONG-ENTRY', limit: MAX_ENTRY_PAGE_CHARS }, runContext('s', '/work')))
    const revision = page.revision as string
    expect(page.complete).toBe(false)
    expect(page.continuation).toEqual({ revision, offset: page.offset + page.text.length })
    pages.push(page.text as string)
    while (page.continuation !== null) {
      page = body(await tool.execute({ section_id: 'LONG-ENTRY', ...page.continuation, limit: MAX_ENTRY_PAGE_CHARS }, runContext('s', '/work')))
      expect(page.revision).toBe(revision)
      pages.push(page.text as string)
    }
    expect(page.complete).toBe(true)
    expect(pages.join('')).toContain('🙂')
    for (const part of pages) {
      const first = part.charCodeAt(0)
      const last = part.charCodeAt(part.length - 1)
      expect(first >= 0xdc00 && first <= 0xdfff).toBe(false)
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
    }
    expect(body(await tool.execute({ section_id: 'LONG-ENTRY', offset: 1 }, runContext('s', '/work'))).status).toBe('revision-required')
  })

  it('allows one supplementary character to exceed a one-unit page without stalling', async () => {
    const path = notePath('single-surrogate')
    writeFileSync(path, '## EMOJI\n🙂tail\n', 'utf8')
    const resolution = resolverFor({ s: path })
    const tool = createNoteBoardReadTool(common(resolution.resolve))
    const headerLength = '## EMOJI'.length
    const first = body(await tool.execute({ section_id: 'EMOJI', limit: headerLength }, runContext('s', '/work')))
    expect(first.text).toBe('## EMOJI')
    const emojiPage = body(await tool.execute({ section_id: 'EMOJI', ...first.continuation, limit: 1 }, runContext('s', '/work')))
    expect(emojiPage.text).toBe('\n') // Section text's trimmed heading line has a newline before the emoji.
    const pairPage = body(await tool.execute({ section_id: 'EMOJI', ...emojiPage.continuation, limit: 1 }, runContext('s', '/work')))
    expect(pairPage.text).toBe('🙂')
    expect(pairPage.text.length).toBe(2)
    expect(pairPage.limit).toBe(2)
    expect(pairPage.continuation.offset).toBe(pairPage.offset + 2)
    const tail = body(await tool.execute({ section_id: 'EMOJI', ...pairPage.continuation, limit: 1 }, runContext('s', '/work')))
    expect(tail.text).toBe('t')
    expect(tail.continuation.offset).toBeGreaterThan(pairPage.continuation.offset)
  })

  it('returns no page on a changed revision so pages cannot be mixed', async () => {
    const path = notePath('revision-change')
    writeFileSync(path, '## OPEN\nold-value\n', 'utf8')
    const resolution = resolverFor({ s: path })
    const tool = createNoteBoardReadTool(common(resolution.resolve))
    const first = body(await tool.execute({ section_id: 'OPEN', limit: 5 }, runContext('s', '/work')))
    writeFileSync(path, '## OPEN\nnew-value\n', 'utf8')
    const changed = body(await tool.execute({ section_id: 'OPEN', offset: 5, revision: first.revision }, runContext('s', '/work')))
    expect(changed.status).toBe('revision-changed')
    expect(changed.text).toBeUndefined()
    expect(changed.revision).not.toBe(first.revision)
  })

  it('uses the bounded regular-file reader and reports a capped entry as incomplete', async () => {
    const path = notePath('bounded')
    writeFileSync(path, `## BIG\n${'z'.repeat(1000)}\n`, 'utf8')
    const file = await readBoundedFile(path, 40)
    expect(file.text.length).toBeLessThanOrEqual(40)
    expect(file.truncated).toBe(true)

    const resolution = resolverFor({ s: path })
    const output = body(await createNoteBoardReadTool(common(resolution.resolve, 40)).execute({ section_id: 'BIG' }, runContext('s', '/work')))
    expect(output.status).toBe('file-truncated')
    expect(output.complete).toBeUndefined()
    expect(output.fileTruncated).toBeUndefined()
    expect(output.text).toBeUndefined()
    expect(output.message).toContain('duplicate-id checks are inconclusive')
  })

  it('does not expose a prefix when a duplicate id may be hidden beyond the read cap', async () => {
    const path = notePath('hidden-duplicate')
    writeFileSync(path, `## TARGET\n${'a'.repeat(80)}\n## target\nsecret-second-entry\n`, 'utf8')
    const resolution = resolverFor({ s: path })
    const output = body(await createNoteBoardReadTool(common(resolution.resolve, 40)).execute({ section_id: 'TARGET' }, runContext('s', '/work')))
    expect(output.status).toBe('file-truncated')
    expect(output.text).toBeUndefined()
    expect(JSON.stringify(output)).not.toContain('secret-second-entry')
  })
})
