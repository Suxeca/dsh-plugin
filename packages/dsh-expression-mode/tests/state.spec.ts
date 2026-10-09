import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile, rm, stat, readdir, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExpressionStore } from '../src/host/state.ts'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function location() { const dir = await mkdtemp(join(tmpdir(), 'expression-test-')); directories.push(dir); return join(dir, 'state.json') }

describe('durable per-session modes', () => {
  it('defaults off without creating a file', async () => {
    const path = await location(); const store = await ExpressionStore.open(path, 'rules-a')
    expect(await store.get('a')).toEqual({ sessionId: 'a', mode: 'default', language: 'auto', revision: 0, updatedAt: null, ruleVersion: 'rules-a' })
    await store.set('a', 'default')
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('isolates sessions and restores state and rule version after restart', async () => {
    const path = await location(); const store = await ExpressionStore.open(path, 'rules-a')
    await store.set('a', 'ste')
    expect((await store.get('b')).mode).toBe('default')
    const restored = await ExpressionStore.open(path, 'rules-b')
    expect(await restored.get('a')).toMatchObject({ mode: 'ste', revision: 1, ruleVersion: 'rules-b' })
    await restored.set('a', 'default')
    const reopened = await ExpressionStore.open(path, 'rules-b')
    expect(await reopened.get('a')).toMatchObject({ mode: 'default', revision: 2 })
  })
  it('serializes concurrent writes and does not increment on a no-op', async () => {
    const path = await location(); const store = await ExpressionStore.open(path, 'v')
    await Promise.all([store.set('a', 'ste'), store.set('b', 'ste'), store.set('a', 'default')])
    expect((await store.get('a')).revision).toBe(2)
    expect((await store.get('b')).revision).toBe(1)
    await store.set('b', 'ste'); expect((await store.get('b')).revision).toBe(1)
    expect(Object.keys(JSON.parse(await readFile(path, 'utf8')).sessions)).toEqual(['a', 'b'])
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await readdir(join(path, '..'))).filter(name => name.endsWith('.tmp'))).toEqual([])
  })
  it('rejects invalid identity, mode and prototype-like keys', async () => {
    const store = await ExpressionStore.open(await location(), 'v')
    await expect(store.get('../a')).rejects.toThrow('Invalid session')
    expect(() => store.set('__proto__', 'ste')).toThrow('Invalid session')
    await expect(store.set('a', 'fake' as never)).rejects.toThrow('Invalid expression mode')
  })
  it.each(['{broken', '{"version":3,"sessions":{}}', '{"version":1,"sessions":{"a":{"mode":"fake","revision":1,"updatedAt":0}}}', '{"version":1,"sessions":{"a":{"mode":"ste","revision":0,"updatedAt":0}}}'])('fails closed on corrupt state %s', async value => {
    const path = await location(); await writeFile(path, value)
    await expect(ExpressionStore.open(path, 'v')).rejects.toThrow()
  })
  it('changes only the selected dimension and persists all six combinations', async () => {
    const path = await location(); const store = await ExpressionStore.open(path, 'v')
    for (const mode of ['default', 'ste'] as const) {
      for (const language of ['auto', 'zh', 'en'] as const) {
        await store.update('a', { mode, language })
        expect(await store.get('a')).toMatchObject({ mode, language })
        const reopened = await ExpressionStore.open(path, 'v')
        expect(await reopened.get('a')).toMatchObject({ mode, language })
      }
    }
    await store.update('a', { language: 'zh' })
    await store.update('a', { mode: 'default' })
    expect(await store.get('a')).toMatchObject({ mode: 'default', language: 'zh' })
  })
  it('atomically merges concurrent language and style patches', async () => {
    const store = await ExpressionStore.open(await location(), 'v')
    await Promise.all([store.update('a', { language: 'zh' }), store.update('a', { mode: 'ste' })])
    expect(await store.get('a')).toMatchObject({ mode: 'ste', language: 'zh', revision: 2 })
    expect(await store.get('b')).toMatchObject({ mode: 'default', language: 'auto', revision: 0 })
  })
  it('does not retain a caller-owned mutable patch', async () => {
    const store = await ExpressionStore.open(await location(), 'v')
    const patch: { language: 'zh' | 'en' } = { language: 'zh' }
    const pending = store.update('a', patch); patch.language = 'en'; await pending
    expect((await store.get('a')).language).toBe('zh')
  })
  it('migrates v1 preferences without changing behavior or writing during read', async () => {
    const path = await location()
    const original = JSON.stringify({ version: 1, sessions: {
      english: { mode: 'ste', revision: 7, updatedAt: 10 },
      original: { mode: 'default', revision: 2, updatedAt: 11 },
    } })
    await writeFile(path, original)
    const store = await ExpressionStore.open(path, 'v')
    expect(await store.get('english')).toMatchObject({ mode: 'ste', language: 'en', revision: 7 })
    expect(await store.get('original')).toMatchObject({ mode: 'default', language: 'auto', revision: 2 })
    expect(await readFile(path, 'utf8')).toBe(original)
    await store.update('english', { language: 'zh' })
    const saved = JSON.parse(await readFile(path, 'utf8'))
    expect(saved.version).toBe(2)
    expect(saved.sessions.original).toMatchObject({ mode: 'default', language: 'auto', revision: 2 })
    expect(await (await ExpressionStore.open(path, 'v')).get('english')).toMatchObject({ language: 'zh', revision: 8 })
  })
  it.each([{}, { language: 'fr' }, { mode: 'fake' }, { language: undefined }, { path: '/tmp/x' }])('rejects invalid partial settings %j', async patch => {
    const store = await ExpressionStore.open(await location(), 'v')
    await expect(store.update('a', patch as never)).rejects.toThrow('Invalid expression settings')
    expect((await store.get('a')).revision).toBe(0)
  })
  it.each([
    { mode: 'ste', revision: 1, updatedAt: 1 },
    { mode: 'ste', language: 'fr', revision: 1, updatedAt: 1 },
  ])('rejects invalid v2 language entries %j', async entry => {
    const path = await location(); await writeFile(path, JSON.stringify({ version: 2, sessions: { a: entry } }))
    await expect(ExpressionStore.open(path, 'v')).rejects.toThrow()
  })
  it('drains admitted writes and refuses new writes after close', async () => {
    const path = await location(); const store = await ExpressionStore.open(path, 'v')
    const writing = store.set('a', 'ste')
    await store.close(); await writing
    await expect((await ExpressionStore.open(path, 'v')).get('a')).resolves.toMatchObject({ mode: 'ste' })
    await expect(store.set('b', 'ste')).rejects.toThrow('closed')
  })
  it('does not acknowledge failed saves and can recover after failure', async () => {
    const path = await location(); const store = await ExpressionStore.open(path, 'v')
    await mkdir(path)
    await expect(store.set('a', 'ste')).rejects.toThrow()
    expect((await store.get('a')).mode).toBe('default')
    await rm(path, { recursive: true }); await store.set('a', 'ste')
    expect((await store.get('a')).mode).toBe('ste')
  })
})
