import { describe, expect, it } from 'vitest'
import { VV_ATTR, VV_VAR, installViewportLock, type ViewportView } from '../src/client/viewport-lock.ts'

/** Minimal window fake: the lock only touches these surfaces. */
function makeWindow(options: {
  vvHeight?: number
  coarse?: boolean
  android?: boolean
  scrollY?: number
}): { win: ViewportView; emit: (type: 'resize' | 'scroll') => void; root: HTMLElement } {
  const listeners = new Map<string, Set<() => void>>()
  const attrs = new Set<string>()
  const props = new Map<string, string>()
  const root = {
    setAttribute: (name: string) => { attrs.add(name) },
    removeAttribute: (name: string) => { attrs.delete(name) },
    getAttribute: (name: string) => (attrs.has(name) ? '' : null),
    hasAttribute: (name: string) => attrs.has(name),
    style: {
      setProperty: (name: string, value: string) => { props.set(name, value) },
      removeProperty: (name: string) => { props.delete(name) },
      getPropertyValue: (name: string) => props.get(name) ?? '',
    },
  } as unknown as HTMLElement
  let scrollY = options.scrollY ?? 0
  const vv = options.vvHeight === undefined ? null : {
    height: options.vvHeight,
    addEventListener: (type: string, l: () => void) => {
      const key = `vv:${type}`
      if (!listeners.has(key)) listeners.set(key, new Set())
      listeners.get(key)!.add(l)
    },
    removeEventListener: (type: string, l: () => void) => {
      listeners.get(`vv:${type}`)?.delete(l)
    },
  }
  const win: ViewportView = {
    visualViewport: vv,
    matchMedia: () => ({ matches: options.coarse ?? false }),
    navigator: { userAgent: options.android ? 'Mozilla/5.0 (Linux; Android 14)' : 'Mozilla/5.0 (Macintosh)' },
    document: { documentElement: root },
    get scrollY() { return scrollY },
    scrollTo: (_x: number, y: number) => { scrollY = y },
    requestAnimationFrame: (cb: () => void) => { cb(); return 1 },
    cancelAnimationFrame: () => {},
    addEventListener: (type: string, l: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(l)
    },
    removeEventListener: (type: string, l: () => void) => { listeners.get(type)?.delete(l) },
  }
  const emit = (type: 'resize' | 'scroll'): void => {
    for (const l of listeners.get(`vv:${type}`) ?? []) l()
  }
  return { win, emit, root }
}

describe('installViewportLock', () => {
  it('stays inert on desktop (fine pointer), non-Android (iOS), and missing visualViewport', () => {
    const desktop = makeWindow({ vvHeight: 800, coarse: false, android: true })
    installViewportLock(desktop.win)
    expect(desktop.root.hasAttribute(VV_ATTR)).toBe(false)

    const ios = makeWindow({ vvHeight: 800, coarse: true, android: false })
    installViewportLock(ios.win)
    expect(ios.root.hasAttribute(VV_ATTR)).toBe(false)

    const noVv = makeWindow({ coarse: true, android: true })
    installViewportLock(noVv.win)
    expect(noVv.root.hasAttribute(VV_ATTR)).toBe(false)
  })

  it('publishes the visible height and clears a residual layout pan on Android', () => {
    const { win, root } = makeWindow({ vvHeight: 640.4, coarse: true, android: true, scrollY: 120 })
    installViewportLock(win)
    expect(root.getAttribute(VV_ATTR)).toBe('')
    expect(root.style.getPropertyValue(VV_VAR)).toBe('640px')
    // The stranded-frame pan is undone at install time.
    expect(win.scrollY).toBe(0)
  })

  it('tracks keyboard open/close through viewport events and unhooks on dispose', () => {
    const { win, emit, root } = makeWindow({ vvHeight: 812, coarse: true, android: true })
    const dispose = installViewportLock(win)
    expect(root.style.getPropertyValue(VV_VAR)).toBe('812px')

    const vv = win.visualViewport as { height: number }
    vv.height = 420
    emit('resize')
    expect(root.style.getPropertyValue(VV_VAR)).toBe('420px')

    vv.height = 812
    emit('scroll')
    expect(root.style.getPropertyValue(VV_VAR)).toBe('812px')

    dispose()
    expect(root.hasAttribute(VV_ATTR)).toBe(false)
    expect(root.style.getPropertyValue(VV_VAR)).toBe('')
    // Listeners are gone: further events change nothing.
    vv.height = 300
    emit('resize')
    expect(root.style.getPropertyValue(VV_VAR)).toBe('')
  })
})
