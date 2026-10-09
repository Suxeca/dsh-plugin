import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isExpressionMode, isExpressionLanguage, isExpressionPatch, usableSessionId,
  type ExpressionMode, type ExpressionLanguage, type ExpressionPatch, type ExpressionState, type ModeStore } from '../shared.ts'

interface Entry { mode: ExpressionMode; language: ExpressionLanguage; revision: number; updatedAt: number }
const MAX_BYTES = 2 * 1024 * 1024
const MAX_SESSIONS = 10000

/** One process-owned writer. Corrupt state fails visibly; it never silently enables or resets modes. */
export class ExpressionStore implements ModeStore {
  private entries = new Map<string, Entry>()
  private writing: Promise<void> = Promise.resolve()
  private closed = false
  private constructor(private readonly path: string, private readonly ruleVersion: string) {}

  static async open(path: string, ruleVersion: string): Promise<ExpressionStore> {
    const store = new ExpressionStore(path, ruleVersion)
    let file
    try { file = await open(path, 'r') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return store
      throw error
    }
    try {
      const info = await file.stat()
      if (!info.isFile() || info.size > MAX_BYTES) throw new Error('Expression state is not a bounded regular file')
      const buffer = Buffer.alloc(MAX_BYTES + 1)
      let length = 0
      while (length < buffer.length) {
        const result = await file.read(buffer, length, buffer.length - length, null)
        if (result.bytesRead === 0) break
        length += result.bytesRead
      }
      if (length > MAX_BYTES) throw new Error('Expression state exceeds the byte limit')
      store.entries = parseState(JSON.parse(buffer.subarray(0, length).toString('utf8')))
    } finally { await file.close() }
    return store
  }

  async get(sessionId: string): Promise<ExpressionState> {
    assertId(sessionId)
    await this.writing
    return this.view(sessionId, this.entries.get(sessionId))
  }

  /** Preserve the original commands' semantics; new independent controls use update(). */
  set(sessionId: string, mode: ExpressionMode): Promise<ExpressionState> {
    assertId(sessionId)
    if (!isExpressionMode(mode)) return Promise.reject(new Error('Invalid expression mode'))
    return this.update(sessionId, { mode, language: mode === 'ste' ? 'en' : 'auto' })
  }

  update(sessionId: string, patch: ExpressionPatch): Promise<ExpressionState> {
    assertId(sessionId)
    if (this.closed) return Promise.reject(new Error('Expression state writer is closed'))
    if (!isExpressionPatch(patch)) return Promise.reject(new Error('Invalid expression settings'))
    // Own the two leaf values before queuing, so callers cannot mutate an admitted patch.
    const admitted = { mode: patch.mode, language: patch.language }
    const operation = this.writing.then(async () => {
      const previous = this.entries.get(sessionId)
      const mode = admitted.mode ?? previous?.mode ?? 'default'
      const language = admitted.language ?? previous?.language ?? 'auto'
      if ((!previous && mode === 'default' && language === 'auto')
        || (previous?.mode === mode && previous.language === language)) return this.view(sessionId, previous)
      if (!previous && this.entries.size >= MAX_SESSIONS) throw new Error('Expression state capacity exceeded')
      const entry: Entry = { mode, language, revision: (previous?.revision ?? 0) + 1, updatedAt: Date.now() }
      const next = new Map(this.entries)
      next.set(sessionId, entry)
      const json = JSON.stringify({ version: 2, sessions: Object.fromEntries(next) }, null, 2) + '\n'
      if (Buffer.byteLength(json) > MAX_BYTES) throw new Error('Expression state exceeds the byte limit')
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      const temporary = `${this.path}.${randomUUID()}.tmp`
      try {
        const file = await open(temporary, 'wx', 0o600)
        try { await file.writeFile(json, 'utf8'); await file.sync() } finally { await file.close() }
        await rename(temporary, this.path)
      } catch (error) {
        await unlink(temporary).catch(() => {})
        throw error
      }
      this.entries = next
      return this.view(sessionId, entry)
    })
    this.writing = operation.then(() => {}, () => {})
    return operation
  }

  async close(): Promise<void> { this.closed = true; await this.writing }

  private view(sessionId: string, entry?: Entry): ExpressionState {
    return { sessionId, mode: entry?.mode ?? 'default', language: entry?.language ?? 'auto',
      revision: entry?.revision ?? 0, updatedAt: entry?.updatedAt ?? null, ruleVersion: this.ruleVersion }
  }
}

function assertId(value: string): void {
  if (!usableSessionId(value)) throw new Error('Invalid session id')
}

function parseState(value: unknown): Map<string, Entry> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid expression state')
  const root = value as Record<string, unknown>
  if ((root.version !== 1 && root.version !== 2) || !root.sessions || typeof root.sessions !== 'object' || Array.isArray(root.sessions)
    || Object.keys(root).some(key => key !== 'version' && key !== 'sessions')) throw new Error('Invalid expression state schema')
  const pairs = Object.entries(root.sessions)
  if (pairs.length > MAX_SESSIONS) throw new Error('Expression state capacity exceeded')
  const result = new Map<string, Entry>()
  for (const [id, raw] of pairs) {
    assertId(id)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid expression entry')
    const entry = raw as Record<string, unknown>
    const keys = root.version === 1 ? ['mode', 'revision', 'updatedAt'] : ['mode', 'language', 'revision', 'updatedAt']
    if (!isExpressionMode(entry.mode) || !Number.isSafeInteger(entry.revision) || (entry.revision as number) < 1
      || typeof entry.updatedAt !== 'number' || !Number.isFinite(entry.updatedAt) || entry.updatedAt < 0
      || Object.keys(entry).some(key => !keys.includes(key))
      || (root.version === 2 && !isExpressionLanguage(entry.language))) throw new Error('Invalid expression entry schema')
    // Old ste meant English + simple. Do not change existing sessions' language on upgrade.
    const language: ExpressionLanguage = root.version === 1
      ? (entry.mode === 'ste' ? 'en' : 'auto') : entry.language as ExpressionLanguage
    result.set(id, { mode: entry.mode, language, revision: entry.revision as number, updatedAt: entry.updatedAt })
  }
  return result
}
