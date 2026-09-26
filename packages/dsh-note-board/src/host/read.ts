/**
 * The one way this plugin reads a note file.
 *
 * Everything that touches a path a caller or a config named goes through
 * {@link readBoundedFile}, because the three properties below are the ones a
 * naive `readFile` gets wrong, and each of them is a real defect rather than a
 * nicety:
 *
 *  1. **Bounded.** `readFile` pulls the whole file into memory *before* any
 *     display cap can apply, so a 128 MiB note costs 128 MiB of RSS to show
 *     256 KiB of it — and this runs in the DSH host process, once per turn for
 *     injection and once per poll for the board. The read is capped here and the
 *     truncation is reported, so the cap is a property of the read, not a
 *     decoration on the response.
 *
 *  2. **Non-blocking.** Opening a FIFO for reading blocks until a writer
 *     appears, and `stat`/`existsSync` cannot tell you that in advance. One
 *     attached FIFO therefore wedges every later request for that session —
 *     and, because the read sits on the libuv threadpool, enough of them stall
 *     unrelated filesystem work in the whole process. `O_NONBLOCK` makes the
 *     open return immediately so the type check below can reject it.
 *
 *  3. **Regular files only.** A directory, a FIFO, a device node or a socket are
 *     all "existing paths" that no reader of a note can do anything sensible
 *     with. `/dev/zero` in particular is an unbounded read of infinite bytes.
 *
 * Symlinks are deliberately *followed* (a note may legitimately be a link), but
 * they are resolved by the kernel at open time and the type is checked on the
 * **opened handle**, so a symlink cannot be swapped between the check and the
 * read: there is only one resolution, and the read happens through the handle it
 * produced.
 *
 * @module @suxeca/dsh-note-board/host/read
 */
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'

/** One bounded read: the text plus what was actually on disk. */
export interface BoundedRead {
  /** Decoded contents, at most `maxChars` characters. */
  readonly text: string
  /** `true` when the file held more than the cap allowed. */
  readonly truncated: boolean
  /** True on-disk size in bytes, even when the read was capped. */
  readonly bytes: number
  /** Last modification time in epoch milliseconds. */
  readonly mtimeMs: number
}

/**
 * UTF-8 encodes one code point in at most four bytes.
 *
 * The cap is expressed in **characters** because that is what the injection
 * budget counts and what the absorption line compares; converting to a byte
 * budget needs this factor, and the `+ 4` covers the code point straddling the
 * boundary so the truncation test can see one character past the cap.
 */
const MAX_BYTES_PER_CHAR = 4

/**
 * The absolute ceiling on one read, whatever the configuration says.
 *
 * The configured cap is operator input, and an unbounded allocation driven by
 * config is still an unbounded allocation: `maxBytes: 1e12` would otherwise ask
 * for a terabyte-long buffer on the read path. 4 M characters is far past any
 * note a per-turn injection could use, and clamps to a 16 MiB read.
 */
export const MAX_READ_CHARS = 4 * 1024 * 1024

/**
 * Read at most `maxChars` characters from a regular file.
 *
 * The cap counts **UTF-16 code units** (what `String#length` and the injection
 * budget also count), so a supplementary character costs two: the number is
 * consistent with the rest of the plugin rather than with a byte count.
 *
 * @param path - absolute path to read.
 * @param maxChars - character cap, clamped to {@link MAX_READ_CHARS}; the
 *   underlying read is bounded to `maxChars * 4 + 4` bytes.
 * @returns the text, its true size, its mtime, and whether it was capped.
 * @throws when the path is missing, unreadable, or not a regular file.
 */
export async function readBoundedFile(path: string, maxChars: number): Promise<BoundedRead> {
  // An unusable cap is a programming error, not an empty file: silently reading
  // zero bytes would look exactly like "this note is empty", which is the kind
  // of failure this plugin exists to make impossible.
  if (!Number.isFinite(maxChars) || maxChars < 0) {
    throw new Error(`readBoundedFile: invalid character cap ${String(maxChars)}`)
  }
  const cap = Math.min(Math.floor(maxChars), MAX_READ_CHARS)
  // `O_NONBLOCK` is what keeps a FIFO from hanging the open; for a regular file
  // it changes nothing. See the module note.
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error(`${path} is not a regular file`)
    const budget = cap * MAX_BYTES_PER_CHAR + MAX_BYTES_PER_CHAR
    const size = Math.min(info.size, budget)
    const buffer = Buffer.alloc(size)
    const { bytesRead } = await handle.read(buffer, 0, size, 0)
    const raw = buffer.subarray(0, bytesRead).toString('utf8')
    const truncated = raw.length > cap
    // Slicing at the cap can land between the two halves of a surrogate pair,
    // which would emit half a character. Backing off one code unit is the honest
    // fix: the caller gets one character fewer, never a broken one. (Only
    // reachable for supplementary characters, i.e. past the BMP.)
    let text = truncated ? raw.slice(0, cap) : raw
    if (truncated) {
      const last = text.charCodeAt(text.length - 1)
      if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1)
    }
    return {
      text,
      truncated,
      bytes: info.size,
      mtimeMs: info.mtimeMs,
    }
  } finally {
    // A close failure must not mask the read's own outcome.
    await handle.close().catch(() => {})
  }
}
