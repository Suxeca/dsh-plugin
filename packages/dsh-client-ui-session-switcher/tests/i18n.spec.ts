// Locale selection for the palette: the platform's `locale` service decides,
// and the plugin's own dictionaries are the fallback when no service is mounted.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { EN, ZH, installSwitcherLocale, switcherLocale, switcherStrings, toggleSwitcherLocale } =
  await import('../src/client/i18n.ts')

/** Minimal stand-in for the platform `locale` service slice. */
function fakeService(active: string): {
  getSnapshot(): { readonly active: string }
  subscribe(listener: () => void): () => void
  setLocale(id: string): void
} {
  let current = active
  return {
    getSnapshot: () => ({ active: current }),
    subscribe: () => () => {},
    setLocale: (id: string) => {
      current = id
    },
  }
}

describe('switcher locale', () => {
  beforeEach(() => {
    // Every test installs its own service and disposes it; a leaked service
    // would leak into the next test through the module-level singleton.
    vi.restoreAllMocks()
  })

  it('falls back to Chinese without a platform service', () => {
    expect(switcherLocale()).toBe('zh')
    expect(switcherStrings().title).toBe(ZH.title)
  })

  it('follows the platform locale service', () => {
    const off = installSwitcherLocale(fakeService('en'))
    expect(switcherLocale()).toBe('en')
    expect(switcherStrings().title).toBe(EN.title)
    off()
    expect(switcherLocale()).toBe('zh')
  })

  it('resolves a locale without a dictionary to English', () => {
    const off = installSwitcherLocale(fakeService('ru'))
    expect(switcherLocale()).toBe('en')
    off()
  })

  it('switches the language through the platform preference', () => {
    const service = fakeService('zh')
    const off = installSwitcherLocale(service)
    toggleSwitcherLocale()
    expect(service.getSnapshot().active).toBe('en')
    expect(switcherStrings().title).toBe(EN.title)
    off()
  })

  it('ships the same keys in both dictionaries', () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(ZH).sort())
  })
})
