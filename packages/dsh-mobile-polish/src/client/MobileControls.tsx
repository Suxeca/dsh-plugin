import { useEffect, useState } from 'react'
import css from './MobileControls.module.css'

const WHALE_KEY = 'dsh-mobile-polish:whale-enabled'
const WHALE_DISABLED_ATTR = 'data-dsh-whale-disabled'
const FOCUS_ATTR = 'data-dsh-conversation-focus'

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }

function activeFullscreenElement(): Element | null {
  const doc = document as FullscreenDocument
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null
}

async function enterNativeFullscreen(): Promise<void> {
  const root = document.documentElement as FullscreenElement
  if (typeof root.requestFullscreen === 'function') await root.requestFullscreen()
  else await root.webkitRequestFullscreen?.()
}

async function exitNativeFullscreen(): Promise<void> {
  const doc = document as FullscreenDocument
  if (activeFullscreenElement() === null) return
  if (typeof document.exitFullscreen === 'function') await document.exitFullscreen()
  else await doc.webkitExitFullscreen?.()
}

function storedWhaleEnabled(): boolean {
  try { return localStorage.getItem(WHALE_KEY) !== 'false' } catch { return true }
}

function applyWhaleState(enabled: boolean): void {
  document.documentElement.toggleAttribute(WHALE_DISABLED_ATTR, !enabled)
  try { localStorage.setItem(WHALE_KEY, String(enabled)) } catch { /* storage may be unavailable */ }
}

/** Mobile-only floating controls for whale animation and conversation focus mode. */
export function MobileControls() {
  const [whaleEnabled, setWhaleEnabled] = useState(storedWhaleEnabled)
  const [focused, setFocused] = useState(() => document.documentElement.hasAttribute(FOCUS_ATTR))

  useEffect(() => {
    applyWhaleState(whaleEnabled)
  }, [whaleEnabled])

  useEffect(() => {
    const onFullscreenChange = (): void => {
      if (activeFullscreenElement() === null && document.documentElement.hasAttribute(FOCUS_ATTR)) {
        document.documentElement.removeAttribute(FOCUS_ATTR)
        setFocused(false)
      }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    document.addEventListener('webkitfullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange)
      document.documentElement.removeAttribute(FOCUS_ATTR)
    }
  }, [])

  const toggleFocus = async (): Promise<void> => {
    const active = document.documentElement.hasAttribute(FOCUS_ATTR)
    if (active) {
      // Release CSS focus synchronously. Some Android WebViews return a
      // fullscreen-exit promise that settles late (or never settles), so the
      // UI must not wait for it before restoring navigation and the composer.
      document.documentElement.removeAttribute(FOCUS_ATTR)
      setFocused(false)
      void exitNativeFullscreen().catch(() => {})
      return
    }

    document.documentElement.setAttribute(FOCUS_ATTR, '')
    setFocused(true)
    try {
      await enterNativeFullscreen()
    } catch {
      // Android browsers may reject Fullscreen API on HTTP; CSS focus mode still works.
    }
  }

  return (
    <div className={css.controls} data-mobile-controls="" aria-label="移动端显示设置">
      <button
        type="button"
        className={css.button}
        data-active={whaleEnabled || undefined}
        aria-pressed={whaleEnabled}
        aria-label={whaleEnabled ? '关闭小鲸鱼动画' : '开启小鲸鱼动画'}
        title={whaleEnabled ? '关闭小鲸鱼动画' : '开启小鲸鱼动画'}
        onClick={() => setWhaleEnabled(value => !value)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 13.2c1.7.2 3.1-.3 4.2-1.5.9-1 1.8-1.6 3.1-1.7 2.2-.2 3.9.8 5.1 2.7.8 1.3 2.1 2.1 3.8 2.1 1 0 1.9-.2 2.8-.7-.8 2.8-3.3 4.8-6.5 4.8H9.8C6.2 16.8 4 15.6 3 13.2Z" />
          <path d="M15.4 12.7c1-2 2.8-3.1 5.1-3.2-.2 1.8-1.2 3.2-2.9 4.1M7.2 11.7C6 10.5 5.6 9.1 6 7.4c1.7.5 2.8 1.5 3.4 3" />
          <circle cx="12.8" cy="12.3" r=".8" />
        </svg>
      </button>
      <span className={css.divider} aria-hidden="true" />
      <button
        type="button"
        className={css.button}
        data-active={focused || undefined}
        aria-pressed={focused}
        aria-label={focused ? '退出对话全屏' : '对话全屏'}
        title={focused ? '退出对话全屏' : '对话全屏'}
        onClick={() => { void toggleFocus() }}
      >
        {focused ? (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" /></svg>
        )}
      </button>
    </div>
  )
}
