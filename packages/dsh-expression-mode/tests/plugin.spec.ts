import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.ts'

const directories: string[] = []
const originalHome = process.env.DSH_HOME
afterEach(async () => {
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('plugin composition', () => {
  it('registers explicit skill with complete metadata and scientific protections, then disposes everything', async () => {
    const home = await mkdtemp(join(tmpdir(), 'expression-plugin-')); directories.push(home); process.env.DSH_HOME = home
    const disposers: (() => void | Promise<void>)[] = []; const removed: string[] = []; let skill: any; let command: any
    const services = {
      commands: { register: (definition: any) => { command = definition; return () => { removed.push('command') } } },
      webServer: { register: () => () => { removed.push('route') } },
      agents: { list: () => [] },
      skills: { register: (definition: any) => {
        // Mirrors the real registry's load validation: registration can succeed
        // with incomplete source metadata, while a subsequent get() must fail.
        expect(typeof definition.source).toBe('string')
        expect(typeof definition.content).toBe('string')
        skill = definition; return () => { removed.push('skill') }
      } },
    }
    const ctx = {
      get: (key: keyof typeof services) => services[key],
      on: () => () => { removed.push('listener') },
      effect: (factory: () => () => void) => { const dispose = factory(); disposers.push(dispose); return dispose },
    }
    await apply(ctx as never)
    expect(skill.source).toBe('runtime')
    expect(skill.invocation).toEqual({ modelInvocable: false, userInvocable: true })
    expect(skill.content).toContain('Quote frozen formulas verbatim')
    expect(skill.content).toContain('Re versus absolute square')
    expect(skill.content).toContain('summation limits')
    expect(skill.content).toContain('Do not change the session')
    expect((await command.handler({ agent: { session: { id: 'fresh' } }, rawInput: 'status' })).text).toContain('已关闭')
    for (const dispose of disposers.reverse()) await dispose()
    expect(removed.sort()).toEqual(['command', 'listener', 'route', 'skill'])
    expect((await command.handler({ agent: { session: { id: 'fresh' } }, rawInput: 'ste' })).kind).toBe('error')
  })
})
