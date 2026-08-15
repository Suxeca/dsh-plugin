/**
 * Unit tests for the customizable keymap: defaults, matching, capture,
 * formatting, persistence, and the store lifecycle.
 * @module tests/keymap.spec
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

const {
  ACTIONS,
  bindingFromEvent,
  createKeymapStore,
  defaultBindings,
  formatBinding,
  isModifierKey,
  loadBindings,
  matchesBinding,
  saveBindings,
} = await import('../src/client/keymap.ts')

function ev(key: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) {
  return { key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods }
}

describe('isModifierKey', () => {
  it('rejects lone modifiers', () => {
    expect(isModifierKey('Control')).toBe(true)
    expect(isModifierKey('Shift')).toBe(true)
    expect(isModifierKey('')).toBe(true)
  })
  it('accepts real keys', () => {
    expect(isModifierKey('k')).toBe(false)
    expect(isModifierKey(']')).toBe(false)
  })
})

describe('defaultBindings', () => {
  it('has all actions with the pre-existing + VSCode-style chords (non-Mac)', () => {
    const d = defaultBindings()
    expect(d.toggle).toMatchObject({ key: 'k', ctrl: true, meta: false })
    expect(d.next).toMatchObject({ key: ']', ctrl: true })
    expect(d.prev).toMatchObject({ key: '[', ctrl: true })
    // Layout chords: Ctrl+B left / Ctrl+Shift+B right / Ctrl+J bottom,
    // Alt+Shift+L / Alt+Shift+R fullscreens (identical on Mac — Alt chords).
    expect(d.toggleLeftSidebar).toMatchObject({ key: 'b', ctrl: true, shift: false, alt: false })
    expect(d.toggleRightSidebar).toMatchObject({ key: 'b', ctrl: true, shift: true, alt: false })
    expect(d.toggleBottom).toMatchObject({ key: 'j', ctrl: true, shift: false, alt: false })
    expect(d.fullscreenLeft).toMatchObject({ key: 'l', ctrl: false, shift: true, alt: true })
    expect(d.fullscreenRight).toMatchObject({ key: 'r', ctrl: false, shift: true, alt: true })
    expect(ACTIONS).toEqual([
      'toggle', 'next', 'prev',
      'toggleLeftSidebar', 'toggleRightSidebar', 'toggleBottom',
      'fullscreenLeft', 'fullscreenRight',
    ])
  })
})

describe('matchesBinding', () => {
  const b = { key: 'k', ctrl: true, shift: false, alt: false, meta: false }
  it('matches the exact chord case-insensitively', () => {
    expect(matchesBinding(b, ev('k', { ctrlKey: true }))).toBe(true)
    expect(matchesBinding(b, ev('K', { ctrlKey: true }))).toBe(true)
  })
  it('does not match with extra modifiers', () => {
    expect(matchesBinding(b, ev('k', { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(matchesBinding(b, ev('k'))).toBe(false)
  })
  it('does not match a different key', () => {
    expect(matchesBinding(b, ev('j', { ctrlKey: true }))).toBe(false)
  })
})

describe('bindingFromEvent / formatBinding', () => {
  it('captures key and modifiers', () => {
    expect(bindingFromEvent(ev('K', { ctrlKey: true, shiftKey: true }))).toEqual({
      key: 'k', ctrl: true, shift: true, alt: false, meta: false,
    })
  })
  it('formats chords readably', () => {
    expect(formatBinding({ key: 'k', ctrl: true, shift: true, alt: false, meta: false })).toBe('Ctrl+Shift+K')
    expect(formatBinding({ key: ']', ctrl: true, shift: false, alt: false, meta: false })).toBe('Ctrl+]')
    expect(formatBinding({ key: 'k', ctrl: false, shift: false, alt: false, meta: true })).toBe('Meta+K')
  })
})

describe('persistence', () => {
  it('round-trips bindings through localStorage', () => {
    const b = { ...defaultBindings(), toggle: { key: 'p', ctrl: true, shift: true, alt: false, meta: false } }
    saveBindings(b)
    expect(loadBindings()).toEqual(b)
  })
  it('falls back to defaults on corrupt or missing data', () => {
    localStorage.setItem('dsh.sessionSwitcher.keymap', '{not json')
    expect(loadBindings()).toEqual(defaultBindings())
    localStorage.setItem('dsh.sessionSwitcher.keymap', JSON.stringify({ toggle: { key: 'Shift' } }))
    expect(loadBindings().toggle).toEqual(defaultBindings().toggle)
  })
})

describe('createKeymapStore', () => {
  it('starts with defaults and no capture', () => {
    const store = createKeymapStore()
    expect(store.getSnapshot().bindings).toEqual(defaultBindings())
    expect(store.getSnapshot().capturing).toBe(false)
  })

  it('returns a referentially stable snapshot between mutations (useSyncExternalStore contract)', () => {
    const store = createKeymapStore()
    expect(store.getSnapshot()).toBe(store.getSnapshot())
    const before = store.getSnapshot()
    store.beginCapture()
    expect(store.getSnapshot()).not.toBe(before)
    expect(store.getSnapshot()).toBe(store.getSnapshot())
    const capturing = store.getSnapshot()
    store.endCapture()
    expect(store.getSnapshot()).not.toBe(capturing)
    expect(store.getSnapshot()).toBe(store.getSnapshot())
  })

  it('set persists, notifies, and ends capture', () => {
    const store = createKeymapStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.beginCapture()
    expect(store.getSnapshot().capturing).toBe(true)
    const binding = { key: 'p', ctrl: true, shift: false, alt: false, meta: false }
    store.set('toggle', binding)
    expect(store.getSnapshot().capturing).toBe(false)
    expect(store.getSnapshot().bindings.toggle).toEqual(binding)
    expect(loadBindings().toggle).toEqual(binding)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('endCapture clears the flag without touching bindings', () => {
    const store = createKeymapStore()
    store.beginCapture()
    store.endCapture()
    expect(store.getSnapshot().capturing).toBe(false)
    expect(store.getSnapshot().bindings).toEqual(defaultBindings())
  })
})
