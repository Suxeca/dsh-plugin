/**
 * Customizable keyboard bindings for the switcher. Three rebindable actions
 * (open palette / next / previous), persisted in localStorage so the user can
 * rebind entirely inside the web GUI — no CLI/TUI config needed. `Alt+K` stays
 * a fixed safety fallback for opening the palette (never rebindable, so a
 * mis-bound toggle cannot lock the palette out).
 * @module @deepseek-ai/dsh-client-ui-session-switcher/client/keymap
 */

/** Rebindable action ids (order drives the settings list). */
export const ACTIONS = ['toggle', 'next', 'prev'] as const
export type ActionId = (typeof ACTIONS)[number]

/** One key chord: a non-modifier key plus the exact modifier set. */
export interface Binding {
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
}

/** Human labels for the settings list. */
export const ACTION_LABELS: Record<ActionId, string> = {
  toggle: '打开面板',
  next: '下一个对话',
  prev: '上一个对话',
}

/** localStorage key backing the persisted keymap. */
const KEYMAP_KEY = 'dsh.sessionSwitcher.keymap'

/** Platform probe (safe under SSR / tests: no navigator → non-Mac). */
function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
}

/** Modifier keys that cannot be a binding on their own. */
const MODIFIER_KEYS = new Set([
  'Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock',
  'ScrollLock', 'Fn', 'FnLock', 'Hyper', 'Super', 'Symbol', 'SymbolLock',
  'Process', 'Dead', 'Unidentified',
])

/** Canonical key token: single characters lowercase, others unchanged. */
function canonicalKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key
}

/** Is this event key a lone modifier (nothing to bind)? */
export function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key) || key === ''
}

/** Default bindings — the pre-existing chords, platform-adjusted. */
export function defaultBindings(): Record<ActionId, Binding> {
  const mac = isMac()
  const primary = (): { ctrl: boolean; meta: boolean } => mac
    ? { ctrl: false, meta: true }
    : { ctrl: true, meta: false }
  return {
    toggle: { key: 'k', ...primary(), shift: false, alt: false },
    next: { key: ']', ...primary(), shift: false, alt: false },
    prev: { key: '[', ...primary(), shift: false, alt: false },
  }
}

/** Validate an unknown JSON value as a binding. */
function isBinding(value: unknown): value is Binding {
  if (typeof value !== 'object' || value === null) return false
  const b = value as Record<string, unknown>
  return typeof b.key === 'string'
    && b.key !== ''
    && !isModifierKey(b.key)
    && typeof b.ctrl === 'boolean'
    && typeof b.shift === 'boolean'
    && typeof b.alt === 'boolean'
    && typeof b.meta === 'boolean'
}

/** Read persisted bindings, falling back to defaults per action. */
export function loadBindings(): Record<ActionId, Binding> {
  const defaults = defaultBindings()
  try {
    const raw = localStorage.getItem(KEYMAP_KEY)
    if (raw === null) return defaults
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return defaults
    const record = parsed as Record<string, unknown>
    const out = { ...defaults }
    for (const action of ACTIONS) {
      if (isBinding(record[action])) out[action] = record[action]
    }
    return out
  } catch {
    return defaults
  }
}

/** Persist bindings (storage failures ignored). */
export function saveBindings(bindings: Record<ActionId, Binding>): void {
  try {
    localStorage.setItem(KEYMAP_KEY, JSON.stringify(bindings))
  } catch {
    /* storage unavailable */
  }
}

/**
 * Does this key event match the binding? Exact on key and every modifier —
 * a chord like Ctrl+K does not fire on Ctrl+Shift+K.
 */
export function matchesBinding(binding: Binding, e: {
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}): boolean {
  return canonicalKey(e.key) === canonicalKey(binding.key)
    && e.ctrlKey === binding.ctrl
    && e.shiftKey === binding.shift
    && e.altKey === binding.alt
    && e.metaKey === binding.meta
}

/** Build a binding from a key event (assumes the key is not a lone modifier). */
export function bindingFromEvent(e: {
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}): Binding {
  return {
    key: canonicalKey(e.key),
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    meta: e.metaKey,
  }
}

/** Human-readable chord, e.g. `Ctrl+Shift+K` / `⌘K` / `Ctrl+]`. */
export function formatBinding(binding: Binding): string {
  const parts: string[] = []
  if (binding.ctrl) parts.push('Ctrl')
  if (binding.alt) parts.push('Alt')
  if (binding.shift) parts.push('Shift')
  if (binding.meta) parts.push(isMac() ? '⌘' : 'Meta')
  const key = binding.key.length === 1 ? binding.key.toUpperCase() : binding.key
  parts.push(key)
  return parts.join('+')
}

/** Keymap store state: bindings plus the capture flag (suppresses global shortcuts mid-rebind). */
export interface KeymapState {
  readonly bindings: Record<ActionId, Binding>
  readonly capturing: boolean
}

/** External store interface consumed by useSyncExternalStore and the global handler. */
export interface KeymapStore {
  getSnapshot(): KeymapState
  subscribe(listener: () => void): () => void
  set(action: ActionId, binding: Binding): void
  beginCapture(): void
  endCapture(): void
}

/** Create the keymap store (loaded from localStorage, defaults on absence). */
export function createKeymapStore(): KeymapStore {
  let bindings = loadBindings()
  let capturing = false
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }
  return {
    getSnapshot: () => ({ bindings, capturing }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set: (action, binding) => {
      bindings = { ...bindings, [action]: binding }
      capturing = false
      saveBindings(bindings)
      notify()
    },
    beginCapture: () => {
      capturing = true
      notify()
    },
    endCapture: () => {
      capturing = false
      notify()
    },
  }
}
