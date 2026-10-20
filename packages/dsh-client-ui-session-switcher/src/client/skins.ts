/**
 * Palette skins (深色/浅色/高对比). The color values live as CSS custom
 * properties in switcher.module.css (one `[data-skin=…]` block each); this
 * module only owns the name order and the localStorage persistence; the
 * display labels live in the locale dictionaries (i18n.ts). Flipping the `data-skin` attribute restyles the whole palette.
 * @module @suxeca/dsh-client-ui-session-switcher/client/skins
 */

/** Skin cycle order (the header button steps through it). */
export const SKIN_ORDER = ['dark', 'light', 'highcontrast'] as const

/** A persisted skin name. */
export type SkinName = (typeof SKIN_ORDER)[number]

/** localStorage key backing the persisted skin choice. */
const SKIN_KEY = 'dsh.sessionSwitcher.skin'

/** Type guard: is this a known skin name? */
export function isSkinName(value: unknown): value is SkinName {
  return typeof value === 'string' && (SKIN_ORDER as readonly string[]).includes(value)
}

/** Read the persisted skin, defaulting to dark on absence/corruption. */
export function loadSkin(): SkinName {
  try {
    const value = localStorage.getItem(SKIN_KEY)
    return isSkinName(value) ? value : 'dark'
  } catch {
    return 'dark'
  }
}

/** Persist the skin choice (storage failures are ignored). */
export function saveSkin(name: SkinName): void {
  try {
    localStorage.setItem(SKIN_KEY, name)
  } catch {
    /* storage unavailable */
  }
}

/** The next skin in the cycle order. */
export function nextSkin(name: SkinName): SkinName {
  return SKIN_ORDER[(SKIN_ORDER.indexOf(name) + 1) % SKIN_ORDER.length]
}
