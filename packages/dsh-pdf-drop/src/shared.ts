/**
 * Shared DTOs for @suxeca/dsh-pdf-drop — the browser half posts one dropped
 * document and the host half answers where it landed.
 */

/** One dropped-file upload request. */
export interface UploadPdfRequest {
  /** Current session identity; the host resolves its workspace directory. */
  sessionId?: string
  /** Session workspace directory as the browser sees it (validated by the host). */
  cwd?: string
  filename: string
  /** Base64-encoded file content (no data-URL prefix). */
  dataBase64?: string
}

/** Where one uploaded document landed. */
export interface UploadPdfResult {
  filename: string
  /** Absolute path of the written file. */
  path: string
  /** Path relative to the target directory — the `@mention` payload. */
  relative: string
  /** Absolute directory that received the file. */
  directory: string
  /** How the directory was resolved. */
  resolvedFrom: 'session' | 'request' | 'process'
  size: number
}

export type Envelope<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }
