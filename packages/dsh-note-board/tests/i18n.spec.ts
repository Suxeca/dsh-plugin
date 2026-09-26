/**
 * The board's two languages, and the terminology rename.
 *
 * ## What this guards
 *
 * Three things that are easy to break and invisible until a human reads the UI
 * in the wrong language:
 *
 *  1. **A missing or untranslated string.** The `BoardStrings` interface makes a
 *     missing *key* a compile error, but nothing stops an English entry from
 *     being left in Chinese. The test that catches that is "no CJK in `EN`",
 *     with the one deliberate exception named below.
 *  2. **The old term coming back.** 账本 was renamed to 笔记 across the plugin and
 *     the preset; a new string written from the old vocabulary would reintroduce
 *     it silently, so it is asserted absent from every shipped source file.
 *  3. **The toggle losing its single source of truth.** The board must read the
 *     platform's locale rather than keep its own — see `i18n.ts` for why a
 *     board-local override leaves the tab label stranded in the other language.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EN, ZH, boardLocale, boardStrings, installBoardLocale, markdownLabels, subscribeBoardLocale,
  toggleBoardLocale, useBoardLocale, useBoardStrings,
} from '../src/client/i18n.ts'

/**
 * Every `useSyncExternalStore` call this module makes, so a hook's wiring can be
 * inspected without a renderer.
 *
 * `react` itself is replaced below: React's hooks are only callable inside a
 * render, and the property under test is not React's — it is whether *this*
 * module subscribes at all. Standing in a dispatcher records the
 * `(subscribe, getSnapshot)` pair the hook handed over, which is exactly what a
 * real renderer would use.
 */
const captured = vi.hoisted(() => ({
  dispatcherCalls: [] as Array<{ subscribe: (fn: () => void) => () => void, get: () => unknown }>,
}))

vi.mock('react', () => ({
  useSyncExternalStore: (subscribe: (fn: () => void) => () => void, get: () => unknown) => {
    captured.dispatcherCalls.push({ subscribe, get })
    return get()
  },
}))

const clientDir = join(import.meta.dirname, '../src/client')
const hostDir = join(import.meta.dirname, '../src/host')

/** Sources that ship, so the terminology invariant covers all of them. */
function shippedSources(): Array<{ path: string, text: string }> {
  const files = [
    ...readdirSync(clientDir).map(name => join(clientDir, name)),
    ...readdirSync(hostDir).map(name => join(hostDir, name)),
    join(import.meta.dirname, '../src/index.ts'),
    join(import.meta.dirname, '../src/shared.ts'),
    join(import.meta.dirname, '../src/shared-routes.ts'),
  ].filter(path => path.endsWith('.ts') || path.endsWith('.tsx'))
  return files.map(path => ({ path, text: readFileSync(path, 'utf8') }))
}

/** A stand-in for the platform's `locale` service. */
function fakeLocale(initial = 'zh') {
  let active = initial
  const listeners = new Set<() => void>()
  const setLocale = vi.fn((id: string) => {
    active = id
    for (const listener of [...listeners]) listener()
  })
  return {
    setLocale,
    getSnapshot: () => ({ active }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    /** How many listeners the board currently holds on the platform service. */
    listenerCount: () => listeners.size,
  }
}

/** Every locale in effect gets its installation disposed, so state cannot leak between tests. */
let installed: Array<() => void> = []
afterEach(() => {
  for (const dispose of installed) dispose()
  installed = []
})

const install = (service: unknown): void => { installed.push(installBoardLocale(service)) }

describe('dictionaries', () => {
  it('has the same key set in both languages', () => {
    // The interface already enforces this at compile time; the runtime check is
    // what fails loudly if someone reaches for `as never` to silence it.
    const zh = Object.keys(ZH).sort()
    const en = Object.keys(EN).sort()
    expect(en).toEqual(zh)
  })

  it('has no empty or whitespace-only string', () => {
    for (const [locale, dict] of [['zh', ZH], ['en', EN]] as const) {
      for (const [key, value] of Object.entries(dict)) {
        if (typeof value !== 'string') continue
        expect(value.trim(), `${locale}.${key}`).not.toBe('')
      }
    }
  })

  it('leaves no Chinese in the English dictionary', () => {
    // `languageToggle` is the single exception and it is deliberate: the button
    // shows the language it switches *to*, so in English it reads 中.
    const allowed = new Set(['languageToggle'])
    for (const [key, value] of Object.entries(EN)) {
      if (typeof value !== 'string' || allowed.has(key)) continue
      expect(/[\u4e00-\u9fff]/u.test(value), `EN.${key} is still Chinese: ${value}`).toBe(false)
    }
  })

  it('uses the new term 笔记 and not 账本', () => {
    expect(ZH.segmentCatalog).toBe('笔记目录')
    expect(JSON.stringify(ZH)).not.toContain('账本')
  })

  it('builds Markdown labels from the active language', () => {
    expect(markdownLabels(ZH).code.copyLabel).toBe('复制')
    expect(markdownLabels(EN).code.copyLabel).toBe('Copy')
    expect(markdownLabels(EN).footnotes).toBe('Footnotes')
  })
})

describe('the board reads the platform locale rather than keeping its own', () => {
  it('follows the service', () => {
    const service = fakeLocale('en')
    install(service)
    expect(boardLocale()).toBe('en')
    expect(boardStrings().view).toBe('Note board')
  })

  it('switches through the service so every surface follows', () => {
    const service = fakeLocale('zh')
    install(service)
    toggleBoardLocale()
    expect(service.setLocale).toHaveBeenCalledWith('en')
  })

  it('toggles back', () => {
    const service = fakeLocale('en')
    install(service)
    toggleBoardLocale()
    expect(service.setLocale).toHaveBeenCalledWith('zh')
  })

  it('falls back to English for a language it has no dictionary for', () => {
    // The platform's own chain terminates at English; guessing Chinese here
    // would disagree with every other plugin on screen.
    install(fakeLocale('ja'))
    expect(boardLocale()).toBe('en')
  })

  it('still renders, in the language it was written in, with no service at all', () => {
    expect(boardLocale()).toBe('zh')
    expect(boardStrings().view).toBe('笔记看板')
  })

  it('switches locally when no service is mounted', () => {
    toggleBoardLocale()
    expect(boardLocale()).toBe('en')
    toggleBoardLocale()
    expect(boardLocale()).toBe('zh')
  })

  it('holds one platform subscription for every listener', () => {
    const service = fakeLocale('zh')
    install(service)
    expect(service.listenerCount()).toBe(0)
    const offFirst = subscribeBoardLocale(vi.fn())
    expect(service.listenerCount()).toBe(1)
    const offSecond = subscribeBoardLocale(vi.fn())
    // Two mounted boards, one platform subscription.
    expect(service.listenerCount()).toBe(1)
    offFirst()
    expect(service.listenerCount()).toBe(1)
    offSecond()
    expect(service.listenerCount()).toBe(0)
  })

  it('notifies a subscriber when the service changes', () => {
    const service = fakeLocale('zh')
    install(service)
    const listener = vi.fn()
    const off = subscribeBoardLocale(listener)
    service.setLocale('en')
    expect(listener).toHaveBeenCalled()
    off()
  })

  it('notifies local listeners when there is no service', () => {
    const listener = vi.fn()
    const off = subscribeBoardLocale(listener)
    toggleBoardLocale()
    expect(listener).toHaveBeenCalled()
    off()
  })
})

describe('the hooks re-read on a locale change', () => {
  it('subscribes through the module and reports the new locale', () => {
    // This is the regression that motivated the test: a hook that reads the
    // locale *without* subscribing renders a stale language until something
    // unrelated re-renders the pane, which is nearly impossible to notice.
    const service = fakeLocale('zh')
    install(service)
    captured.dispatcherCalls.length = 0

    expect(useBoardStrings().view).toBe('笔记看板')
    const call = captured.dispatcherCalls.at(-1)
    expect(call, 'useBoardStrings must go through useSyncExternalStore').toBeDefined()
    expect(call?.get()).toBe('zh')

    const listener = vi.fn()
    const off = call?.subscribe(listener)
    service.setLocale('en')
    expect(listener).toHaveBeenCalled()
    expect(call?.get()).toBe('en')
    off?.()
  })

  it('exposes the locale for callers that branch on it', () => {
    install(fakeLocale('en'))
    expect(useBoardLocale()).toBe('en')
  })
})

describe('the old term is gone from everything that ships', () => {
  it('mentions 账本 nowhere in src/', () => {
    const offenders = shippedSources()
      .filter(file => file.text.includes('账本'))
      .map(file => file.path)
    expect(offenders).toEqual([])
  })

  it('still uses the concept, under its new name', () => {
    const clientSources = shippedSources().filter(file => file.path.includes('/client/'))
    const withTerm = clientSources.filter(file => file.text.includes('笔记'))
    expect(withTerm.length).toBeGreaterThan(0)
  })
})

describe('every user-visible string goes through the dictionaries', () => {
  it('has no Chinese literal left in client code outside i18n.ts', () => {
    // A hardcoded string is not a style problem here: it is a string that will
    // *not* follow the language switch, so an English board would show it in
    // Chinese with no way to fix it from the dictionaries.
    const withoutComments = (text: string): string =>
      text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    const offenders: string[] = []
    for (const file of shippedSources()) {
      if (!file.path.includes('/client/') || file.path.endsWith('i18n.ts')) continue
      const match = /[\u4e00-\u9fff]+/u.exec(withoutComments(file.text))
      if (match !== null) offenders.push(`${file.path}: ${match[0]}`)
    }
    expect(offenders).toEqual([])
  })
})
