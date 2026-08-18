/**
 * Unit tests for the palette lifecycle store: snapshot identity, listener
 * notification, close-on-already-closed no-op, and the Space-preview state
 * machine (enter → Esc returns to the card, Enter confirms).
 * @module tests/open-store.spec
 */

import { describe, expect, it, vi } from 'vitest'
import { createOpenStore } from '../src/client/open-store.ts'

describe('createOpenStore', () => {
  it('starts closed', () => {
    const store = createOpenStore()
    expect(store.getSnapshot()).toEqual({ open: false, preview: false })
  })

  it('toggles and notifies listeners', () => {
    const store = createOpenStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.toggle()
    expect(store.getSnapshot()).toEqual({ open: true, preview: false })
    expect(listener).toHaveBeenCalledTimes(1)
    store.toggle()
    expect(store.getSnapshot().open).toBe(false)
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
    expect(store.getSnapshot().open).toBe(false)
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

  it('enterPreview hides the card and records the restore session', () => {
    const store = createOpenStore()
    store.toggle() // open
    store.enterPreview('target-1', 'from-0')
    expect(store.getSnapshot()).toEqual({
      open: false, preview: true, previewTargetId: 'target-1', previewFromId: 'from-0',
    })
  })

  it('exitPreview returns to the card (Esc)', () => {
    const store = createOpenStore()
    store.toggle()
    store.enterPreview('target-1', 'from-0')
    store.exitPreview()
    expect(store.getSnapshot()).toEqual({ open: true, preview: false })
  })

  it('confirmPreview closes the card for good (Enter)', () => {
    const store = createOpenStore()
    store.toggle()
    store.enterPreview('target-1', 'from-0')
    store.confirmPreview()
    expect(store.getSnapshot()).toEqual({ open: false, preview: false })
  })
})
