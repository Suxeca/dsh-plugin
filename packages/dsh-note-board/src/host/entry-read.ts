/**
 * Session-bound, read-only access to one knowledge section in the bound ledger.
 *
 * This tool deliberately takes neither a session id nor a path. The caller's
 * actual DSH ToolRunContext supplies the live Agent identity and its cwd; that
 * identity is resolved against the board's existing per-session binding.
 * Run-log sections are classified out before selection, even if configuration
 * pins `*`, and only the requested knowledge section is returned.
 */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { DEFAULT_PINNED_SECTIONS, DEFAULT_RUN_LOG_SECTIONS, sectionsOf, selectNote } from '../sections.ts'
import type { LedgerRef } from '../shared.ts'
import { MAX_READ_CHARS, readBoundedFile } from './read.ts'

export const NOTE_BOARD_READ_TOOL = 'note_board_read'
export const MAX_ENTRY_PAGE_CHARS = 12_000

export interface EntryReadArgs {
  readonly section_id: string
  readonly offset?: number
  readonly limit?: number
  /** Revision returned by the previous page; required for every nonzero offset. */
  readonly revision?: string
}

interface ReadAgentContext {
  readonly id?: string
  readonly session?: { readonly header?: { readonly cwd?: string } }
}

export interface EntryReadExecution {
  readonly agent?: ReadAgentContext
}

export interface EntryReadResolved {
  readonly source: 'attached' | 'discovered' | 'none' | 'off'
  readonly path?: string
  readonly title?: string
}

export interface EntryReadFile {
  readonly text: string
  readonly truncated: boolean
  readonly bytes: number
  readonly mtimeMs: number
}

export interface EntryReadDeps {
  readonly resolve: (sessionId: string, cwd: string) => Promise<LedgerRef | EntryReadResolved>
  readonly pinnedSections?: readonly string[]
  readonly runLogSections?: readonly string[]
  readonly maxReadChars: number
  readonly read?: (path: string, maxChars: number) => Promise<EntryReadFile>
}

interface EntryReadResult {
  readonly ok: boolean
  readonly status: string
  readonly path?: string
  readonly sessionId?: string
  readonly section_id?: string
  readonly heading?: string
  readonly revision?: string
  readonly offset?: number
  readonly limit?: number
  readonly text?: string
  readonly complete?: boolean
  readonly fileTruncated?: boolean
  readonly continuation?: { readonly revision: string, readonly offset: number } | null
  readonly message?: string
}

const resultJson = (result: EntryReadResult): string => JSON.stringify(result)
const normalizedId = (value: string): string => value.trim().toLocaleLowerCase('en-US')

/** A revision binds every page to one exact bounded file snapshot. */
function revisionOf(file: EntryReadFile): string {
  return createHash('sha256')
    .update(String(file.bytes)).update('\0')
    .update(String(file.mtimeMs)).update('\0')
    .update(file.text, 'utf8')
    .digest('hex')
}

/** Back off if an offset would start on the low half of a surrogate pair. */
function safeStart(text: string, offset: number): number {
  if (offset > 0 && offset < text.length) {
    const here = text.charCodeAt(offset)
    const before = text.charCodeAt(offset - 1)
    if (here >= 0xdc00 && here <= 0xdfff && before >= 0xd800 && before <= 0xdbff) return offset - 1
  }
  return offset
}

/** Back off if a page would end between the two halves of a surrogate pair. */
function safeEnd(text: string, start: number, end: number): number {
  if (end > start && end < text.length) {
    const before = text.charCodeAt(end - 1)
    const here = text.charCodeAt(end)
    if (before >= 0xd800 && before <= 0xdbff && here >= 0xdc00 && here <= 0xdfff) return end - 1
  }
  return end
}

function identityOf(ref: LedgerRef | EntryReadResolved): { path?: string, title?: string } {
  return {
    ...(typeof ref.path === 'string' ? { path: ref.path } : {}),
    ...(typeof ref.title === 'string' ? { title: ref.title } : {}),
  }
}

/** Execute the callable portion separately so isolation and paging are unit-testable. */
export async function readKnowledgeEntry(
  args: EntryReadArgs,
  exec: EntryReadExecution,
  deps: EntryReadDeps,
): Promise<string> {
  const agent = exec.agent
  const sessionId = agent?.id
  const cwd = agent?.session?.header?.cwd
  if (typeof sessionId !== 'string' || sessionId.trim() === '' || typeof cwd !== 'string' || cwd.trim() === '') {
    return resultJson({ ok: false, status: 'session-context-unavailable', message: 'This tool requires the current agent session and its working directory.' })
  }
  if (typeof args.section_id !== 'string' || args.section_id.trim() === '') {
    return resultJson({ ok: false, status: 'invalid-section-id', sessionId, message: 'Provide the exact section_id from the knowledge index.' })
  }
  const requestedId = normalizedId(args.section_id)
  let ref: LedgerRef | EntryReadResolved
  try {
    ref = await deps.resolve(sessionId, cwd)
  } catch {
    return resultJson({ ok: false, status: 'binding-error', sessionId, message: 'Could not resolve this session’s existing note binding.' })
  }
  const fileIdentity = identityOf(ref)
  if (ref.source === 'off') {
    return resultJson({ ok: false, status: 'injection-off', sessionId, ...fileIdentity, message: 'Knowledge entry reads are unavailable while note injection is turned off for this session.' })
  }
  if (ref.source === 'none' || typeof ref.path !== 'string' || ref.path === '') {
    return resultJson({ ok: false, status: 'no-note-bound', sessionId, message: 'This session has no bound or discovered note.' })
  }

  let file: EntryReadFile
  try {
    const read = deps.read ?? readBoundedFile
    const cap = Math.max(0, Math.min(Math.floor(deps.maxReadChars), MAX_READ_CHARS))
    file = await read(ref.path, cap)
  } catch {
    return resultJson({ ok: false, status: 'note-unreadable', sessionId, ...fileIdentity, message: 'The bound note could not be read as a regular file.' })
  }
  const revision = revisionOf(file)
  const selection = selectNote(file.text, deps.pinnedSections ?? DEFAULT_PINNED_SECTIONS, deps.runLogSections ?? DEFAULT_RUN_LOG_SECTIONS)

  // A bounded prefix cannot prove global uniqueness: a second matching ID could
  // be beyond the cap. Fail closed before exposing any content from that prefix.
  if (file.truncated) {
    return resultJson({
      ok: false, status: 'file-truncated', sessionId, ...fileIdentity,
      section_id: args.section_id.trim(), revision,
      message: 'The bounded file read was truncated; section absence and duplicate-id checks are inconclusive, so no entry content is returned.',
    })
  }

  // A log ID wins even when a knowledge heading has the same ID. It therefore
  // cannot become readable by being paired with a knowledge section.
  if (selection.logs.some(section => normalizedId(section.id) === requestedId)) {
    return resultJson({ ok: false, status: 'run-log-excluded', sessionId, ...fileIdentity, section_id: args.section_id.trim(), revision, message: 'Run-log sections are intentionally unavailable through this tool.' })
  }

  const matches = selection.knowledge.filter(section => normalizedId(section.id) === requestedId)
  if (matches.length === 0) {
    return resultJson({
      ok: false, status: file.truncated ? 'not-found-in-truncated-file' : 'section-not-found',
      sessionId, ...fileIdentity, section_id: args.section_id.trim(), revision, fileTruncated: file.truncated,
      message: file.truncated
        ? 'The requested section was not found in the bounded file prefix; the file was truncated, so absence is inconclusive.'
        : 'No knowledge section has this exact section_id (case-insensitive).',
    })
  }
  if (matches.length > 1) {
    return resultJson({ ok: false, status: 'ambiguous-section-id', sessionId, ...fileIdentity, section_id: args.section_id.trim(), revision, message: 'Multiple knowledge sections share this id; no section was returned.' })
  }
  if (args.offset !== undefined && (!Number.isSafeInteger(args.offset) || args.offset < 0)) {
    return resultJson({ ok: false, status: 'invalid-offset', sessionId, ...fileIdentity, section_id: matches[0].id, revision, message: 'offset must be a nonnegative safe integer.' })
  }
  if (args.limit !== undefined && (!Number.isSafeInteger(args.limit) || args.limit < 1)) {
    return resultJson({ ok: false, status: 'invalid-limit', sessionId, ...fileIdentity, section_id: matches[0].id, revision, message: 'limit must be a positive safe integer.' })
  }

  const requestedOffset = args.offset ?? 0
  if (requestedOffset > 0 && typeof args.revision !== 'string') {
    return resultJson({ ok: false, status: 'revision-required', sessionId, ...fileIdentity, section_id: matches[0].id, revision, message: 'Pass the returned revision with every continuation page; restart at offset 0 if no revision is available.' })
  }
  if (args.revision !== undefined && args.revision !== revision) {
    return resultJson({ ok: false, status: 'revision-changed', sessionId, ...fileIdentity, section_id: matches[0].id, revision, message: 'The note changed between pages. Discard prior pages and restart at offset 0 with this revision.' })
  }

  const section = matches[0]
  const parsedSections = sectionsOf(file.text).sections
  const lastParsed = parsedSections.at(-1)
  // If this is the last parsed section of a truncated prefix, no later heading
  // established its end. Compare values because selectNote performs its own parse.
  const sectionIsOpenAtReadLimit = file.truncated
    && lastParsed?.id === section.id
    && lastParsed.heading === section.heading
    && lastParsed.text === section.text
  const requestedLimit = args.limit ?? MAX_ENTRY_PAGE_CHARS
  const limit = Math.max(1, Math.min(requestedLimit, MAX_ENTRY_PAGE_CHARS))
  const offset = safeStart(section.text, Math.min(requestedOffset, section.text.length))
  let end = safeEnd(section.text, offset, Math.min(section.text.length, offset + limit))
  // A one-code-unit page cannot contain a supplementary code point. Let this
  // single pair exceed the requested page size by one code unit (never the hard
  // maximum) so the continuation always advances without splitting UTF-16.
  if (end === offset && offset < section.text.length) end = Math.min(section.text.length, offset + 2)
  const text = section.text.slice(offset, end)
  const actualLimit = end - offset
  const hasMoreKnownText = end < section.text.length
  const entryComplete = !sectionIsOpenAtReadLimit
  const continuation = hasMoreKnownText ? { revision, offset: end } : null
  return resultJson({
    ok: true,
    status: entryComplete ? 'ok' : 'entry-truncated',
    sessionId,
    ...fileIdentity,
    section_id: section.id,
    heading: section.heading,
    revision,
    offset,
    limit: actualLimit,
    text,
    complete: entryComplete && !hasMoreKnownText,
    fileTruncated: file.truncated,
    continuation,
    ...(sectionIsOpenAtReadLimit ? { message: 'The file read cap was reached inside this section; its full text is unavailable.' } : {}),
  })
}

/** Define a real DSH ToolDefinition over the session-bound callable reader. */
export function createNoteBoardReadTool(deps: EntryReadDeps): ToolDefinition {
  // ToolRegistry consumes a standard JSON Schema ToolDefinition. Keeping this
  // definition structural avoids importing the tool registry implementation at
  // runtime (its host-owned peer graph is supplied by the DSH composition).
  return {
    name: NOTE_BOARD_READ_TOOL,
    description: [
      'Read exactly one knowledge section from the note bound to the current agent session.',
      'Use the exact section_id shown in the note knowledge index; this tool accepts no session id or path.',
      'Run-log sections are never returned. Duplicate ids are refused.',
      'Pages are bounded; pass both continuation.offset and continuation.revision to continue.',
      'If status is revision-changed, discard earlier pages and restart at offset 0.',
      'A truncated or incomplete result is not the full entry. This tool does not claim that retrieval happened automatically.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        section_id: { type: 'string', description: 'Exact section id from the knowledge index; case-insensitive.' },
        offset: { type: 'integer', description: 'Optional UTF-16 code-unit offset from continuation.offset; default 0.' },
        limit: { type: 'integer', description: `Optional page length, capped at ${MAX_ENTRY_PAGE_CHARS} UTF-16 code units.` },
        revision: { type: 'string', description: 'Required when offset > 0; use the revision returned by the previous page.' },
      },
      required: ['section_id'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: EntryReadArgs, exec: ToolRunContext): Promise<string> {
      return readKnowledgeEntry(args, exec, deps)
    },
    presentCall: (args: unknown) => ({
      card: 'generic',
      title: `Read note entry: ${typeof args === 'object' && args !== null && 'section_id' in args ? String((args as { section_id: unknown }).section_id) : 'section'}`,
      kind: 'read',
    }),
  } as ToolDefinition
}

/** Register via a late-injected tools scope, so the board itself has no hard tools dependency. */
export function injectNoteBoardReadTool(ctx: Context, deps: EntryReadDeps): void {
  ctx.inject(['tools'], (scope) => {
    // Some tests and older partial compositions invoke late callbacks eagerly;
    // tools is optional at runtime and must not make the board/UI mount fail.
    const registry = (scope as unknown as { tools?: { register(tool: ToolDefinition): () => void } }).tools
    if (registry === undefined || typeof registry.register !== 'function') return
    scope.effect(() => registry.register(createNoteBoardReadTool(deps)), '@suxeca/dsh-note-board: note_board_read tool')
  })
}
