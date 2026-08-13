/**
 * Unit tests for the palette open-state store: snapshot identity, listener
 * notification, and the close-on-already-closed no-op.
 * @module tests/open-store.spec
 */

import { describe, expect, it, vi } from 'vitest'
import { createOpenStore } from '../src/client/open-store.ts'

describe('createOpenStore', () => {
  it('starts closed', () => {
    const store = createOpenStore()
    expect(store.getSnapshot()).toBe(false)
  })

  it('toggles and notifies listeners', () => {
    const store = createOpenStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.toggle()
    expect(store.getSnapshot()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    store.toggle()
    expect(store.getSnapshot()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    store.toggle()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('close only notifies when the palette was open', () => {
    const store = createOpenStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.close() // already closed: no-op
    expect(listener).not.toHaveBeenCalled()
    store.toggle()
    store.close()
    expect(store.getSnapshot()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('unsubscribe removes exactly one listener', () => {
    const store = createOpenStore()
    const a = vi.fn()
    const b = vi.fn()
    const offA = store.subscribe(a)
    store.subscribe(b)
    offA()
    store.toggle()
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
  })
})
