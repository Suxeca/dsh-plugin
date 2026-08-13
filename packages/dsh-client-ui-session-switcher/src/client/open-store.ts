/**
 * Tiny external store for the palette open state (useSyncExternalStore-shaped).
 * @module @deepseek-ai/dsh-client-ui-session-switcher/client/open-store
 */

/** External store interface consumed by useSyncExternalStore. */
export interface OpenStore {
  getSnapshot(): boolean
  subscribe(listener: () => void): () => void
  toggle(): void
  close(): void
}

/** Create the palette open-state store (single boolean, manual notify). */
export function createOpenStore(): OpenStore {
  let open = false
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => open,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    toggle: () => {
      open = !open
      for (const listener of [...listeners]) listener()
    },
    close: () => {
      if (!open) return
      open = false
      for (const listener of [...listeners]) listener()
    },
  }
}
