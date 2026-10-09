import { describe, expect, it } from 'vitest'
import { registerExpressionCommand } from '../src/host/command.ts'
import type { ExpressionMode, ExpressionLanguage, ExpressionPatch } from '../src/shared.ts'

function fixture(fail = false) {
  let registered: any
  const values = new Map<string, { mode: ExpressionMode; language: ExpressionLanguage }>()
  const store = {
    get: async (sessionId: string) => ({ sessionId, mode: values.get(sessionId)?.mode ?? 'default',
      language: values.get(sessionId)?.language ?? 'auto', revision: 0, updatedAt: null, ruleVersion: 'v' }),
    update: async (sessionId: string, patch: ExpressionPatch) => {
      if (fail) throw new Error('private /secret/path')
      const old = values.get(sessionId) ?? { mode: 'default' as const, language: 'auto' as const }
      values.set(sessionId, { mode: patch.mode ?? old.mode, language: patch.language ?? old.language })
      return store.get(sessionId)
    },
    set: (sessionId: string, mode: ExpressionMode) => store.update(sessionId, { mode, language: mode === 'ste' ? 'en' : 'auto' }),
  }
  registerExpressionCommand({ get: () => ({ register: (definition: any) => { registered = definition; return () => {} } }) } as never, store)
  return { definition: registered, store, run: (rawInput: string, id = 'a') => registered.handler({ rawInput, agent: { session: { id } } }) }
}

describe('human-only expression command', () => {
  it('supports legacy shortcuts and explicit session-isolated switching', async () => {
    const f = fixture(); expect(f.definition.name).toBe('expression'); expect(f.definition.recordInput).toBe(false)
    expect((await f.run('status')).text).toContain('已关闭')
    expect((await f.run('ste')).text).toContain('已开启')
    expect(await f.store.get('a')).toMatchObject({ mode: 'ste', language: 'en' })
    expect((await f.run('status', 'b')).text).toContain('已关闭')
    expect((await f.run('default')).text).toContain('已关闭')
    expect(await f.store.get('a')).toMatchObject({ mode: 'default', language: 'auto' })
  })
  it('switches languages without enabling clarity style', async () => {
    const f = fixture()
    expect((await f.run('zh')).text).toContain('语言：中文')
    expect(await f.store.get('a')).toMatchObject({ mode: 'default', language: 'zh' })
    expect((await f.run('en')).text).toContain('语言：English')
    expect((await f.run('lang auto')).text).toContain('跟随原有策略')
  })
  it('switches style without resetting the selected language', async () => {
    const f = fixture(); await f.run('zh'); await f.run('style ste')
    expect(await f.store.get('a')).toMatchObject({ mode: 'ste', language: 'zh' })
    await f.run('style default')
    expect(await f.store.get('a')).toMatchObject({ mode: 'default', language: 'zh' })
    await f.run('style ste'); await f.run('auto')
    expect(await f.store.get('a')).toMatchObject({ mode: 'ste', language: 'auto' })
  })
  it.each(['on forever', 'lang fr', 'style fake', 'zh en'])('rejects unknown arguments %s without switching', async argument => {
    const f = fixture(); expect((await f.run(argument)).kind).toBe('error')
    expect(await f.store.get('a')).toMatchObject({ mode: 'default', language: 'auto' })
  })
  it('does not claim success or leak paths after a save failure', async () => {
    const result = await fixture(true).run('zh')
    expect(result.kind).toBe('error'); expect(result.text).not.toContain('/secret/path')
  })
})
