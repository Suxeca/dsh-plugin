/**
 * Lab-kit cockpit open state: a dependency-free toggle + subscriber set.
 * (Template note: graduate to a real store (zustand) when the plugin grows
 * multiple consumers of one state slice.)
 * @module dsh-lab-kit/client/cockpit-state
 */

let open = false
const listeners = new Set<() => void>()

/** Whether the cockpit view is currently open. */
export function isCockpitOpen(): boolean {
  return open
}

/** Toggle the cockpit view and notify subscribers. */
export function toggleCockpit(): void {
  open = !open
  for (const listener of listeners) listener()
}

/** Close the cockpit view. */
export function closeCockpit(): void {
  if (!open) return
  open = false
  for (const listener of listeners) listener()
}

/** Subscribe to open-state changes; returns the unsubscribe function. */
export function subscribeCockpit(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
