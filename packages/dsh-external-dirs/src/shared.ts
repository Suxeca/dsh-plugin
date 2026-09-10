/**
 * Wire contract shared by both halves of @suxeca/dsh-external-dirs.
 *
 * The plugin adds one page-type tab to DSH's **native** right Sidebar that
 * browses absolute directories *outside* the session workspace. The host's
 * own `workspaceFiles.list` deliberately refuses that (`outside-workspace`,
 * see `@deepseek-ai/dsh-api-workspace-files`), so this plugin owns a small
 * host route that lists a directory with `node:fs` directly.
 *
 * Only listing and reading are implemented: this is a read-only browser. The
 * file *content* is still rendered by the official preview tabs, which are
 * handed a `dsh-resource://file/<absolute path>` address — the workspace-path
 * helper preserves absolute paths that fall outside the workspace root, and
 * the official workspace-files reader accepts them.
 *
 * @module @suxeca/dsh-external-dirs/shared
 */

/** One entry in a listed directory. */
export interface ExternalDirEntry {
  /** Entry name, without any directory part. */
  readonly name: string
  /** Absolute path of the entry. */
  readonly path: string
  /** Whether the entry is a directory (follows symlinks). */
  readonly directory: boolean
}

/** Result of listing one absolute directory. */
export interface ExternalDirListing {
  /** The absolute directory that was listed, canonicalized. */
  readonly path: string
  /** Absolute parent directory, or null at a filesystem root. */
  readonly parent: string | null
  /** Child entries, directories first, then name. */
  readonly entries: readonly ExternalDirEntry[]
  /** True when the entry cap was hit and the listing is partial. */
  readonly truncated: boolean
}

/** The configured external roots plus the server's home directory. */
export interface ExternalRootsState {
  /** Absolute directories the user added, in insertion order. */
  readonly roots: readonly string[]
  /** The host user's home directory, offered as a one-click starting point. */
  readonly home: string
}

/** Patch body for adding or removing one root. */
export interface ExternalRootsPatch {
  /** Operation to perform. */
  readonly op: 'add' | 'remove'
  /** Absolute directory to add or remove. */
  readonly path: string
}

/** Uniform JSON envelope, matching the shape other local plugins use. */
export interface Envelope<T> {
  readonly ok: boolean
  readonly data?: T
  readonly error?: string
}
