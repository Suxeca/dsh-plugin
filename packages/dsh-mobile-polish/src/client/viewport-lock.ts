/**
 * Android keyboard viewport lock.
 *
 * The stock frame is `html/body/#root { height: 100% }` with a sticky
 * `bottom: 0` composer seat anchored to the LAYOUT viewport. On Android that
 * anchor is unreliable around the soft keyboard: Chrome may shrink or restore
 * the layout viewport late, and it pans the document (window.scrollY) to keep
 * the focused input visible — a pan that frequently sticks after the keyboard
 * closes. The result is the whole frame stranded in the upper part of the
 * screen after a send (composer "jumps up", the wallpaper shows below the
 * frame, and the tap-time fixed tooltip ghost stays where the button used to
 * be).
 *
 * The lock pins the frame to the VISUAL viewport instead: every
 * `visualViewport` resize/scroll republishes the visible height as
 * `--dsh-mobile-vv-height` (consumed by the stylesheet under
 * `@media (max-width: 600px)`) and pulls any residual document pan back to
 * the top. The composer therefore sits above the keyboard while it is open
 * and back on the screen floor when it closes, in every browser state.
 */

/** Attribute published on `<html>` while the lock is live. */
export const VV_ATTR = 'data-dsh-mobile-vv'
/** Custom property carrying the visible viewport height in px. */
export const VV_VAR = '--dsh-mobile-vv-height'

/** Structural slice of the window the lock touches: the real `window`
 * satisfies it; tests supply fakes without a DOM. */
export interface ViewportView {
  readonly visualViewport?: {
    readonly height: number
    addEventListener(type: 'resize' | 'scroll', listener: () => void): void
    removeEventListener(type: 'resize' | 'scroll', listener: () => void): void
  } | null
  matchMedia?(query: string): { matches: boolean }
  readonly navigator?: { readonly userAgent?: string }
  readonly document: { readonly documentElement: HTMLElement }
  readonly scrollY: number
  scrollTo(x: number, y: number): void
  requestAnimationFrame(callback: () => void): number
  cancelAnimationFrame(handle: number): void
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

/**
 * Install the visual-viewport height lock. Inert on devices without
 * `visualViewport` support, a fine pointer (desktop), or a non-Android UA
 * (iOS keeps its stock `height: 100%` layout, which its keyboard already
 * resizes), so those browsers are untouched.
 * @param win - the window (or test fake) to observe.
 * @returns a cleanup that unhooks everything and removes the published
 * attribute and custom property.
 */
export function installViewportLock(win: ViewportView): () => void {
  const vv = win.visualViewport
  const coarse = win.matchMedia?.('(pointer: coarse)').matches ?? false
  const android = /android/i.test(win.navigator?.userAgent ?? '')
  if (vv == null || !coarse || !android) return () => {}
  const root = win.document.documentElement
  let frame = 0
  const sync = (): void => {
    frame = 0
    // A residual layout pan (the browser scrolled the document to reveal the
    // focused input and never gave it back) is what strands the frame above
    // the visible area; the lock makes that scroll unnecessary, so undo it.
    if (win.scrollY !== 0) win.scrollTo(0, 0)
    if (vv.height > 0) root.style.setProperty(VV_VAR, `${Math.round(vv.height)}px`)
  }
  const schedule = (): void => {
    if (frame !== 0) win.cancelAnimationFrame(frame)
    frame = win.requestAnimationFrame(sync)
  }
  root.setAttribute(VV_ATTR, '')
  sync()
  vv.addEventListener('resize', schedule)
  vv.addEventListener('scroll', schedule)
  win.addEventListener('orientationchange', schedule)
  return () => {
    if (frame !== 0) win.cancelAnimationFrame(frame)
    vv.removeEventListener('resize', schedule)
    vv.removeEventListener('scroll', schedule)
    win.removeEventListener('orientationchange', schedule)
    root.removeAttribute(VV_ATTR)
    root.style.removeProperty(VV_VAR)
  }
}
