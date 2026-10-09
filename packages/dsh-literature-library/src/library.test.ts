import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LiteratureLibrary } from './library.js'

const paper = { id: '2410.06557', title: 'Test catalog record', authors: ['Test author'], arxivUrl: 'https://arxiv.org/abs/2410.06557', verifiedAt: '2026-10-08', sourceUrl: 'https://arxiv.org/abs/2410.06557' }
test('star survives reopening, duplicate writes are idempotent, notes survive unstar', async () => {
  const root = await mkdtemp(join(tmpdir(), 'literature-library-'))
  const library = new LiteratureLibrary(root, [paper])
  await Promise.all([library.select(paper.id, true), library.select(paper.id, true)])
  assert.equal((await library.snapshot()).revision, 1)
  const notes = join(root, 'papers', paper.id, 'notes.md')
  await writeFile(notes, 'personal discussion notes\n')
  const reopened = new LiteratureLibrary(root, [paper])
  assert.ok((await reopened.snapshot()).starred[paper.id])
  await reopened.select(paper.id, false)
  await reopened.select(paper.id, true)
  assert.equal(await readFile(notes, 'utf8'), 'personal discussion notes\n')
  assert.equal((await reopened.snapshot()).revision, 3)
})
test('unknown ids and malformed stored data never overwrite the library', async () => {
  const root = await mkdtemp(join(tmpdir(), 'literature-library-'))
  const library = new LiteratureLibrary(root, [paper])
  await assert.rejects(library.select('../escape', true), /Unknown/)
  const file = join(root, 'bookmarks.json')
  await writeFile(file, 'broken-data')
  await assert.rejects(library.select(paper.id, true))
  assert.equal(await readFile(file, 'utf8'), 'broken-data')
})
