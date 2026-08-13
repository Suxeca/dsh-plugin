/**
 * Unit tests for skin persistence and cycling. The module reads
 * localStorage lazily, so the tests swap in a Map-backed storage double.
 * @module tests/skins.spec
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>()
  get length(): number {
    return this.map.size
  }
  clear(): void {
    this.map.clear()
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
})

// Import after the storage double is stubbed (the module only touches
// localStorage inside its functions, so order is not load-bearing — but
// explicit is safer than implicit).
const { SKIN_LABELS, SKIN_ORDER, isSkinName, loadSkin, nextSkin, saveSkin } = await import('../src/client/skins.ts')

describe('skins', () => {
  it('defaults to dark without a stored value', () => {
    expect(loadSkin()).toBe('dark')
  })

  it('falls back to dark for unknown stored values', () => {
    localStorage.setItem('dsh.sessionSwitcher.skin', 'neon')
    expect(loadSkin()).toBe('dark')
  })

  it('round-trips through localStorage', () => {
    saveSkin('light')
    expect(localStorage.getItem('dsh.sessionSwitcher.skin')).toBe('light')
    expect(loadSkin()).toBe('light')
  })

  it('cycles through the skin order', () => {
    expect(nextSkin('dark')).toBe('light')
    expect(nextSkin('light')).toBe('highcontrast')
    expect(nextSkin('highcontrast')).toBe('dark')
    expect(SKIN_ORDER).toEqual(['dark', 'light', 'highcontrast'])
  })

  it('labels every skin in Chinese', () => {
    expect(SKIN_LABELS.dark).toBe('深色')
    expect(SKIN_LABELS.light).toBe('浅色')
    expect(SKIN_LABELS.highcontrast).toBe('高对比')
  })

  it('guards against non-name values', () => {
    expect(isSkinName('dark')).toBe(true)
    expect(isSkinName('neon')).toBe(false)
    expect(isSkinName(42)).toBe(false)
  })

  it('tolerates storage failures', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(loadSkin()).toBe('dark')
    expect(() => saveSkin('light')).not.toThrow()
  })
})
