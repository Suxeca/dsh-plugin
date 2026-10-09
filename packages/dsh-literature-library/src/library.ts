import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Metadata must be matched to its arXiv record before entering this catalog. */
export interface Paper {
  id: string
  title: string
  authors: string[]
  arxivUrl: string
  verifiedAt: string
  sourceUrl: string
}
interface LibraryState { version: 1; revision: number; starred: Record<string, string> }
const validId = (id: string): boolean => /^\d{4}\.\d{4,5}$/.test(id)

/** One serialized writer owns bookmarks; unstar retains research files. */
export class LiteratureLibrary {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly root: string, private readonly catalog: readonly Paper[]) {
    const seen = new Set<string>()
    for (const paper of catalog) {
      if (!validId(paper.id) || seen.has(paper.id) || paper.arxivUrl !== `https://arxiv.org/abs/${paper.id}`
        || !paper.title || !paper.authors.length || !paper.verifiedAt || !paper.sourceUrl) {
        throw new Error('Invalid or unverified literature catalog')
      }
      seen.add(paper.id)
    }
  }
  private async state(): Promise<LibraryState> {
    let raw: string
    try { raw = await readFile(join(this.root, 'bookmarks.json'), 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, revision: 0, starred: {} }
      throw error
    }
    const state = JSON.parse(raw) as LibraryState
    if (state.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0
      || !state.starred || typeof state.starred !== 'object' || Array.isArray(state.starred)
      || Object.entries(state.starred).some(([id, date]) => !validId(id) || typeof date !== 'string')) {
      throw new Error('Invalid bookmarks file; refusing to overwrite')
    }
    return state
  }
  private async atomic(path: string, content: string): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
    // The temporary and destination are explicit siblings under the configured library root.
    await rename(temporary, path)
  }
  /** Read committed data only, waiting for writes that preceded this request. */
  async snapshot() {
    await this.queue
    return { ...(await this.state()), papers: this.catalog, libraryRoot: this.root }
  }
  /** Idempotent selection; requests name catalog ids, never supply filesystem paths. */
  async select(id: string, selected: boolean) {
    const operation = this.queue.then(async () => {
      const paper = this.catalog.find(item => item.id === id)
      if (!paper) throw new Error('Unknown catalog paper')
      const state = await this.state()
      if (Boolean(state.starred[id]) === selected) return state
      await mkdir(this.root, { recursive: true })
      if (selected) {
        const directory = join(this.root, 'papers', id)
        await mkdir(directory, { recursive: true })
        await this.atomic(join(directory, 'metadata.json'), JSON.stringify(paper, null, 2) + '\n')
        // Never replace a reader's existing notes.
        try {
          await writeFile(join(directory, 'notes.md'), `# ${paper.title}\n\n[arXiv](${paper.arxivUrl})\n\n## 阅读笔记\n\n## 后续讨论\n`, { flag: 'wx' })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        }
        state.starred[id] = new Date().toISOString()
      } else delete state.starred[id]
      state.revision += 1
      // bookmarks.json is the commit point. All per-paper assets exist before success.
      await this.atomic(join(this.root, 'bookmarks.json'), JSON.stringify(state, null, 2) + '\n')
      return state
    })
    this.queue = operation.catch(() => undefined)
    return operation
  }
}

/** Load the independently verified catalog; malformed records fail at startup. */
export async function loadCatalog(path: string): Promise<Paper[]> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!Array.isArray(value)) throw new Error('Catalog must be an array')
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string'
      || typeof item.title !== 'string' || !Array.isArray(item.authors)
      || item.authors.some((author: unknown) => typeof author !== 'string')
      || typeof item.arxivUrl !== 'string' || typeof item.verifiedAt !== 'string'
      || typeof item.sourceUrl !== 'string') throw new Error('Malformed catalog record')
  }
  return value as Paper[]
}
